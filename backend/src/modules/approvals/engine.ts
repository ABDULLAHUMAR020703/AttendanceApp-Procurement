import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { writeAuditLog } from '../auditLogs/service';
import { createInAppNotification, enqueueEmailPlaceholder, getUserEmail } from '../notifications/service';
import type { ApprovalStageRole } from '../auth/types';
import { APPROVAL_STAGE_ORDER } from '../auth/types';
import { buildApprovalStagesForProject } from '../org/approvers';
import { fetchProjectOrThrow } from '../org/projectGuards';

type ApprovalDecision = 'approved' | 'rejected';

export function getApprovalStageOrder(): readonly ApprovalStageRole[] {
  return APPROVAL_STAGE_ORDER;
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
    throw new AppError(`PR cannot start approval workflow from status=${pr.status}`, 409);
  }

  const project = await fetchProjectOrThrow(pr.project_id as string);
  const stageList = await buildApprovalStagesForProject(project);

  const approvalsToInsert = stageList.map((s) => ({
    request_id: pr.id,
    approver_id: s.approver_id,
    role: s.role,
    status: 'pending',
    comments: null,
  }));

  const { error: insErr } = await supabaseAdmin.from('approvals').upsert(approvalsToInsert, {
    onConflict: 'request_id,role',
  });
  if (insErr) throw insErr;

  const firstRole = stageList[0].role;
  const { data: firstApproval, error: firstErr } = await supabaseAdmin
    .from('approvals')
    .select('id, approver_id, role')
    .eq('request_id', pr.id)
    .eq('role', firstRole)
    .single();
  if (firstErr || !firstApproval) throw firstErr ?? new AppError('First approval stage missing', 500);

  const label = humanizeStageLabel(firstRole);
  const message = `Purchase Request ${pr.id} is ready for your ${label}.`;
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

function humanizeStageLabel(role: ApprovalStageRole): string {
  if (role === 'team_lead') return 'team lead approval';
  if (role === 'pm') return 'PM approval';
  return 'admin approval';
}

async function loadPrApprovalSequence(projectId: string): Promise<ApprovalStageRole[]> {
  const project = await fetchProjectOrThrow(projectId);
  const stages = await buildApprovalStagesForProject(project);
  return stages.map((s) => s.role);
}

function rolesAreFullyApproved(params: { requestId: string; roles: ApprovalStageRole[] }) {
  return supabaseAdmin
    .from('approvals')
    .select('role, status')
    .eq('request_id', params.requestId)
    .in('role', params.roles)
    .then(({ data, error }) => {
      if (error) throw error;
      const byRole = new Map((data ?? []).map((r) => [r.role as ApprovalStageRole, r.status]));
      return params.roles.every((r) => byRole.get(r) === 'approved');
    });
}

