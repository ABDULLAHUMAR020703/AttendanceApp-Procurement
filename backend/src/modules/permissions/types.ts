export const APP_PERMISSIONS = [
  'view_projects',
  'view_pos',
  'view_approvals',
  'approve_requests',
  'view_budget',
  'manage_exceptions',
] as const;

export type AppPermission = (typeof APP_PERMISSIONS)[number];

export function isAppPermission(value: string): value is AppPermission {
  return (APP_PERMISSIONS as readonly string[]).includes(value);
}
