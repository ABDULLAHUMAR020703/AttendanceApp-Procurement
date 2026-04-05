import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { recordTrackedAction } from '../auditLogs/trackedAction';
import type { UserRole } from '../auth/types';
import type { Department } from '../auth/types';
import { bypassesDepartmentScope, DEPARTMENTS, isDeptManagerRole } from '../auth/types';
import {
  assertActorMayManageProject,
  assertUserEligibleTeamLead,
  fetchProjectOrThrow,
} from '../org/projectGuards';

type CreateProjectInput = {
  name: string;
  poId: string | null;
  budget: number;
  createdBy: string;
  actorRole: UserRole;
  actorDepartment: string | null;
  /** FK to departments.code; admin picks freely; PM/dept_head must match profile. */
  departmentId: Department;
  /** Department PM responsible for this project (approval workflow). */
  pmId: string;
  teamLeadId: string;
  assignedEmployeeIds: string[];
};

function normalizeDepartment(value: string | null | undefined): Department | null {
  if (!value) return null;
  if (!DEPARTMENTS.includes(value as Department)) return null;
  return value as Department;
}

function resolveProjectDepartmentForCreate(input: CreateProjectInput): Department {
  const fromBody = normalizeDepartment(input.departmentId);
  if (!fromBody) throw new AppError('department_id is required', 400);
  if (fromBody === 'management') {
    throw new AppError('Projects cannot be assigned to the management department', 400);
  }

  if (bypassesDepartmentScope(input.actorRole)) {
    return fromBody;
  }

  if (isDeptManagerRole(input.actorRole)) {
    const actorDept = normalizeDepartment(input.actorDepartment ?? undefined);
    if (!actorDept) throw new AppError('Your profile must have a department to create projects', 400);
    if (actorDept === 'management') {
      throw new AppError('Use an operational department account to create projects', 403);
    }
    if (actorDept !== fromBody) {
      throw new AppError('department_id must match your profile department', 403);
    }
    return fromBody;
  }

  throw new AppError('Forbidden', 403);
}

async function validatePmForDepartment(pmId: string, department: string) {
  const { data: u, error } = await supabaseAdmin.from('users').select('id, role, department').eq('id', pmId).single();
  if (error || !u) throw error ?? new AppError('Project manager user not found', 404);
  if (u.role !== 'pm') throw new AppError('Project manager must be a user with PM role', 400);
  if (u.department !== department) throw new AppError('PM must belong to the project department', 400);
}

async function validateAssignedEmployees(employeeIds: string[], department: string) {
  if (employeeIds.length === 0) return;
  const { data: rows, error } = await supabaseAdmin.from('users').select('id, role, department').in('id', employeeIds);
  if (error) throw error;
  const byId = new Map((rows ?? []).map((u) => [u.id as string, u]));
  for (const id of employeeIds) {
    const u = byId.get(id);
    if (!u) throw new AppError(`Unknown user in assignments: ${id}`, 400);
    if (u.role !== 'employee') throw new AppError('Only users with the employee role can be project members', 400);
    if (u.department !== department) throw new AppError('Assigned employees must belong to the project department', 400);
  }
}

async function replaceProjectAssignments(projectId: string, employeeIds: string[], teamLeadId: string | null) {
  const { error: delErr } = await supabaseAdmin.from('project_assignments').delete().eq('project_id', projectId);
  if (delErr) throw delErr;
  const ids = new Set(employeeIds);
  if (teamLeadId) {
    const { data: tl } = await supabaseAdmin.from('users').select('role').eq('id', teamLeadId).maybeSingle();
    if (tl?.role === 'employee') ids.add(teamLeadId);
  }
  if (ids.size === 0) return;
  const rows = [...ids].map((employee_id) => ({ project_id: projectId, employee_id }));
  const { error: insErr } = await supabaseAdmin.from('project_assignments').insert(rows);
  if (insErr) throw insErr;
}

export async function updateProjectMemberAssignments(params: {
  projectId: string;
  assignedEmployeeIds: string[];
  actorUserId: string;
  actorRole: UserRole;
  actorDepartment: string | null;
}) {
  const { projectId, assignedEmployeeIds, actorUserId, actorRole, actorDepartment } = params;
  const project = await fetchProjectOrThrow(projectId);

  await assertActorMayManageProject({
    actorUserId,
    actorRole,
    actorDepartment,
    project,
  });

  const unique = [...new Set(assignedEmployeeIds)];
  if (unique.some((id) => id === project.pm_id)) {
    throw new AppError('Cannot assign the project PM as a member row; PM is already on the project', 400);
  }

  await validateAssignedEmployees(unique, project.department_id);
  await replaceProjectAssignments(projectId, unique, project.team_lead_id);

  const notify: import('../auditLogs/trackedAction').TrackedNotifyEntry[] = [];
  if (project.pm_id) {
    notify.push({
      userId: project.pm_id as string,
      type: 'project_members_updated',
      message: 'Project member assignments were updated.',
      emailSubject: 'Project members updated',
    });
  }
  if (project.team_lead_id && project.team_lead_id !== project.pm_id) {
    notify.push({
      userId: project.team_lead_id as string,
      type: 'project_members_updated',
      message: 'Project member assignments were updated.',
      emailSubject: 'Project members updated',
    });
  }

  await recordTrackedAction({
    audit: {
      action: 'project_members_updated',
      userId: actorUserId,
      entity: 'project',
      entityType: 'project',
      entityId: projectId,
      changes: { assigned_employee_ids: unique },
      departmentScope: project.department_id,
    },
    touch: { table: 'projects', id: projectId },
    notify,
  });

  return { ok: true as const };
}

