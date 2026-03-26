import { env } from '../../config/env';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { writeAuditLog } from '../auditLogs/service';
import { createInAppNotification, enqueueEmailPlaceholder, getUserEmail } from '../notifications/service';
import { type UserRole, ROLE_ORDER } from '../auth/types';

type ApprovalDecision = 'approved' | 'rejected';

export function getApprovalRoleSequence(amount: number): UserRole[] {
  const base: UserRole[] = [...ROLE_ORDER.slice(0, 3)]; // team_lead -> pm -> finance
  if (amount > env.HIGH_VALUE_THRESHOLD) base.push('gm');
  return base;
}

async function resolveApproverId(role: UserRole, department?: string | null): Promise<string> {
  // Prefer matching department; fall back to any user with the role.
  let q = supabaseAdmin.from('users').select('id').eq('role', role).limit(1);
  if (department) q = q.eq('department', department);
  const { data, error } = await q;
  if (error) throw error;
  if (data && data.length > 0) return data[0].id;

  // Fallback: any department
  const { data: fallback, error: fbErr } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('role', role)
    .limit(1);
  if (fbErr) throw fbErr;
  if (!fallback || fallback.length === 0) {
    throw new AppError(`No approver found for role=${role}`, 500);
  }
  return fallback[0].id;
}

async function notifyUser(params: { userId: string; type: string; message: string; emailSubject: string }) {
  await createInAppNotification({
    userId: params.userId,
    type: params.type,
    message: params.message,
  });

  const email = await getUserEmail(params.userId);
  if (email) {
    await enqueueEmailPlaceholder({
      toEmail: email,
      subject: params.emailSubject,
      body: params.message,
    });
  }
}

export async function startApprovalsForPurchaseRequest(prId: string, triggeredBy: string) {
  const { data: pr, error: prErr } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, amount, project_id, created_by, status')
    .eq('id', prId)
    .single();
  if (prErr || !pr) throw prErr ?? new AppError('Purchase request not found', 404);

  if (pr.status !== 'pending' && pr.status !== 'pending_exception') {
    // pending_exception is expected when exception is approved and we resume
    throw new AppError(`PR cannot start approval workflow from status=${pr.status}`, 409);
  }

  const { data: creator, error: creatorErr } = await supabaseAdmin
    .from('users')
    .select('id, department')
    .eq('id', pr.created_by)
    .single();
  if (creatorErr || !creator) throw creatorErr ?? new AppError('PR creator not found', 404);

  const roleSequence = getApprovalRoleSequence(Number(pr.amount));

  // Create approvals for each role stage; unique constraint prevents duplicates.
  const approvalsToInsert = await Promise.all(
    roleSequence.map(async (role) => {
      const approverId = await resolveApproverId(role, creator.department);
      return {
        request_id: pr.id,
        approver_id: approverId,
        role,
        status: 'pending',
        comments: null,
      };
    }),
  );

  const { error: insErr } = await supabaseAdmin.from('approvals').upsert(approvalsToInsert, {
    onConflict: 'request_id,role',
  });
  if (insErr) throw insErr;

  // Notify the first approver
  const firstRole = roleSequence[0];
  const { data: firstApproval, error: firstErr } = await supabaseAdmin
    .from('approvals')
    .select('id, approver_id, role')
    .eq('request_id', pr.id)
    .eq('role', firstRole)
    .single();
  if (firstErr || !firstApproval) throw firstErr ?? new AppError('First approval stage missing', 500);

  const message = `Purchase Request ${pr.id} is ready for your ${firstRole.replace('_', ' ')} approval.`;
  await notifyUser({
    userId: firstApproval.approver_id,
    type: 'pr_approval_pending',
    message,
    emailSubject: 'PR Approval Pending',
  });

  await writeAuditLog({
    action: 'approvals_started',
    userId: triggeredBy,
    entity: 'purchase_request',
    entityId: pr.id,
  });
}

function rolesAreFullyApproved(params: { requestId: string; roles: UserRole[] }) {
  return supabaseAdmin
    .from('approvals')
    .select('role, status')
    .eq('request_id', params.requestId)
    .in('role', params.roles)
    .then(({ data, error }) => {
      if (error) throw error;
      const byRole = new Map((data ?? []).map((r) => [r.role as UserRole, r.status]));
      return params.roles.every((r) => byRole.get(r) === 'approved');
    });
}

