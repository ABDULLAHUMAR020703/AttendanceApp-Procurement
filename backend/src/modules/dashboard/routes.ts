import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

const PROJECT_FULL_VISIBILITY_ROLES = new Set(['admin', 'pm', 'team_lead', 'finance', 'dept_head', 'gm']);

dashboardRouter.get('/', async (req, res, next) => {
  try {
    const role = req.auth!.role;
    const userId = req.auth!.userId;

    let projectsQuery = supabaseAdmin
      .from('projects')
      .select('id')
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(20);
    if (!PROJECT_FULL_VISIBILITY_ROLES.has(role)) {
      projectsQuery = projectsQuery.eq('created_by', userId);
    }

    // Enterprise-grade implementations typically do per-role optimized queries.
    // We keep it simple here while still returning real aggregated data.
    const [{ data: projects }, { data: pendingApprovals }, { data: pendingExceptions }, { data: poUtil }] = await Promise.all([
      projectsQuery,
      supabaseAdmin.from('approvals').select('id').eq('approver_id', userId).eq('status', 'pending').limit(50),
      supabaseAdmin.from('exceptions').select('id').eq('status', 'pending').limit(50),
      supabaseAdmin.from('purchase_orders').select('id, total_value, remaining_value').limit(200),
    ]);

    if (!projects || !pendingApprovals || !pendingExceptions || !poUtil) throw new AppError('Failed to build dashboard', 500);

    res.json({
      role,
      projects: projects ?? [],
      pendingApprovals: pendingApprovals ?? [],
      pendingExceptions: pendingExceptions ?? [],
      poUtilization: poUtil ?? [],
    });
  } catch (err) {
    next(err);
  }
});

