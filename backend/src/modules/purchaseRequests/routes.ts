import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { z } from 'zod';
import { createPurchaseRequest } from './service';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';

export const purchaseRequestsRouter = Router();

purchaseRequestsRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

purchaseRequestsRouter.post(
  '/',
  requireRole('admin', 'pm', 'employee'),
  upload.single('document'),
  async (req, res, next) => {
    try {
      const Schema = z.object({
        project_id: z.string().uuid(),
        description: z.string().trim().min(10, 'Description must be at least 10 characters').max(5000),
        amount: z.coerce.number().positive(),
      });
      const parsed = Schema.parse(req.body);

      const actorDepartment = req.auth!.department ?? null;

      const result = await createPurchaseRequest({
        projectId: parsed.project_id,
        description: parsed.description,
        amount: Number(parsed.amount),
        documentFile: req.file
          ? {
              buffer: req.file.buffer,
              originalName: req.file.originalname,
              mimeType: req.file.mimetype,
            }
          : null,
        createdBy: req.auth!.userId,
        actorRole: req.auth!.role,
        actorDepartment,
      });

      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  },
);

purchaseRequestsRouter.get(
  '/',
  requireRole('admin', 'pm', 'employee'),
  async (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const role = req.auth!.role;

      const select = 'id, project_id, description, amount, document_url, status, created_by, created_at';

      if (role === 'admin') {
        const { data, error } = await supabaseAdmin
          .from('purchase_requests')
          .select(select)
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        return res.json({ purchaseRequests: data ?? [] });
      }

      const { data: created, error: createdErr } = await supabaseAdmin
        .from('purchase_requests')
        .select(select)
        .eq('created_by', userId);
      if (createdErr) throw createdErr;

      const { data: approvalReqIds, error: approvalsErr } = await supabaseAdmin
        .from('approvals')
        .select('request_id')
        .eq('approver_id', userId)
        .eq('status', 'pending');
      if (approvalsErr) throw approvalsErr;

      const ids = (approvalReqIds ?? []).map((r) => r.request_id as string);
      const { data: pendingApprovals, error: pendingErr } = ids.length
        ? await supabaseAdmin.from('purchase_requests').select(select).in('id', ids)
        : { data: [] as unknown[], error: null as unknown as any };
      if (pendingErr) throw pendingErr;

      const map = new Map<string, any>();
      for (const pr of (created ?? []) as any[]) map.set(pr.id as string, pr);
      for (const pr of (pendingApprovals ?? []) as any[]) map.set(pr.id as string, pr);

      const merged = [...map.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 100);
      res.json({ purchaseRequests: merged });
    } catch (err) {
      next(err);
    }
  },
);

