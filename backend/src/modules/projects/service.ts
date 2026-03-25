import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { writeAuditLog } from '../auditLogs/service';
import { createInAppNotification, enqueueEmailPlaceholder, getUserEmail } from '../notifications/service';

type CreateProjectInput = {
  name: string;
  poId: string | null;
  budget: number;
  createdBy: string;
  actorDepartment?: string | null;
};

async function resolveUserIdByRole(role: string, department?: string | null): Promise<string> {
  let q = supabaseAdmin.from('users').select('id').eq('role', role).limit(1);
  if (department) q = q.eq('department', department);
  const { data, error } = await q;
  if (error) throw error;
  if (data && data.length) return data[0].id;

  const { data: fallback, error: fbErr } = await supabaseAdmin.from('users').select('id').eq('role', role).limit(1);
  if (fbErr) throw fbErr;
  if (!fallback || fallback.length === 0) throw new AppError(`Approver role not found: ${role}`, 500);
  return fallback[0].id;
}

export async function createProjectWithExceptionFlow(input: CreateProjectInput) {
  const { name, poId, budget, createdBy, actorDepartment } = input;

  if (!name.trim()) throw new AppError('Project name is required', 400);

  if (poId) {
    const { data: po, error: poErr } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, remaining_value')
      .eq('id', poId)
      .single();
    if (poErr || !po) throw poErr ?? new AppError('PO not found', 404);

    const derivedBudget = Number(po.remaining_value);
    if (!Number.isFinite(derivedBudget) || derivedBudget <= 0) {
      throw new AppError('Selected PO has no remaining budget', 400);
    }

    const { data: project, error: prErr } = await supabaseAdmin.from('projects').insert({
      name,
      po_id: poId,
      budget: derivedBudget,
      created_by: createdBy,
      status: 'active',
      is_exception: false,
    }).select('id, name, po_id, budget, status, is_exception').single();
    if (prErr) throw prErr;

    await writeAuditLog({
      action: 'project_created',
      userId: createdBy,
      entity: 'project',
      entityId: project.id,
    });

    return { project };
  }

  // No PO: create project in blocked exception state and raise a no_po exception.
  if (budget <= 0) throw new AppError('Budget must be > 0', 400);
  const { data: project, error: prjErr } = await supabaseAdmin
    .from('projects')
    .insert({
      name,
      po_id: null,
      budget: Number(budget),
      created_by: createdBy,
      status: 'exception_pending',
      is_exception: true,
    })
    .select('id, name, po_id, budget, status, is_exception')
    .single();
  if (prjErr || !project) throw prjErr ?? new AppError('Failed to create project', 500);

  const { data: exception, error: exErr } = await supabaseAdmin
    .from('exceptions')
    .insert({
      type: 'no_po',
      reference_id: project.id,
      status: 'pending',
      approved_by: null,
    })
    .select('id, type, reference_id, status')
    .single();
  if (exErr || !exception) throw exErr ?? new AppError('Failed to create no_po exception', 500);

  // Notify Department Head
  const deptHeadId = await resolveUserIdByRole('dept_head', actorDepartment);
  const message = `No-PO exception requested for project "${project.name}". Approval required to proceed with purchase requests.`;
  await createInAppNotification({
    userId: deptHeadId,
    type: 'exception_no_po_pending',
    message,
  });
  const email = await getUserEmail(deptHeadId);
  if (email) {
    await enqueueEmailPlaceholder({
      toEmail: email,
      subject: 'No-PO Exception Approval Required',
      body: message,
    });
  }

  // Notify Project Creator that the workflow is blocked pending approval
  const creatorMessage = `Project "${project.name}" was created without a PO. It is pending Department Head approval before you can submit purchase requests.`;
  await createInAppNotification({
    userId: createdBy,
    type: 'no_po_exception_pending',
    message: creatorMessage,
  });
  const creatorEmail = await getUserEmail(createdBy);
  if (creatorEmail) {
    await enqueueEmailPlaceholder({
      toEmail: creatorEmail,
      subject: 'No-PO Exception Pending Approval',
      body: creatorMessage,
    });
  }

  await writeAuditLog({
    action: 'no_po_exception_created',
    userId: createdBy,
    entity: 'exception',
    entityId: exception.id,
  });

  return { project, exception };
}

const ARCHIVE_BLOCKED_MESSAGE = 'Project cannot be deleted as it has approved transactions';

async function hasCommittedFinancialActivity(projectId: string): Promise<boolean> {
  const { data: approvedPr, error: apErr } = await supabaseAdmin
    .from('purchase_requests')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'approved')
    .limit(1);
  if (apErr) throw apErr;
  if (approvedPr && approvedPr.length > 0) return true;

  const { data: prs, error: prErr } = await supabaseAdmin.from('purchase_requests').select('id').eq('project_id', projectId);
  if (prErr) throw prErr;
  const prIds = (prs ?? []).map((r) => r.id as string);
  if (prIds.length === 0) return false;

  const { data: auditHit, error: auErr } = await supabaseAdmin
    .from('audit_logs')
    .select('id')
    .eq('action', 'pr_approved')
    .eq('entity', 'purchase_request')
    .in('entity_id', prIds)
    .limit(1);
  if (auErr) throw auErr;
  return (auditHit?.length ?? 0) > 0;
}

/**
 * Soft-delete: sets status to `archived` (no row removal). Enforces RBAC and financial safety.
 */
export async function archiveProject(params: { projectId: string; actorUserId: string; actorRole: string }) {
  const { projectId, actorUserId, actorRole } = params;

  if (actorRole !== 'admin' && actorRole !== 'pm') {
    throw new AppError('Forbidden', 403);
  }

  const { data: project, error: prjErr } = await supabaseAdmin
    .from('projects')
    .select('id, created_by, status')
    .eq('id', projectId)
    .single();
  if (prjErr || !project) throw prjErr ?? new AppError('Project not found', 404);

  if (project.status === 'archived') {
    throw new AppError('Project is already archived', 409);
  }

  if (actorRole === 'pm' && project.created_by !== actorUserId) {
    throw new AppError('Forbidden', 403);
  }

  if (await hasCommittedFinancialActivity(projectId)) {
    throw new AppError(ARCHIVE_BLOCKED_MESSAGE, 409);
  }

  const { error: upErr } = await supabaseAdmin.from('projects').update({ status: 'archived' }).eq('id', projectId);
  if (upErr) throw upErr;

  await writeAuditLog({
    action: 'project_archived',
    userId: actorUserId,
    entity: 'project',
    entityId: projectId,
  });

  return { ok: true as const, status: 'archived' as const };
}