export async function createProjectWithExceptionFlow(input: CreateProjectInput) {
  const { name, poId, budget, createdBy, actorRole, pmId, teamLeadId, assignedEmployeeIds } = input;
  const departmentId = resolveProjectDepartmentForCreate(input);

  if (!name.trim()) throw new AppError('Project name is required', 400);

  const memberIds = [...new Set(assignedEmployeeIds)];
  if (memberIds.some((id) => id === pmId)) {
    throw new AppError('Project manager cannot be listed as an assigned employee', 400);
  }

  await validatePmForDepartment(pmId, departmentId);
  await assertUserEligibleTeamLead({ teamLeadUserId: teamLeadId, projectDepartment: departmentId });
  await validateAssignedEmployees(memberIds, departmentId);

  if (poId) {
    const { data: po, error: poErr } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, remaining_value')
      .eq('id', poId)
      .single();
    if (poErr || !po) throw poErr ?? new AppError('PO not found', 404);

    const derivedBudget = Number(po.remaining_value);
    if (!Number.isFinite(derivedBudget) || derivedBudget <= 0) {
      throw new AppError('Selected PO has no remaining budget', 400);
    }

    const { data: project, error: prErr } = await supabaseAdmin
      .from('projects')
      .insert({
        name,
        po_id: poId,
        budget: derivedBudget,
        department_id: departmentId,
        pm_id: pmId,
        team_lead_id: teamLeadId,
        created_by: createdBy,
        updated_by: createdBy,
        status: 'active',
        is_exception: false,
      })
      .select('id, name, po_id, budget, status, is_exception, department_id, team_lead_id, pm_id')
      .single();
    if (prErr) throw prErr;

    await replaceProjectAssignments(project.id as string, memberIds, teamLeadId);

    await recordTrackedAction({
      audit: {
        action: 'project_created',
        userId: createdBy,
        entity: 'project',
        entityType: 'project',
        entityId: project.id as string,
        departmentScope: departmentId,
      },
      touch: { table: 'projects', id: project.id as string },
      notify: [
        {
          userId: pmId,
          type: 'project_created',
          message: `New project "${name}" was created; you are assigned as PM.`,
          emailSubject: 'New project created',
        },
      ],
    });

    return { project };
  }

  if (budget <= 0) throw new AppError('Budget must be > 0', 400);
  const { data: project, error: prjErr } = await supabaseAdmin
    .from('projects')
    .insert({
      name,
      po_id: null,
      budget: Number(budget),
      department_id: departmentId,
      pm_id: pmId,
      team_lead_id: teamLeadId,
      created_by: createdBy,
      updated_by: createdBy,
      status: 'exception_pending',
      is_exception: true,
    })
    .select('id, name, po_id, budget, status, is_exception, department_id, team_lead_id, pm_id')
    .single();
  if (prjErr || !project) throw prjErr ?? new AppError('Failed to create project', 500);

  await replaceProjectAssignments(project.id as string, memberIds, teamLeadId);

  const { data: exception, error: exErr } = await supabaseAdmin
    .from('exceptions')
    .insert({
      type: 'no_po',
      reference_id: project.id,
      status: 'pending',
      approved_by: null,
    })
    .select('id, type, reference_id, status')
    .single();
  if (exErr || !exception) throw exErr ?? new AppError('Failed to create no_po exception', 500);

  const message = `No-PO exception requested for project "${project.name}". Approval required to proceed with purchase requests.`;
  const creatorMessage = `Project "${project.name}" was created without a PO. It is pending PM approval in your department before you can submit purchase requests.`;

  await recordTrackedAction({
    audit: {
      action: 'no_po_exception_created',
      userId: createdBy,
      entity: 'exception',
      entityType: 'exception',
      entityId: exception.id as string,
      departmentScope: departmentId,
      changes: { project_id: project.id, exception_id: exception.id },
    },
    touch: { table: 'projects', id: project.id as string },
    notify: [
      {
        userId: pmId,
        type: 'exception_no_po_pending',
        message,
        emailSubject: 'No-PO Exception Approval Required',
      },
      {
        userId: createdBy,
        type: 'no_po_exception_pending',
        message: creatorMessage,
        emailSubject: 'No-PO Exception Pending Approval',
      },
    ],
  });

  return { project, exception };
}

const ARCHIVE_BLOCKED_MESSAGE = 'Project cannot be deleted as it has approved transactions';

