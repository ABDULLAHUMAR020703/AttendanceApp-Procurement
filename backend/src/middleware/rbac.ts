import type { RequestHandler } from 'express';
import { AppError } from '../utils/errors';
import type { UserRole } from '../modules/auth/types';

/**
 * Role-only gate. Department scoping is applied per route: use `req.auth?.orgWideAccess`
 * (true for admin from `requireAuth`) to skip `WHERE department = …` style filters.
 */
export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    const role = req.auth?.role;
    if (!role) return next(new AppError('Unauthorized', 401));
    if (!allowedRoles.includes(role)) return next(new AppError('Forbidden', 403));
    next();
  };
}

