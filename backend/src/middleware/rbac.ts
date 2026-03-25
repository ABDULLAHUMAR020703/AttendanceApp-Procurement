import type { RequestHandler } from 'express';
import { AppError } from '../utils/errors';
import type { UserRole } from '../modules/auth/types';

export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    const role = req.auth?.role;
    if (!role) return next(new AppError('Unauthorized', 401));
    if (!allowedRoles.includes(role)) return next(new AppError('Forbidden', 403));
    next();
  };
}

