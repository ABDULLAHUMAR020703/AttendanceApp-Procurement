import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { z } from 'zod';
import { decideApproval } from './engine';
import { supabaseAdmin } from '../../config/supabase';

export const approvalsRouter = Router();

approvalsRouter.use(requireAuth);

const DecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comments: z.string().min(1).max(2000).optional(),
});

approvalsRouter.get('/', requireRole('admin', 'team_lead', 'pm', 'finance', 'gm'), async (req, res, next) => {
  try {
    const userId = req.auth!.userId;
    const { data, error } = await supabaseAdmin
      .from('approvals')
      .select('id, request_id, approver_id, role, status, comments, created_at')
      .eq('approver_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ approvals: data ?? [] });
  } catch (err) {
    next(err);
  }
});

approvalsRouter.post(
  '/:id/decision',
  requireRole('admin', 'team_lead', 'pm', 'finance', 'gm'),
  async (req, res, next) => {
    try {
      const approvalId = req.params.id as string;
      const parsed = DecisionSchema.parse(req.body);

      const result = await decideApproval({
        approvalId,
        decision: parsed.decision,
        comments: parsed.comments ?? null,
        actorUserId: req.auth!.userId,
      });

      res.json({ ok: true, result });
    } catch (err) {
      next(err);
    }
  },
);