async function applyBudgetDecrementForApprovedPr(pr: {
  id: string;
  amount: number | string;
  project_id: string;
  created_by: string;
}, actorUserId: string) {
  const projectId = pr.project_id;
  const { data: projectRow, error: projRowErr } = await supabaseAdmin
    .from('projects')
    .select('id, po_id, budget')
    .eq('id', projectId)
    .single();
  if (projRowErr || !projectRow) throw projRowErr ?? new AppError('Project not found', 404);
  const poId = projectRow.po_id ?? null;

  if (poId) {
    const { data: poRow, error: poErr } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, remaining_value')
      .eq('id', poId)
      .single();
    if (poErr || !poRow) throw poErr ?? new AppError('PO not found', 404);

    if (Number(poRow.remaining_value) < Number(pr.amount)) {
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

  const { data: pr, error: prErr } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, amount, project_id, created_by, status')
    .eq('id', approval.request_id)
    .single();
  if (prErr || !pr) throw prErr ?? new AppError('Purchase request not found', 404);

  if (pr.status !== 'pending' && pr.status !== 'pending_exception') {
    throw new AppError(`PR is not in a deciable state (status=${pr.status})`, 409);
  }

  const roleSequence = await loadPrApprovalSequence(pr.project_id as string);
  if (!roleSequence.includes(approval.role as ApprovalStageRole)) {
    throw new AppError('Approval role not part of expected sequence', 400);
  }

  const currentIndex = roleSequence.indexOf(approval.role as ApprovalStageRole);
  const previousRoles = roleSequence.slice(0, currentIndex);
  if (previousRoles.length > 0) {
    const { data: prevApprovals, error: prevErr } = await supabaseAdmin
      .from('approvals')
      .select('role, status')
      .eq('request_id', pr.id)
      .in('role', previousRoles);
    if (prevErr) throw prevErr;
    const prevMap = new Map((prevApprovals ?? []).map((r) => [r.role as ApprovalStageRole, r.status]));
    const allApproved = previousRoles.every((r) => prevMap.get(r) === 'approved');
    if (!allApproved) throw new AppError('Cannot decide before previous stages are approved', 409);
  }

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
  if (rowsAffected === 0) throw new AppError('No matching approval found for this user', 404);
  const updatedApproval = updatedApprovals![0];

  if (decisionNormalized === 'rejected') {
    const { error: prRejErr } = await supabaseAdmin.from('purchase_requests').update({ status: 'rejected' }).eq('id', pr.id);
    if (prRejErr) throw prRejErr;

    await supabaseAdmin
      .from('approvals')
      .update({ status: 'rejected', comments: 'Auto-rejected due to earlier rejection' })
      .eq('request_id', pr.id)
      .eq('status', 'pending');

    await notifyUser({
      userId: pr.created_by,
      type: 'pr_rejected',
      message: `Purchase Request ${pr.id} was rejected at the ${approval.role} stage.`,
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

  const fullyApproved = await rolesAreFullyApproved({ requestId: pr.id, roles: roleSequence });
  if (!fullyApproved) {
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
      message: `Purchase Request ${pr.id} is ready for your ${humanizeStageLabel(nextRole)}.`,
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

  await applyBudgetDecrementForApprovedPr(pr, actorUserId);

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

export async function adminOverridePurchaseRequest(params: {
  requestId: string;
  decision: ApprovalDecision;
  reason: string;
  actorUserId: string;
}) {
  const { requestId, decision, reason, actorUserId } = params;
  const decisionNormalized = decision === 'approved' ? 'approved' : 'rejected';

  const { data: pr, error: prErr } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, status, created_by, amount, project_id')
    .eq('id', requestId)
    .single();
  if (prErr || !pr) throw prErr ?? new AppError('Purchase request not found', 404);

  if (decisionNormalized === 'rejected') {
    const { error: prRejErr } = await supabaseAdmin.from('purchase_requests').update({ status: 'rejected' }).eq('id', pr.id);
    if (prRejErr) throw prRejErr;

    const { error: approvalsCloseErr } = await supabaseAdmin
      .from('approvals')
      .update({
        status: 'rejected',
        comments: `Admin override rejected. Reason: ${reason}`,
      })
      .eq('request_id', pr.id)
      .eq('status', 'pending');
    if (approvalsCloseErr) throw approvalsCloseErr;
  } else {
    await applyBudgetDecrementForApprovedPr(
      {
        id: pr.id,
        amount: pr.amount,
        project_id: pr.project_id as string,
        created_by: pr.created_by,
      },
      actorUserId,
    );

    const { error: prOkErr } = await supabaseAdmin.from('purchase_requests').update({ status: 'approved' }).eq('id', pr.id);
    if (prOkErr) throw prOkErr;

    const { error: approvalsSkipErr } = await supabaseAdmin
      .from('approvals')
      .update({
        status: 'approved',
        comments: `Admin override approved. Reason: ${reason}`,
      })
      .eq('request_id', pr.id)
      .eq('status', 'pending');
    if (approvalsSkipErr) throw approvalsSkipErr;
  }

  const { data: updatedPr, error: updatedPrErr } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, status, created_by')
    .eq('id', pr.id)
    .single();
  if (updatedPrErr || !updatedPr) throw updatedPrErr ?? new AppError('Updated purchase request not found', 500);

  await writeAuditLog({
    action: 'admin_override',
    userId: actorUserId,
    entity: 'purchase_request',
    entityId: pr.id,
    reason,
  });

  return {
    prId: updatedPr.id,
    status: updatedPr.status,
    reason,
  };
}
