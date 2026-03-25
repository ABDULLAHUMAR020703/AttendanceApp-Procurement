import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { writeAuditLog } from '../auditLogs/service';
import { createInAppNotification, enqueueEmailPlaceholder, getUserEmail } from '../notifications/service';
import { startApprovalsForPurchaseRequest } from '../approvals/engine';
import type { UserRole } from '../auth/types';

type ExceptionType = 'no_po' | 'over_budget';

function requiredApproverRole(type: ExceptionType): UserRole {
  if (type === 'no_po') return 'dept_head';
  return 'finance';
}

async function notifyUser(params: { userId: string; type: string; message: string; emailSubject: string }) {
  await createInAppNotification({ userId: params.userId, type: params.type, message: params.message });
  const email = await getUserEmail(params.userId);
  if (email) {
    await enqueueEmailPlaceholder({ toEmail: email, subject: params.emailSubject, body: params.message });
  }
}

export async function decideException(params: {
  exceptionId: string;
  decision: 'approved' | 'rejected';
  actorUserId: string;
}) {
  const { exceptionId, decision, actorUserId } = params;

  const { data: exception, error: exErr } = await supabaseAdmin
    .from('exceptions')
    .select('id, type, reference_id, status')
    .eq('id', exceptionId)
    .single();
  if (exErr || !exception) throw exErr ?? new AppError('Exception not found', 404);
  if (exception.status !== 'pending') throw new AppError('Exception already decided', 409);

  // Validate actor role
  const { data: actorProfile, error: actorErr } = await supabaseAdmin
    .from('users')
    .select('id, role, department')
    .eq('id', actorUserId)
    .single();
  if (actorErr || !actorProfile) throw actorErr ?? new AppError('Actor not found', 404);

  const requiredRole = requiredApproverRole(exception.type as ExceptionType);
  if (actorProfile.role !== requiredRole && actorProfile.role !== 'admin' && actorProfile.role !== 'gm') {
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

  // over_budget
  if (exception.type === 'over_budget') {
    const { data: pr, error: prErr } = await supabaseAdmin
      .from('purchase_requests')
      .select('id, amount, project_id, created_by, status')
      .eq('id', exception.reference_id)
      .single();
    if (prErr || !pr) throw prErr ?? new AppError('Referenced purchase request not found', 404);

    if (decision === 'approved') {
      // Resume main flow: move PR to pending and start approvals.
      const { error: prUpErr } = await supabaseAdmin
        .from('purchase_requests')
        .update({ status: 'pending' })
        .eq('id', pr.id);
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

