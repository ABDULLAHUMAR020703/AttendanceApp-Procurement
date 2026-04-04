import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { z } from 'zod';
import { countPreviousPrsForSameItem, createPurchaseRequest, normalizeItemCode } from './service';
import {
  buildPrPoLineSummary,
  enrichPurchaseRequestsWithPoLine,
  loadAnchorsForProjectIds,
} from './poLineContext';
import { loadEmployeeVisibleProjectIds } from '../projects/projectAccess';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';

export const purchaseRequestsRouter = Router();

async function withPoLineSummaries(rows: Record<string, unknown>[]) {
  if (!rows.length) return rows;
  const map = await enrichPurchaseRequestsWithPoLine(
    rows.map((r) => ({
      id: r.id as string,
      project_id: r.project_id as string,
      description: r.description as string,
      amount: r.amount as number | string,
      item_code: (r.item_code as string | null) ?? null,
      po_line_id: (r.po_line_id as string | null) ?? null,
      requested_quantity: (r.requested_quantity as number | string | null) ?? null,
      status: r.status as string,
    })),
  );
  return rows.map((r) => ({ ...r, po_line_summary: map.get(r.id as string) ?? null }));
}

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
        item_code: z.string().max(256).optional(),
        po_line_sn: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().max(512).optional()),
        requested_quantity: z.preprocess(
          (v) => (v === '' || v == null ? undefined : v),
          z.coerce.number().positive().optional(),
        ),
      });
      const parsed = Schema.parse(req.body);

      const actorDepartment = req.auth!.department ?? null;

      const result = await createPurchaseRequest({
        projectId: parsed.project_id,
        description: parsed.description,
        amount: Number(parsed.amount),
        itemCode: parsed.item_code?.trim() ? parsed.item_code.trim() : null,
        poLineSn: parsed.po_line_sn?.trim() ? parsed.po_line_sn.trim() : null,
        requestedQuantity: parsed.requested_quantity != null ? Number(parsed.requested_quantity) : null,
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

      const select =
        'id, project_id, description, amount, document_url, item_code, duplicate_count, po_line_id, requested_quantity, budget_deducted, status, created_by, created_at';

      if (role === 'admin') {
        const { data, error } = await supabaseAdmin
          .from('purchase_requests')
          .select(select)
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        const enriched = await withPoLineSummaries((data ?? []) as Record<string, unknown>[]);
        return res.json({ purchaseRequests: enriched });
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

      let byProject: unknown[] = [];
      if (role === 'employee' && req.auth!.department) {
        const visible = await loadEmployeeVisibleProjectIds({
          userId,
          department: req.auth!.department,
        });
        if (visible.length > 0) {
          const { data: prProj, error: prProjErr } = await supabaseAdmin
            .from('purchase_requests')
            .select(select)
            .in('project_id', visible)
            .order('created_at', { ascending: false })
            .limit(100);
          if (prProjErr) throw prProjErr;
          byProject = prProj ?? [];
        }
      }

      const map = new Map<string, any>();
      for (const pr of (created ?? []) as any[]) map.set(pr.id as string, pr);
      for (const pr of (pendingApprovals ?? []) as any[]) map.set(pr.id as string, pr);
      for (const pr of byProject as any[]) map.set(pr.id as string, pr);

      const merged = [...map.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 100);
      const enriched = await withPoLineSummaries(merged as Record<string, unknown>[]);
      res.json({ purchaseRequests: enriched });
    } catch (err) {
      next(err);
    }
  },
);