purchaseRequestsRouter.get(
  '/:id',
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const requestId = req.params.id as string;
      if (!requestId) throw new AppError('Missing purchase request id', 400);

      // Debug logs (temporary, can be removed after issue is resolved).
      // eslint-disable-next-line no-console
      console.log('PR ID:', requestId);

      const { data: pr, error: prErr } = await supabaseAdmin
        .from('purchase_requests')
        .select('id, project_id, description, amount, document_url, status, created_by, created_at')
        .eq('id', requestId)
        .maybeSingle();

      // eslint-disable-next-line no-console
      console.log('PR ERROR:', prErr);

      if (prErr) {
        // eslint-disable-next-line no-console
        console.error('Supabase error:', prErr);
        throw new AppError('Failed to fetch purchase request', 500);
      }
      if (!pr) throw new AppError('Purchase request not found', 404);

      // eslint-disable-next-line no-console
      console.log('PR DATA:', pr);

      // Fetch related rows safely (missing joins should not crash).
      const [creatorRes, projectRes, approvalsRes] = await Promise.all([
        supabaseAdmin.from('users').select('id, name, email, role, department').eq('id', pr.created_by).maybeSingle(),
        pr.project_id
          ? supabaseAdmin
              .from('projects')
              .select('id, name, po_id, budget, status, is_exception, created_by, created_at, department, team_lead_id')
              .eq('id', pr.project_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabaseAdmin
          .from('approvals')
          .select('id, request_id, approver_id, role, status, comments, created_at')
          .eq('request_id', pr.id)
          .order('created_at', { ascending: true }),
      ]);

      const creator = creatorRes.data ?? null;
      const project = projectRes.data ?? null;
      const approvals = approvalsRes.data ?? [];

      if (approvalsRes.error) throw approvalsRes.error;

      const poId = project?.po_id ?? null;
      let po: any = null;
      if (poId) {
        const { data, error } = await supabaseAdmin
          .from('purchase_orders')
          .select('id, po_number, vendor, total_value, remaining_value')
          .eq('id', poId)
          .maybeSingle();
        // If PO missing, keep null.
        if (error) po = null;
        po = data ?? null;
      }

      const referenceIds: string[] = [pr.id];
      if (project?.id) referenceIds.push(project.id);
      const { data: exceptions, error: exErr } = await supabaseAdmin
        .from('exceptions')
        .select('id, type, reference_id, status, approved_by, created_at')
        .in('reference_id', referenceIds)
        .order('created_at', { ascending: true });
      if (exErr) {
        // Exceptions are optional for UI display; do not crash if they are missing/mislinked.
        // eslint-disable-next-line no-console
        console.error('[purchase-requests/:id] exceptions fetch failed', exErr);
      }

      // Audit logs: avoid .or string parsing issues; merge two queries.
      const auditSelect = 'id, action, user_id, entity, entity_id, reason, timestamp';
      const { data: auditForPr, error: auditPrErr } = await supabaseAdmin
        .from('audit_logs')
        .select(auditSelect)
        .eq('entity_id', pr.id)
        .order('timestamp', { ascending: false })
        .limit(200);
      if (auditPrErr) {
        // eslint-disable-next-line no-console
        console.error('[purchase-requests/:id] audit logs (PR) fetch failed', auditPrErr);
      }

      let auditForProject: any[] = [];
      if (project?.id) {
        const { data: auditTmp, error: auditProjectErr } = await supabaseAdmin
          .from('audit_logs')
          .select(auditSelect)
          .eq('entity_id', project.id)
          .order('timestamp', { ascending: false })
          .limit(200);
        if (auditProjectErr) {
          // eslint-disable-next-line no-console
          console.error('[purchase-requests/:id] audit logs (Project) fetch failed', auditProjectErr);
        } else {
          auditForProject = (auditTmp as any[]) ?? [];
        }
      }

      const auditLogs = [...(auditForPr ?? []), ...auditForProject].sort(
        (a, b) => String(b.timestamp).localeCompare(String(a.timestamp)),
      );

      const approverIds = [...new Set((approvals ?? []).map((a) => a.approver_id as string))];
      const { data: approverProfiles, error: approverErr } = approverIds.length
        ? await supabaseAdmin.from('users').select('id, name, email, role').in('id', approverIds)
        : { data: [], error: null };
      if (approverErr) throw approverErr;

      const approverMap = new Map((approverProfiles ?? []).map((u: any) => [u.id as string, u]));
      const enrichedApprovals = (approvals ?? []).map((a) => ({
        ...a,
        approver: approverMap.get(a.approver_id as string) ?? null,
      }));

      const currentStage = enrichedApprovals.find((a) => a.status === 'pending')?.role ?? null;

      res.json({
        purchaseRequest: pr ? {
          id: pr.id,
          title: pr.description,
          description: pr.description,
          amount: pr.amount,
          status: pr.status,
          createdAt: pr.created_at,
          documentUrl: pr.document_url,
          currentStage,
          createdBy: creator,
        } : null,
        project,
        purchaseOrder: po,
        approvals: enrichedApprovals,
        exceptions: exceptions ?? [],
        auditLogs,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[purchase-requests/:id] Failed to fetch', err);
      next(err);
    }
  },
);

