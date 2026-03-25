import type { RequestHandler } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../utils/errors';
import type { UserRole } from '../modules/auth/types';

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

  req.auth = {
    userId,
    role: profile.role as UserRole,
    department: profile.department ?? null,
    name: profile.name ?? null,
    email: profile.email ?? null,
  };

  return next();
};

