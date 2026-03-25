import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { supabaseAdmin } from '../../config/supabase';

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('users').select('id,name,email,role,department,created_at').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ users: data ?? [] });
  } catch (err) {
    next(err);
  }
});

