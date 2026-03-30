import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { archiveProject, createProjectWithExceptionFlow, updateProjectTeamLead } from './service';

export const projectsRouter = Router();

projectsRouter.use(requireAuth);

const DepartmentSchema = z.enum([
  'sales',
  'hr',
  'technical',
  'finance',
  'engineering',
  'management',
  'ibs',
  'power',
  'civil_works',
  'bss_wireless',
  'fixed_network',
  'warehouse',
]);

projectsRouter.post('/', requireRole('admin', 'pm'), async (req, res, next) => {
  try {
    const Schema = z.object({
      name: z.string().min(1).max(200),
      po_id: z.string().uuid().optional().nullable(),
      budget: z.coerce.number().positive().optional(),
      department: DepartmentSchema.optional(),
      team_lead_id: z.string().uuid().optional().nullable(),
    });
    const parsed = Schema.parse(req.body);

    const actorUserId = req.auth!.userId;
    const actorDepartment = req.auth!.department ?? null;
    const actorRole = req.auth!.role;

    const noPo = !parsed.po_id;
    const budget = noPo ? parsed.budget : parsed.budget;
    if (noPo && (!budget || Number(budget) <= 0)) throw new AppError('Budget is required when creating a project without a PO', 400);

    const result = await createProjectWithExceptionFlow({
      name: parsed.name,
      poId: parsed.po_id ?? null,
      budget: Number(budget ?? 0),
      createdBy: actorUserId,
      actorRole,
      actorDepartment,
      department: parsed.department ?? null,
      teamLeadId: parsed.team_lead_id ?? null,
    });

    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

projectsRouter.patch(
  '/:id/team-lead',
  requireRole('admin', 'pm'),
  async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const Body = z.object({
        team_lead_id: z.string().uuid().nullable(),
      });
      const parsed = Body.parse(req.body);
      const result = await updateProjectTeamLead({
        projectId: id,
        teamLeadId: parsed.team_lead_id,
        actorUserId: req.auth!.userId,
        actorRole: req.auth!.role,
        actorDepartment: req.auth!.department ?? null,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

projectsRouter.get('/', requireRole('admin', 'pm', 'employee'), async (req, res, next) => {
  try {
    const role = req.auth!.role;
    const dept = req.auth!.department ?? null;

    let q = supabaseAdmin
      .from('projects')
      .select(
        'id, name, po_id, budget, status, is_exception, created_by, created_at, department, team_lead_id',
      )
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(100);

    if (role !== 'admin') {
      if (!dept) throw new AppError('User profile must include a department', 400);
      q = q.eq('department', dept);
    }

    const { data: projects, error } = await q;
    if (error) throw error;

    const list = projects ?? [];
    const poIds = [...new Set(list.map((p) => p.po_id).filter((pid): pid is string => !!pid))];
    let poMap = new Map<string, { total_value: number; remaining_value: number }>();
    if (poIds.length > 0) {
      const { data: pos, error: poErr } = await supabaseAdmin
        .from('purchase_orders')
        .select('id, total_value, remaining_value')
        .in('id', poIds);
      if (poErr) throw poErr;
      poMap = new Map(
        (pos ?? []).map((row) => [
          row.id,
          { total_value: Number(row.total_value), remaining_value: Number(row.remaining_value) },
        ]),
      );
    }

    const enriched = list.map((p) => ({
      ...p,
      purchase_order: p.po_id ? poMap.get(p.po_id) ?? null : null,
    }));

    res.json({ projects: enriched });
  } catch (err) {
    next(err);
  }
});

projectsRouter.delete('/:id', requireRole('admin', 'pm'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const result = await archiveProject({
      projectId: id,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorDepartment: req.auth!.department ?? null,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
