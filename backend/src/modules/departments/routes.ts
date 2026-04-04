import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { supabaseAdmin } from '../../config/supabase';

export const departmentsRouter = Router();

departmentsRouter.use(requireAuth);

departmentsRouter.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('departments')
      .select('code, display_name')
      .order('display_name', { ascending: true });
    if (error) throw error;
    res.json({ departments: data ?? [] });
  } catch (err) {
    next(err);
  }
});
