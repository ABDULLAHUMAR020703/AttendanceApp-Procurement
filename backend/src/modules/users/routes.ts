import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { supabaseAdmin } from '../../config/supabase';
import { z } from 'zod';
import { AppError } from '../../utils/errors';
import { bypassesDepartmentScope } from '../auth/types';
import { assertDepartmentExists } from '../departments/service';

export const usersRouter = Router();

usersRouter.use(requireAuth);

const DepartmentCodeSchema = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);
const RoleSchema = z.enum(['admin', 'pm', 'dept_head', 'employee']);

usersRouter.get('/', requireRole('admin', 'pm', 'dept_head'), async (req, res, next) => {
  try {
    const role = req.auth!.role;
    const deptFilter =
      typeof req.query.department === 'string' && req.query.department
        ? req.query.department
        : null;

    let q = supabaseAdmin
      .from('users')
      .select('id,name,email,role,department,job_title,created_at')
      .order('created_at', {
        ascending: false,
      });

    const roleFilterRaw = typeof req.query.role === 'string' ? req.query.role.trim() : '';
    if (roleFilterRaw) {
      const parsedRole = RoleSchema.safeParse(roleFilterRaw);
      if (!parsedRole.success) throw new AppError('Invalid role filter', 400);
      q = q.eq('role', parsedRole.data);
    }

    if (role === 'pm' || role === 'dept_head') {
      const d = req.auth!.department;
      if (!d) throw new AppError('Profile must have a department', 400);
      q = q.eq('department', d);
    } else if (bypassesDepartmentScope(role) && deptFilter) {
      await assertDepartmentExists(deptFilter);
      q = q.eq('department', deptFilter);
    }

    const { data, error } = await q;
    if (error) throw error;
    res.json({ users: data ?? [] });
  } catch (err) {
    next(err);
  }
});

const PatchUserSchema = z.object({
  role: RoleSchema.optional(),
  department: DepartmentCodeSchema.optional(),
  name: z.string().min(1).max(200).optional(),
});

usersRouter.patch('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const userId = z.string().uuid().parse(req.params.id);
    const parsed = PatchUserSchema.parse(req.body ?? {});

    if (Object.keys(parsed).length === 0) {
      throw new AppError('No updates provided', 400);
    }

    const { data: row, error: loadErr } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, department')
      .eq('id', userId)
      .single();
    if (loadErr || !row) throw loadErr ?? new AppError('User not found', 404);

    if (parsed.department !== undefined) {
      await assertDepartmentExists(parsed.department);
    }

    const merged = {
      name: parsed.name ?? row.name,
      role: parsed.role ?? row.role,
      department: parsed.department ?? row.department,
    };

    if (merged.role === 'admin') {
      merged.department = 'management';
    }
    if (merged.role !== 'admin' && merged.department === 'management') {
      throw new AppError('Only admin users may belong to the management department', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({
        name: merged.name,
        role: merged.role,
        department: merged.department,
      })
      .eq('id', userId)
      .select('id,name,email,role,department,job_title,created_at')
      .single();
    if (error) throw error;
    res.json({ user: data });
  } catch (err) {
    next(err);
  }
});
