import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { supabaseAdmin } from '../../config/supabase';
export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get('/', async (_req, res, next) => {
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

    res.json({
      projects: projectsCount ?? 0,
      pendingApprovals: pendingApprovalsCount ?? 0,
      pendingExceptions: pendingExceptionsCount ?? 0,
      poRecords: poRecordsCount ?? 0,
    });
  } catch (err) {
    next(err);
  }
});
