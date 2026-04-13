import type { RequestHandler } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../utils/errors';
import { bypassesDepartmentScope, type UserRole } from '../modules/auth/types';
import type { AppPermission } from '../modules/permissions/types';
import { APP_PERMISSIONS, isAppPermission } from '../modules/permissions/types';
import { mergeEffectivePermissions } from '../modules/permissions/roleDefaults';

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('Missing Authorization bearer token', 401));
  }

  const token = header.slice('Bearer '.length);
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

  if (userErr || !userData?.user) {
    return next(new AppError('Invalid or expired token', 401, userErr ?? undefined));
  }

  const userId = userData.user.id;
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('users')
    .select('id, role, department, name, email')
    .eq('id', userId)
    .single();

  if (profileErr || !profile) {
    return next(new AppError('User profile not found in `users` table', 401, profileErr ?? undefined));
  }

  const role = profile.role as UserRole;
  let permissions: AppPermission[] = [];
  if (bypassesDepartmentScope(role)) {
    permissions = [...APP_PERMISSIONS];
  } else {
    const { data: permRows, error: permErr } = await supabaseAdmin
      .from('user_permissions')
      .select('permission')
      .eq('user_id', userId);
    if (permErr) return next(new AppError('Failed to load permissions', 500, permErr));
    const fromDb = (permRows ?? [])
      .map((r) => r.permission as string)
      .filter(isAppPermission);
    permissions = mergeEffectivePermissions(role, fromDb);
  }

  req.auth = {
    userId,
    role,
    department: profile.department ?? null,
    name: profile.name ?? null,
    email: profile.email ?? null,
    orgWideAccess: bypassesDepartmentScope(role),
    permissions,
  };

  return next();
};

