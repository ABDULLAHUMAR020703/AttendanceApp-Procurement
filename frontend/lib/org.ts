/**
 * Project-scoped team lead (not a global role). Use with project rows from the API.
 */
export function isTeamLeadForProject(
  project: { team_lead_id?: string | null } | null | undefined,
  userId: string | null | undefined,
): boolean {
  return Boolean(userId && project?.team_lead_id && project.team_lead_id === userId);
}

export const APPROVAL_STAGE_ORDER = ['team_lead', 'pm', 'admin'] as const;

export type ApprovalStage = (typeof APPROVAL_STAGE_ORDER)[number];

export function approvalStageLabel(role: string): string {
  switch (role) {
    case 'team_lead':
      return 'Team Lead';
    case 'pm':
      return 'PM';
    case 'admin':
      return 'Admin';
    default:
      return role;
  }
}

export function approvalPipelineStatus(role: string, status: string): string {
  if (status === 'approved') {
    if (role === 'admin') return 'Approved by Admin';
    return 'Approved';
  }
  if (status === 'rejected') return 'Rejected';
  if (role === 'team_lead') return 'Pending Team Lead Approval';
  if (role === 'pm') return 'Pending PM Approval';
  if (role === 'admin') return 'Pending Admin Approval';
  return 'Pending';
}
