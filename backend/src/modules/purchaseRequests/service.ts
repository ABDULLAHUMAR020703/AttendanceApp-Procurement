import { env } from '../../config/env';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { startApprovalsForPurchaseRequest } from '../approvals/engine';
import { writeAuditLog } from '../auditLogs/service';
import { createInAppNotification, enqueueEmailPlaceholder, getUserEmail } from '../notifications/service';
import type { UserRole } from '../auth/types';

async function notifyUser(params: { userId: string; type: string; message: string; emailSubject: string }) {
  await createInAppNotification({ userId: params.userId, type: params.type, message: params.message });
  const email = await getUserEmail(params.userId);
  if (email) {
    await enqueueEmailPlaceholder({ toEmail: email, subject: params.emailSubject, body: params.message });
  }
}

export async function createPurchaseRequest(params: {
  projectId: string;
  description: string;
  amount: number;
  documentFile?: { buffer: Buffer; originalName: string; mimeType: string } | null;
  createdBy: string;
  actorRole: UserRole;
  actorDepartment?: string | null;
}) {
  const { projectId, description, amount, documentFile, createdBy, actorRole, actorDepartment } = params;

  if (!description.trim()) throw new AppError('Description is required', 400);
  if (description.trim().length < 10) throw new AppError('Description must be at least 10 characters', 400);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('amount must be > 0', 400);

  const { data: project, error: prjErr } = await supabaseAdmin
    .from('projects')
    .select('id, po_id, budget, status, created_by, department')
    .eq('id', projectId)
    .single();
  if (prjErr || !project) throw prjErr ?? new AppError('Project not found', 404);

  if (actorRole !== 'admin') {
    if (!actorDepartment || actorDepartment !== project.department) {
      throw new AppError('Purchase requests can only be submitted for projects in your department', 403);
    }
  }

  if (project.status !== 'active') {
    throw new AppError(`Project is not active (status=${project.status}). Submit is blocked until exceptions are approved.`, 409);
  }

  // Financial validation before upload (avoid storing documents for invalid requests)
  let remainingValue = Number(project.budget);
  if (project.po_id) {
    const { data: po, error: poErr } = await supabaseAdmin
      .from('purchase_orders')
      .select('remaining_value')
      .eq('id', project.po_id)
      .single();
    if (poErr || !po) throw poErr ?? new AppError('PO not found', 404);
    remainingValue = Number(po.remaining_value);
  }

  const reqAmount = Number(amount);
  if (reqAmount > remainingValue) {
    throw new AppError('Requested amount exceeds available budget', 400, {
      error: 'Over budget',
      message: 'Requested amount exceeds available budget',
      available_budget: remainingValue,
      requested_amount: reqAmount,
    });
  }

  let documentUrl: string | null = null;
  if (documentFile?.buffer) {
    const bucket = env.SUPABASE_STORAGE_BUCKET_DOCUMENTS;
    const safeExt = documentFile.originalName.includes('.')
      ? documentFile.originalName.slice(documentFile.originalName.lastIndexOf('.'))
      : '';
    const path = `pr-documents/${projectId}/${Date.now()}-${createdBy}${safeExt}`.replace(/\\/g, '/');

    const { error: upErr } = await supabaseAdmin.storage.from(bucket).upload(path, documentFile.buffer, {
      contentType: documentFile.mimeType,
      upsert: true,
    });
    if (upErr) throw upErr;
    documentUrl = `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  }

  const prPayload = {
    project_id: project.id,
    description: description.trim(),
    amount: reqAmount,
    document_url: documentUrl,
    created_by: createdBy,
  };

  // Within remaining: create PR and start approval workflow
  const { data: pr, error: prInsErr } = await supabaseAdmin
    .from('purchase_requests')
    .insert({ ...prPayload, status: 'pending' })
    .select('id, status, amount, project_id, created_by')
    .single();
  if (prInsErr || !pr) throw prInsErr ?? new AppError('Failed to create purchase request', 500);

  await writeAuditLog({
    action: 'purchase_request_created',
    userId: createdBy,
    entity: 'purchase_request',
    entityId: pr.id,
  });

  await notifyUser({
    userId: createdBy,
    type: 'pr_created',
    message: `Your Purchase Request ${pr.id} was submitted and is now pending approvals.`,
    emailSubject: 'PR Created',
  });

  await startApprovalsForPurchaseRequest(pr.id, createdBy);

  return { pr };
}

