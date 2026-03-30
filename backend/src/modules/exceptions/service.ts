import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { writeAuditLog } from '../auditLogs/service';
import { createInAppNotification, enqueueEmailPlaceholder, getUserEmail } from '../notifications/service';
import { startApprovalsForPurchaseRequest } from '../approvals/engine';
import type { UserRole } from '../auth/types';

async function notifyUser(params: { userId: string; type: string; message: string; emailSubject: string }) {
  await createInAppNotification({ userId: params.userId, type: params.type, message: params.message });
  const email = await getUserEmail(params.userId);
  if (email) {
    await enqueueEmailPlaceholder({ toEmail: email, subject: params.emailSubject, body: params.message });
  }
}

/** no_po reference_id is project id */
async function assertPmMayDecideNoPo(params: { projectId: string; actorDepartment: string }) {
  const { data: project, error } = await supabaseAdmin
    .from('projects')
    .select('id, department')
    .eq('id', params.projectId)
    .single();
  if (error || !project) throw error ?? new AppError('Referenced project not found', 404);
  if (project.department !== params.actorDepartment) {
    throw new AppError('PM can only decide no-PO exceptions for projects in their department', 403);
  }
}

export async function listPendingExceptionsForActor(params: {
  actorRole: UserRole;
  actorDepartment: string | null;
}) {
  const { actorRole, actorDepartment } = params;
  const { data, error } = await supabaseAdmin
    .from('exceptions')
    .select('id, type, reference_id, status, approved_by, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = data ?? [];

  if (actorRole === 'admin') return rows;

  if (actorRole !== 'pm' || !actorDepartment) return [];

  const out: typeof rows = [];
  for (const ex of rows) {
    if (ex.type === 'over_budget') {
      if (actorDepartment === 'finance') out.push(ex);
      continue;
    }
    if (ex.type === 'no_po') {
      const { data: project } = await supabaseAdmin
        .from('projects')
        .select('department')
        .eq('id', ex.reference_id)
        .maybeSingle();
      if (project && project.department === actorDepartment) out.push(ex);
    }
  }
  return out;
}

export async function decideException(params: {
  exceptionId: string;
  decision: 'approved' | 'rejected';
  actorUserId: string;
  actorRole: UserRole;
  actorDepartment: string | null;
}) {
  const { exceptionId, decision, actorUserId, actorRole, actorDepartment } = params;

  const { data: exception, error: exErr } = await supabaseAdmin
    .from('exceptions')
    .select('id, type, reference_id, status')
    .eq('id', exceptionId)
    .single();
  if (exErr || !exception) throw exErr ?? new AppError('Exception not found', 404);
  if (exception.status !== 'pending') throw new AppError('Exception already decided', 409);

  if (actorRole === 'admin') {
    // allowed
  } else if (actorRole === 'pm' && actorDepartment) {
    if (exception.type === 'over_budget') {
      if (actorDepartment !== 'finance') {
        throw new AppError('Only finance department PMs (or admin) may decide over-budget exceptions', 403);
      }
    } else if (exception.type === 'no_po') {
      await assertPmMayDecideNoPo({ projectId: exception.reference_id, actorDepartment });
    } else {
      throw new AppError('Unknown exception type', 400);
    }
  } else {
    throw new AppError('Not authorized to decide this exception', 403);
  }

  const { error: updErr } = await supabaseAdmin.from('exceptions').update({
    status: decision,
    approved_by: actorUserId,
  }).eq('id', exceptionId);
  if (updErr) throw updErr;

  if (exception.type === 'no_po') {
    const { data: project, error: prjErr } = await supabaseAdmin
      .from('projects')
      .select('id, created_by, status, is_exception')
      .eq('id', exception.reference_id)
      .single();
    if (prjErr || !project) throw prjErr ?? new AppError('Referenced project not found', 404);

    if (decision === 'approved') {
      const { error: prjUpErr } = await supabaseAdmin.from('projects').update({
        status: 'active',
      }).eq('id', project.id);
      if (prjUpErr) throw prjUpErr;

      await notifyUser({
        userId: project.created_by,
        type: 'exception_no_po_approved',
        message: `No-PO exception approved for project ${project.id}. You can now submit purchase requests.`,
        emailSubject: 'No-PO Exception Approved',
      });

      await writeAuditLog({
        action: 'exception_no_po_approved',
        userId: actorUserId,
        entity: 'exception',
        entityId: exception.id,
      });
    } else {
      await supabaseAdmin.from('projects').update({ status: 'rejected' }).eq('id', project.id);
      await notifyUser({
        userId: project.created_by,
        type: 'exception_no_po_rejected',
        message: `No-PO exception rejected for project ${project.id}.`,
        emailSubject: 'No-PO Exception Rejected',
      });
      await writeAuditLog({
        action: 'exception_no_po_rejected',
        userId: actorUserId,
        entity: 'exception',
        entityId: exception.id,
      });
    }

    return { ok: true, exceptionId: exception.id };
  }

  if (exception.type === 'over_budget') {
    const { data: pr, error: prErr } = await supabaseAdmin
      .from('purchase_requests')
      .select('id, amount, project_id, created_by, status')
      .eq('id', exception.reference_id)
      .single();
    if (prErr || !pr) throw prErr ?? new AppError('Referenced purchase request not found', 404);

    if (decision === 'approved') {
      const { error: prUpErr } = await supabaseAdmin.from('purchase_requests').update({ status: 'pending' }).eq('id', pr.id);
      if (prUpErr) throw prUpErr;

      await notifyUser({
        userId: pr.created_by,
        type: 'exception_over_budget_approved',
        message: `Over-budget exception approved for PR ${pr.id}.`,
        emailSubject: 'Over-Budget Exception Approved',
      });

      await startApprovalsForPurchaseRequest(pr.id, actorUserId);

      await writeAuditLog({
        action: 'exception_over_budget_approved',
        userId: actorUserId,
        entity: 'exception',
        entityId: exception.id,
      });
    } else {
      await supabaseAdmin.from('purchase_requests').update({ status: 'rejected' }).eq('id', pr.id);
      await supabaseAdmin
        .from('approvals')
        .update({ status: 'rejected', comments: 'Auto-rejected due to over-budget exception rejection' })
        .eq('request_id', pr.id);
      await notifyUser({
        userId: pr.created_by,
        type: 'exception_over_budget_rejected',
        message: `Over-budget exception rejected for PR ${pr.id}.`,
        emailSubject: 'Over-Budget Exception Rejected',
      });
      await writeAuditLog({
        action: 'exception_over_budget_rejected',
        userId: actorUserId,
        entity: 'exception',
        entityId: exception.id,
      });
    }

    return { ok: true, exceptionId: exception.id };
  }

  throw new AppError('Unknown exception type', 400);
}
