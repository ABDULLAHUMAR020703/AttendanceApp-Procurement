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
  requireRole('admin', 'pm', 'team_lead'),
  upload.single('document'),
  async (req, res, next) => {
    try {
      const Schema = z.object({
        project_id: z.string().uuid(),
        description: z.string().min(1).max(5000),
        amount: z.coerce.number().positive(),
      });
      const parsed = Schema.parse(req.body);

      if (!req.file) throw new AppError('Missing document upload field `document`', 400);

      const actorDepartment = req.auth!.department ?? null;

      const result = await createPurchaseRequest({
        projectId: parsed.project_id,
        description: parsed.description,
        amount: Number(parsed.amount),
        documentFile: {
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
        },
        createdBy: req.auth!.userId,
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
  requireRole('admin', 'pm', 'team_lead', 'finance', 'dept_head', 'gm'),
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

