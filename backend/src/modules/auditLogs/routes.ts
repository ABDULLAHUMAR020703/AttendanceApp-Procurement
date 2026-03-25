import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { supabaseAdmin } from '../../config/supabase';

export const auditLogsRouter = Router();

auditLogsRouter.use(requireAuth);

auditLogsRouter.get('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { action, entity } = req.query;
    let q = supabaseAdmin
      .from('audit_logs')
      .select('id, action, user_id, entity, entity_id, timestamp')
      .order('timestamp', { ascending: false });
    if (typeof action === 'string') q = q.eq('action', action);
    if (typeof entity === 'string') q = q.eq('entity', entity);

    const { data, error } = await q;
    if (error) throw error;
    res.json({ auditLogs: data ?? [] });
  } catch (err) {
    next(err);
  }
});