export async function decideApproval(params: {
  approvalId: string;
  decision: ApprovalDecision;
  comments?: string | null;
  actorUserId: string;
}) {
  const { approvalId, decision, comments, actorUserId } = params;
  const decisionNormalized = decision === 'approved' ? 'approved' : 'rejected';

  const { data: approval, error: apprErr } = await supabaseAdmin
    .from('approvals')
    .select('id, request_id, approver_id, role, status')
    .eq('id', approvalId)
    .single();
  if (apprErr || !approval) throw apprErr ?? new AppError('Approval not found', 404);

  if (approval.approver_id !== actorUserId) throw new AppError('Not authorized for this approval record', 403);
  if (approval.status !== 'pending') throw new AppError(`Approval already decided (status=${approval.status})`, 409);

  // Fetch PR + project context
  const { data: pr, error: prErr } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, amount, project_id, created_by, status')
    .eq('id', approval.request_id)
    .single();
  if (prErr || !pr) throw prErr ?? new AppError('Purchase request not found', 404);

  if (pr.status !== 'pending' && pr.status !== 'pending_exception') {
    throw new AppError(`PR is not in a deciable state (status=${pr.status})`, 409);
  }

  const roleSequence = getApprovalRoleSequence(Number(pr.amount));
  if (!roleSequence.includes(approval.role as UserRole)) {
    throw new AppError('Approval role not part of expected sequence', 400);
  }

  // Enforce sequential approvals by role order
  const currentIndex = roleSequence.indexOf(approval.role as UserRole);
  const previousRoles = roleSequence.slice(0, currentIndex);
  if (previousRoles.length > 0) {
    const { data: prevApprovals, error: prevErr } = await supabaseAdmin
      .from('approvals')
      .select('role, status')
      .eq('request_id', pr.id)
      .in('role', previousRoles);
    if (prevErr) throw prevErr;
    const prevMap = new Map((prevApprovals ?? []).map((r) => [r.role as UserRole, r.status]));
    const allApproved = previousRoles.every((r) => prevMap.get(r) === 'approved');
    if (!allApproved) throw new AppError('Cannot decide before previous stages are approved', 409);
  }

  // Update current approval decision by request_id + approver_id from JWT.
  // This avoids unreliable role-only matching across departments/users.
  // eslint-disable-next-line no-console
  console.log('[approvals] decision update attempt', {
    request_id: approval.request_id,
    current_user_id: actorUserId,
  });
  const { data: updatedApprovals, error: updErr } = await supabaseAdmin
    .from('approvals')
    .update({
      status: decisionNormalized,
      comments: comments ?? null,
    })
    .eq('request_id', approval.request_id)
    .eq('approver_id', actorUserId)
    .eq('status', 'pending')
    .select('id, request_id, approver_id, role, status, comments, created_at');
  if (updErr) throw updErr;
  const rowsAffected = updatedApprovals?.length ?? 0;
  // eslint-disable-next-line no-console
  console.log('[approvals] decision update result', {
    request_id: approval.request_id,
    current_user_id: actorUserId,
    rows_affected: rowsAffected,
  });
  if (rowsAffected === 0) throw new AppError('No matching approval found for this user', 404);
  const updatedApproval = updatedApprovals![0];

  if (decisionNormalized === 'rejected') {
    // Reject the whole PR and close the workflow.
    const { error: prRejErr } = await supabaseAdmin
      .from('purchase_requests')
      .update({ status: 'rejected' })
      .eq('id', pr.id);
    if (prRejErr) throw prRejErr;

    // Mark other pending approvals as rejected (idempotent + prevents dangling approvals).
    await supabaseAdmin
      .from('approvals')
      .update({ status: 'rejected', comments: 'Auto-rejected due to earlier rejection' })
      .eq('request_id', pr.id)
      .eq('status', 'pending');

    await notifyUser({
      userId: pr.created_by,
      type: 'pr_rejected',
      message: `Purchase Request ${pr.id} was rejected by ${approval.role}.`,
      emailSubject: 'PR Rejected',
    });

    await writeAuditLog({
      action: 'pr_rejected',
      userId: actorUserId,
      entity: 'purchase_request',
      entityId: pr.id,
    });

    return { prId: pr.id, status: 'rejected' as const, approval: updatedApproval };
  }

  // Decision is approved
  const fullyApproved = await rolesAreFullyApproved({ requestId: pr.id, roles: roleSequence });
  if (!fullyApproved) {
    // Notify next approver stage
    const nextRole = roleSequence[currentIndex + 1];
    if (!nextRole) throw new AppError('Next role not found', 500);

    const { data: nextApproval, error: nextErr } = await supabaseAdmin
      .from('approvals')
      .select('id, approver_id, role')
      .eq('request_id', pr.id)
      .eq('role', nextRole)
      .single();
    if (nextErr || !nextApproval) throw nextErr ?? new AppError('Next approval stage missing', 500);

    await notifyUser({
      userId: nextApproval.approver_id,
      type: 'pr_approval_pending',
      message: `Purchase Request ${pr.id} is ready for your ${nextRole.replace('_', ' ')} approval.`,
      emailSubject: 'PR Approval Pending',
    });

    await writeAuditLog({
      action: 'approval_stage_approved',
      userId: actorUserId,
      entity: 'purchase_request',
      entityId: pr.id,
    });

    return { prId: pr.id, status: 'pending' as const, approval: updatedApproval };
  }

  // Apply financial validation: decrement remaining value / budget only if sufficient.
  const projectId = pr.project_id;
  const { data: projectRow, error: projRowErr } = await supabaseAdmin
    .from('projects')
    .select('id, po_id, budget')
    .eq('id', projectId)
    .single();
  if (projRowErr || !projectRow) throw projRowErr ?? new AppError('Project not found', 404);
  const poId = projectRow.po_id ?? null;

  // Read current remaining/budget to compute safe decrement.
  if (poId) {
    const { data: poRow, error: poErr } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, remaining_value')
      .eq('id', poId)
      .single();
    if (poErr || !poRow) throw poErr ?? new AppError('PO not found', 404);

    if (Number(poRow.remaining_value) < Number(pr.amount)) {
      // Compensate workflow: reject PR
      await supabaseAdmin.from('purchase_requests').update({ status: 'rejected' }).eq('id', pr.id);
      await supabaseAdmin
        .from('approvals')
        .update({ status: 'rejected', comments: 'Auto-rejected due to insufficient remaining PO balance' })
        .eq('request_id', pr.id)
        .eq('status', 'pending');
      await writeAuditLog({
        action: 'pr_rejected_insufficient_po_balance',
        userId: actorUserId,
        entity: 'purchase_request',
        entityId: pr.id,
      });
      throw new AppError('Insufficient PO remaining value for approval', 409);
    }

    const { error: decErr } = await supabaseAdmin
      .from('purchase_orders')
      .update({ remaining_value: Number(poRow.remaining_value) - Number(pr.amount) })
      .eq('id', poId);
    if (decErr) throw decErr;
  } else {
    if (Number(projectRow.budget) < Number(pr.amount)) {
      await supabaseAdmin.from('purchase_requests').update({ status: 'rejected' }).eq('id', pr.id);
      await supabaseAdmin
        .from('approvals')
        .update({ status: 'rejected', comments: 'Auto-rejected due to insufficient remaining budget' })
        .eq('request_id', pr.id)
        .eq('status', 'pending');
      await writeAuditLog({
        action: 'pr_rejected_insufficient_budget',
        userId: actorUserId,
        entity: 'purchase_request',
        entityId: pr.id,
      });
      throw new AppError('Insufficient remaining budget for approval', 409);
    }

    const { error: decErr } = await supabaseAdmin
      .from('projects')
      .update({ budget: Number(projectRow.budget) - Number(pr.amount) })
      .eq('id', projectId);
    if (decErr) throw decErr;
  }

  // Finalize PR status
  const { error: prOkErr } = await supabaseAdmin.from('purchase_requests').update({ status: 'approved' }).eq('id', pr.id);
  if (prOkErr) throw prOkErr;

  await notifyUser({
    userId: pr.created_by,
    type: 'pr_approved',
    message: `Purchase Request ${pr.id} was fully approved.`,
    emailSubject: 'PR Approved',
  });

  await writeAuditLog({
    action: 'pr_approved',
    userId: actorUserId,
    entity: 'purchase_request',
    entityId: pr.id,
  });

  return { prId: pr.id, status: 'approved' as const, approval: updatedApproval };
}

