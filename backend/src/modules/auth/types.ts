export type UserRole = 'admin' | 'pm' | 'employee';

/** Departments; admin users use `management` only. */
export type Department =
  | 'sales'
  | 'hr'
  | 'technical'
  | 'finance'
  | 'engineering'
  | 'management'
  | 'ibs'
  | 'power'
  | 'civil_works'
  | 'bss_wireless'
  | 'fixed_network'
  | 'warehouse';

/**
 * Values stored in `approvals.role` — workflow stages, not application UserRole.
 * (Team lead approval is tied to `projects.team_lead_id`, not a global role.)
 */
export type ApprovalStageRole = 'team_lead' | 'pm' | 'admin';

export const APPROVAL_STAGE_ORDER: ApprovalStageRole[] = ['team_lead', 'pm', 'admin'];

export const DEPARTMENTS: Department[] = [
  'sales',
  'hr',
  'technical',
  'finance',
  'engineering',
  'management',
  'ibs',
  'power',
  'civil_works',
  'bss_wireless',
  'fixed_network',
  'warehouse',
];
