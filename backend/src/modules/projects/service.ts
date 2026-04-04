import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { writeAuditLog } from '../auditLogs/service';
import { createInAppNotification, enqueueEmailPlaceholder, getUserEmail } from '../notifications/service';
import type { UserRole } from '../auth/types';
import type { Department } from '../auth/types';
import { DEPARTMENTS } from '../auth/types';
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
  /** Required when actor is admin; ignored for PM (derived from actor department). */
  department?: Department | null;
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
  if (input.actorRole === 'admin') {
    const d = normalizeDepartment(input.department ?? undefined);
    if (!d) throw new AppError('department is required when creating a project as admin', 400);
    if (d === 'management') {
      throw new AppError('Projects cannot be assigned to the management department', 400);
    }
    return d;
  }
  if (input.actorRole === 'pm') {
    const d = normalizeDepartment(input.actorDepartment ?? undefined);
    if (!d) throw new AppError('PM profile must have a department to create projects', 400);
    if (d === 'management') {
      throw new AppError('Admin users manage org-wide configuration; use an operational department PM account', 403);
    }
    return d;
  }
  throw new AppError('Forbidden', 403);
}

async function notifyAssignedPm(pmUserId: string, params: { type: string; message: string; emailSubject: string }) {
  await createInAppNotification({ userId: pmUserId, type: params.type, message: params.message });
  const email = await getUserEmail(pmUserId);
  if (email) {
    await enqueueEmailPlaceholder({
      toEmail: email,
      subject: params.emailSubject,
      body: params.message,
    });
  }
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

  await validateAssignedEmployees(unique, project.department);
  await replaceProjectAssignments(projectId, unique, project.team_lead_id);

  await writeAuditLog({
    action: 'project_members_updated',
    userId: actorUserId,
    entity: 'project',
    entityType: 'project',
    entityId: projectId,
    changes: { assigned_employee_ids: unique },
  });

  return { ok: true as const };
}

export async function createProjectWithExceptionFlow(input: CreateProjectInput) {
  const { name, poId, budget, createdBy, actorRole, pmId, teamLeadId, assignedEmployeeIds } = input;
  const department = resolveProjectDepartmentForCreate(input);

  if (!name.trim()) throw new AppError('Project name is required', 400);

  const memberIds = [...new Set(assignedEmployeeIds)];
  if (memberIds.some((id) => id === pmId)) {
    throw new AppError('Project manager cannot be listed as an assigned employee', 400);
  }

  await validatePmForDepartment(pmId, department);
  await assertUserEligibleTeamLead({ teamLeadUserId: teamLeadId, projectDepartment: department });
  await validateAssignedEmployees(memberIds, department);

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
        department,
        pm_id: pmId,
        team_lead_id: teamLeadId,
        created_by: createdBy,
        updated_by: createdBy,
        status: 'active',
        is_exception: false,
      })
      .select('id, name, po_id, budget, status, is_exception, department, team_lead_id, pm_id')
      .single();
    if (prErr) throw prErr;

    await replaceProjectAssignments(project.id as string, memberIds, teamLeadId);

    await writeAuditLog({
      action: 'project_created',
      userId: createdBy,
      entity: 'project',
      entityType: 'project',
      entityId: project.id,
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
      department,
      pm_id: pmId,
      team_lead_id: teamLeadId,
      created_by: createdBy,
      updated_by: createdBy,
      status: 'exception_pending',
      is_exception: true,
    })
    .select('id, name, po_id, budget, status, is_exception, department, team_lead_id, pm_id')
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
  await notifyAssignedPm(pmId, {
    type: 'exception_no_po_pending',
    message,
    emailSubject: 'No-PO Exception Approval Required',
  });

  const creatorMessage = `Project "${project.name}" was created without a PO. It is pending PM approval in your department before you can submit purchase requests.`;
  await createInAppNotification({
    userId: createdBy,
    type: 'no_po_exception_pending',
    message: creatorMessage,
  });
  const creatorEmail = await getUserEmail(createdBy);
  if (creatorEmail) {
    await enqueueEmailPlaceholder({
      toEmail: creatorEmail,
      subject: 'No-PO Exception Pending Approval',
      body: creatorMessage,
    });
  }

  await writeAuditLog({
    action: 'no_po_exception_created',
    userId: createdBy,
    entity: 'exception',
    entityId: exception.id,
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

  if (actorRole !== 'admin' && actorRole !== 'pm') {
    throw new AppError('Forbidden', 403);
  }

  const project = await fetchProjectOrThrow(projectId);

  if (project.status === 'archived') {
    throw new AppError('Project is already archived', 409);
  }

  if (actorRole === 'pm') {
    if (!actorDepartment || actorDepartment !== project.department) {
      throw new AppError('PM can only archive projects in their department', 403);
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

  await writeAuditLog({
    action: 'project_archived',
    userId: actorUserId,
    entity: 'project',
    entityType: 'project',
    entityId: projectId,
    changes: { status: { after: 'archived' } },
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
    await assertUserEligibleTeamLead({ teamLeadUserId: teamLeadId, projectDepartment: project.department });
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

  await writeAuditLog({
    action: 'project_team_lead_updated',
    userId: actorUserId,
    entity: 'project',
    entityType: 'project',
    entityId: projectId,
    changes: { team_lead_id: { after: teamLeadId } },
  });

  const { data: updated, error: selErr } = await supabaseAdmin
    .from('projects')
    .select('id, name, department, team_lead_id, pm_id, status, po_id, budget, is_exception')
    .eq('id', projectId)
    .single();
  if (selErr) throw selErr;

  return { project: updated };
}
