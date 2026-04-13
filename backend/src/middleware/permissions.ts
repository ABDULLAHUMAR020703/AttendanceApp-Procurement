import type { RequestHandler } from 'express';
import type { Request } from 'express';
import { AppError } from '../utils/errors';
import { bypassesDepartmentScope } from '../modules/auth/types';
import type { AppPermission } from '../modules/permissions/types';
import { APP_PERMISSIONS } from '../modules/permissions/types';

/** Admins (org-wide) bypass permission checks and effectively have all permissions. */
export function hasPermission(req: Request, permission: AppPermission): boolean {
  const auth = req.auth;
  if (!auth) return false;
  if (bypassesDepartmentScope(auth.role)) return true;
  return (auth.permissions ?? []).includes(permission);
}

export function requirePermission(permission: AppPermission): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new AppError('Unauthorized', 401));
    if (hasPermission(req, permission)) return next();
    return next(new AppError('Missing required permission', 403));
  };
}

export function requireAllPermissions(permissions: AppPermission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new AppError('Unauthorized', 401));
    for (const p of permissions) {
      if (!hasPermission(req, p)) return next(new AppError('Missing required permission', 403));
    }
    return next();
  };
}

export function requireAnyPermission(permissions: AppPermission[] = [...APP_PERMISSIONS]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new AppError('Unauthorized', 401));
    if (bypassesDepartmentScope(req.auth.role)) return next();
    const have = req.auth.permissions ?? [];
    if (permissions.some((p) => have.includes(p))) return next();
    return next(new AppError('Missing required permission', 403));
  };
}
