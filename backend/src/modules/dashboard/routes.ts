import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { supabaseAdmin } from '../../config/supabase';
import { bypassesDepartmentScope } from '../auth/types';
import { fetchActivityFeed } from './service';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get('/', async (req, res, next) => {
  try {
    const [
      { count: projectsCount, error: projectsErr },
      { count: pendingApprovalsCount, error: approvalsErr },
      { count: pendingExceptionsCount, error: exceptionsErr },
      { count: poRecordsCount, error: poErr },
    ] = await Promise.all([
      supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }),
      supabaseAdmin
        .from('approvals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabaseAdmin
        .from('exceptions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabaseAdmin.from('purchase_orders').select('*', { count: 'exact', head: true }),
    ]);

    if (projectsErr) throw projectsErr;
    if (approvalsErr) throw approvalsErr;
    if (exceptionsErr) throw exceptionsErr;
    if (poErr) throw poErr;

    const role = req.auth!.role;
    const actorDepartment = req.auth!.department ?? null;
    const filterDeptRaw = typeof req.query.department === 'string' ? req.query.department.trim() : '';
    const filterDepartment = bypassesDepartmentScope(role) && filterDeptRaw ? filterDeptRaw : null;

    const activityFeed = await fetchActivityFeed({
      limit: 50,
      actorRole: role,
      actorDepartment,
      filterDepartment,
    });

    const head = activityFeed[0] ?? null;
    const lastSystemUpdate = head
      ? {
          last_updated_at: head.timestamp,
          last_updated_by: head.actor,
          action: head.action,
          entity_type: head.entity_type,
          entity_id: head.entity_id,
        }
      : null;

    res.json({
      projects: projectsCount ?? 0,
      pendingApprovals: pendingApprovalsCount ?? 0,
      pendingExceptions: pendingExceptionsCount ?? 0,
      poRecords: poRecordsCount ?? 0,
      lastSystemUpdate,
      activityFeed,
    });
  } catch (err) {
    next(err);
  }
});
