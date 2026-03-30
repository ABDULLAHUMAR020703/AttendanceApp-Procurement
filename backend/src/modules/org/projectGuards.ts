import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import type { UserRole } from '../auth/types';

export type ProjectRow = {
  id: string;
  department: string;
  team_lead_id: string | null;
  created_by: string;
  status: string;
};

export function isTeamLeadOnProject(params: { projectTeamLeadId: string | null; userId: string }): boolean {
  return params.projectTeamLeadId != null && params.projectTeamLeadId === params.userId;
}

export async function fetchProjectOrThrow(projectId: string): Promise<ProjectRow> {
  const { data: project, error } = await supabaseAdmin
    .from('projects')
    .select('id, department, team_lead_id, created_by, status')
    .eq('id', projectId)
    .single();
  if (error || !project) throw error ?? new AppError('Project not found', 404);
  return project as ProjectRow;
}

export async function assertActorMayManageProject(params: {
  actorUserId: string;
  actorRole: UserRole;
  actorDepartment: string | null;
  project: ProjectRow;
}) {
  const { actorUserId, actorRole, actorDepartment, project } = params;
  if (actorRole === 'admin') return;
  if (actorRole === 'pm') {
    if (!actorDepartment || actorDepartment !== project.department) {
      throw new AppError('PM can only manage projects in their own department', 403);
    }
    return;
  }
  throw new AppError('Forbidden', 403);
}

export async function assertUserEligibleTeamLead(params: {
  teamLeadUserId: string;
  projectDepartment: string;
}) {
  const { teamLeadUserId, projectDepartment } = params;
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, department, role')
    .eq('id', teamLeadUserId)
    .single();
  if (error || !user) throw error ?? new AppError('Team lead user not found', 404);
  if (user.department !== projectDepartment) {
    throw new AppError('Team lead must belong to the same department as the project', 400);
  }
  if (user.role === 'admin') {
    throw new AppError('Admin users cannot be assigned as project team lead', 400);
  }
}