purchaseRequestsRouter.get(
  '/item-duplicate-count',
  requireRole('admin', 'pm', 'employee'),
  async (req, res, next) => {
    try {
      const q = z
        .object({
          item_code: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().min(1).max(256)),
        })
        .safeParse(req.query);
      if (!q.success) throw new AppError('item_code query parameter is required', 400);
      const norm = normalizeItemCode(q.data.item_code);
      if (!norm) {
        return res.json({ previousCount: 0 });
      }
      const previousCount = await countPreviousPrsForSameItem(req.auth!.userId, norm);
      res.json({ previousCount });
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

      const { data: pr, error: prErr } = await supabaseAdmin
        .from('purchase_requests')
        .select(
          'id, project_id, description, amount, document_url, item_code, duplicate_count, po_line_id, requested_quantity, budget_deducted, status, created_by, created_at, updated_at, updated_by',
        )
        .eq('id', requestId)
        .maybeSingle();

      if (prErr) throw new AppError('Failed to fetch purchase request', 500);
      if (!pr) throw new AppError('Purchase request not found', 404);

      const prUpdatedBy = (pr as { updated_by?: string | null }).updated_by ?? null;

      // Fetch related rows safely (missing joins should not crash).
      const [creatorRes, updaterRes, projectRes, approvalsRes] = await Promise.all([
        supabaseAdmin.from('users').select('id, name, email, role, department').eq('id', pr.created_by).maybeSingle(),
        prUpdatedBy
          ? supabaseAdmin.from('users').select('id, name, email, role, department').eq('id', prUpdatedBy).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        pr.project_id
          ? supabaseAdmin
              .from('projects')
              .select(
                'id, name, po_id, budget, status, is_exception, created_by, created_at, department, team_lead_id, updated_at, updated_by',
              )
              .eq('id', pr.project_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabaseAdmin
          .from('approvals')
          .select('id, request_id, approver_id, role, status, comments, created_at, updated_at, updated_by, is_admin_override')
          .eq('request_id', pr.id)
          .order('created_at', { ascending: true }),
      ]);

      const creator = creatorRes.data ?? null;
      const updater = updaterRes.data ?? null;
      const project = projectRes.data ?? null;
      const approvals = approvalsRes.data ?? [];

      if (approvalsRes.error) throw approvalsRes.error;

      const poId = project?.po_id ?? null;
      let po: any = null;
      if (poId) {
        const { data, error } = await supabaseAdmin
          .from('purchase_orders')
          .select('id, po_number, vendor, total_value, remaining_value, updated_at, updated_by')
          .eq('id', poId)
          .maybeSingle();
        // If PO missing, keep null.
        if (error) po = null;
        po = data ?? null;
      }

      const projUpId = project ? (project as { updated_by?: string | null }).updated_by : null;
      const poUpId = po ? (po as { updated_by?: string | null }).updated_by : null;
      const touchIds = [...new Set([projUpId, poUpId].filter(Boolean))] as string[];
      let touchMap = new Map<string, { id: string; name: string; email: string; role: string }>();
      if (touchIds.length > 0) {
        const { data: tu, error: tuErr } = await supabaseAdmin
          .from('users')
          .select('id, name, email, role')
          .in('id', touchIds);
        if (tuErr) throw tuErr;
        touchMap = new Map((tu ?? []).map((u) => [u.id as string, u as { id: string; name: string; email: string; role: string }]));
      }

      const projectPayload = project
        ? {
            ...project,
            updatedBy: projUpId ? touchMap.get(projUpId) ?? null : null,
          }
        : null;
      const poPayload = po
        ? {
            ...po,
            updatedBy: poUpId ? touchMap.get(poUpId) ?? null : null,
          }
        : null;

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
      const auditSelect = 'id, action, user_id, entity, entity_type, entity_id, reason, changes, timestamp';
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
          .eq('entity_type', 'project')
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

      const currentStage =
        enrichedApprovals.find(
          (a) => a.status === 'pending' && (a.role === 'team_lead' || a.role === 'pm'),
        )?.role ?? null;

      const anchors = pr.project_id ? await loadAnchorsForProjectIds([pr.project_id as string]) : new Map();
      const anchor = pr.project_id ? anchors.get(pr.project_id as string) ?? null : null;
      const poLineSummary = await buildPrPoLineSummary(
        {
          id: pr.id as string,
          description: pr.description as string,
          amount: pr.amount as number,
          item_code: ((pr as { item_code?: string | null }).item_code ?? null) as string | null,
          po_line_id: ((pr as { po_line_id?: string | null }).po_line_id ?? null) as string | null,
          requested_quantity: (pr as { requested_quantity?: number | string | null }).requested_quantity ?? null,
          status: pr.status as string,
        },
        anchor,
      );

      res.json({
        purchaseRequest: pr
          ? {
              id: pr.id,
              title: pr.description,
              description: pr.description,
              amount: pr.amount,
              status: pr.status,
              createdAt: pr.created_at,
              updatedAt: (pr as { updated_at?: string }).updated_at ?? pr.created_at,
              updatedBy: updater ?? creator,
              documentUrl: pr.document_url,
              itemCode: (pr as { item_code?: string | null }).item_code ?? null,
              duplicateCount: Number((pr as { duplicate_count?: number | null }).duplicate_count ?? 1),
              poLineSummary,
              currentStage,
              createdBy: creator,
            }
          : null,
        project: projectPayload,
        purchaseOrder: poPayload,
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

