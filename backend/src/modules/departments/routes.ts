import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import {
  createDepartment,
  deleteDepartmentIfEmpty,
  listDepartmentsWithCounts,
  updateDepartmentDisplayName,
} from './service';

export const departmentsRouter = Router();

departmentsRouter.use(requireAuth);

const DepartmentCodeParam = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);

const PostBody = z.object({
  display_name: z.string().min(1).max(200),
});

const PatchBody = z.object({
  display_name: z.string().min(1).max(200),
});

departmentsRouter.get('/', async (_req, res, next) => {
  try {
    const departments = await listDepartmentsWithCounts();
    res.json({ departments });
  } catch (err) {
    next(err);
  }
});

departmentsRouter.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const parsed = PostBody.parse(req.body ?? {});
    const row = await createDepartment(parsed.display_name);
    res.status(201).json({ department: row });
  } catch (err) {
    next(err);
  }
});

departmentsRouter.patch('/:code', requireRole('admin'), async (req, res, next) => {
  try {
    const code = DepartmentCodeParam.parse(req.params.code);
    const parsed = PatchBody.parse(req.body ?? {});
    const row = await updateDepartmentDisplayName(code, parsed.display_name);
    res.json({ department: row });
  } catch (err) {
    next(err);
  }
});

departmentsRouter.delete('/:code', requireRole('admin'), async (req, res, next) => {
  try {
    const code = DepartmentCodeParam.parse(req.params.code);
    await deleteDepartmentIfEmpty(code);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
