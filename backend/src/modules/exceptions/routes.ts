import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { supabaseAdmin } from '../../config/supabase';
import { z } from 'zod';
import { decideException } from './service';

export const exceptionsRouter = Router();

exceptionsRouter.use(requireAuth);

exceptionsRouter.get('/', requireRole('admin', 'dept_head', 'finance', 'gm'), async (req, res, next) => {
  try {
    const role = req.auth!.role;
    let q = supabaseAdmin.from('exceptions').select('id, type, reference_id, status, approved_by, created_at');
    q = q.eq('status', 'pending').order('created_at', { ascending: false });

    if (role === 'dept_head') q = q.eq('type', 'no_po');
    if (role === 'finance') q = q.eq('type', 'over_budget');

    const { data, error } = await q.limit(100);
    if (error) throw error;
    res.json({ exceptions: data ?? [] });
  } catch (err) {
    next(err);
  }
});

const ExceptionActionSchema = z.object({
  reason: z.string().max(2000).optional(),
});

exceptionsRouter.post('/:id/approve', requireRole('admin', 'dept_head', 'finance', 'gm'), async (req, res, next) => {
  try {
    const exceptionId = req.params.id as string;
    ExceptionActionSchema.parse(req.body ?? {});
    const result = await decideException({ exceptionId, decision: 'approved', actorUserId: req.auth!.userId });
    res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
});

exceptionsRouter.post('/:id/reject', requireRole('admin', 'dept_head', 'finance', 'gm'), async (req, res, next) => {
  try {
    const exceptionId = req.params.id as string;
    ExceptionActionSchema.parse(req.body ?? {});
    const result = await decideException({ exceptionId, decision: 'rejected', actorUserId: req.auth!.userId });
    res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
});