async function hasCommittedFinancialActivity(projectId: string): Promise<boolean> {
  const { data: approvedPr, error: apErr } = await supabaseAdmin
    .from('purchase_requests')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'approved')
    .limit(1);
  if (apErr) throw apErr;
  if (approvedPr && approvedPr.length > 0) return true;

  const { data: prs, error: prErr } = await supabaseAdmin.from('purchase_requests').select('id').eq('project_id', projectId);
  if (prErr) throw prErr;
  const prIds = (prs ?? []).map((r) => r.id as string);
  if (prIds.length === 0) return false;

  const { data: auditHit, error: auErr } = await supabaseAdmin
    .from('audit_logs')
    .select('id')
    .eq('action', 'pr_approved')
    .eq('entity', 'purchase_request')
    .in('entity_id', prIds)
    .limit(1);
  if (auErr) throw auErr;
  return (auditHit?.length ?? 0) > 0;
}

export async function archiveProject(params: { projectId: string; actorUserId: string; actorRole: UserRole; actorDepartment?: string | null }) {
  const { projectId, actorUserId, actorRole, actorDepartment } = params;

  if (!bypassesDepartmentScope(actorRole) && !isDeptManagerRole(actorRole)) {
    throw new AppError('Forbidden', 403);
  }

  const project = await fetchProjectOrThrow(projectId);

  if (project.status === 'archived') {
    throw new AppError('Project is already archived', 409);
  }

  if (isDeptManagerRole(actorRole)) {
    if (!actorDepartment || actorDepartment !== project.department_id) {
      throw new AppError('You can only archive projects in your department', 403);
    }
  }

  if (await hasCommittedFinancialActivity(projectId)) {
    throw new AppError(ARCHIVE_BLOCKED_MESSAGE, 409);
  }

  const { error: upErr } = await supabaseAdmin
    .from('projects')
    .update({ status: 'archived', updated_by: actorUserId })
    .eq('id', projectId);
  if (upErr) throw upErr;

  const notify: import('../auditLogs/trackedAction').TrackedNotifyEntry[] = [];
  if (project.pm_id) {
    notify.push({
      userId: project.pm_id as string,
      type: 'project_archived',
      message: `Project "${projectId.slice(0, 8)}…" was archived.`,
      emailSubject: 'Project archived',
    });
  }

  await recordTrackedAction({
    audit: {
      action: 'project_archived',
      userId: actorUserId,
      entity: 'project',
      entityType: 'project',
      entityId: projectId,
      changes: { status: { after: 'archived' } },
      departmentScope: project.department_id,
    },
    notify,
  });

  return { ok: true as const, status: 'archived' as const };
}

export async function updateProjectTeamLead(params: {
  projectId: string;
  teamLeadId: string | null;
  actorUserId: string;
  actorRole: UserRole;
  actorDepartment: string | null;
}) {
  const { projectId, teamLeadId, actorUserId, actorRole, actorDepartment } = params;
  const project = await fetchProjectOrThrow(projectId);

  await assertActorMayManageProject({
    actorUserId,
    actorRole,
    actorDepartment,
    project,
  });

  if (teamLeadId) {
    await assertUserEligibleTeamLead({ teamLeadUserId: teamLeadId, projectDepartment: project.department_id });
  }

  const { error } = await supabaseAdmin
    .from('projects')
    .update({ team_lead_id: teamLeadId, updated_by: actorUserId })
    .eq('id', projectId);
  if (error) throw error;

  if (teamLeadId) {
    const { data: tl } = await supabaseAdmin.from('users').select('role').eq('id', teamLeadId).maybeSingle();
    if (tl?.role === 'employee') {
      await supabaseAdmin
        .from('project_assignments')
        .upsert(
          { project_id: projectId, employee_id: teamLeadId },
          { onConflict: 'project_id,employee_id' },
        );
    }
  }

  const notify: import('../auditLogs/trackedAction').TrackedNotifyEntry[] = [];
  if (project.pm_id) {
    notify.push({
      userId: project.pm_id as string,
      type: 'project_team_lead_updated',
      message: 'Team lead was updated on a project you manage.',
      emailSubject: 'Team lead updated',
    });
  }
  if (teamLeadId && teamLeadId !== project.pm_id) {
    notify.push({
      userId: teamLeadId,
      type: 'project_team_lead_assigned',
      message: 'You were set as team lead on a project.',
      emailSubject: 'Team lead assignment',
    });
  }

  await recordTrackedAction({
    audit: {
      action: 'project_team_lead_updated',
      userId: actorUserId,
      entity: 'project',
      entityType: 'project',
      entityId: projectId,
      changes: { team_lead_id: { after: teamLeadId } },
      departmentScope: project.department_id,
    },
    notify,
  });

  const { data: updated, error: selErr } = await supabaseAdmin
    .from('projects')
    .select('id, name, department_id, team_lead_id, pm_id, status, po_id, budget, is_exception')
    .eq('id', projectId)
    .single();
  if (selErr) throw selErr;

  return { project: updated };
}
