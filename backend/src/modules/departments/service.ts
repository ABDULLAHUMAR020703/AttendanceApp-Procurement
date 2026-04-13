import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { slugifyDepartmentCode } from './slug';

/** Returns canonical code if the row exists. */
export async function resolveDepartmentCode(value: string | null | undefined): Promise<string | null> {
  if (!value || !String(value).trim()) return null;
  const code = String(value).trim();
  const { data, error } = await supabaseAdmin.from('departments').select('code').eq('code', code).maybeSingle();
  if (error) throw error;
  return (data?.code as string) ?? null;
}

export async function assertDepartmentExists(code: string): Promise<void> {
  const { data, error } = await supabaseAdmin.from('departments').select('code').eq('code', code).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('Invalid department', 400);
}

export type DepartmentRow = { code: string; display_name: string };

export type DepartmentWithCounts = DepartmentRow & {
  employee_count: number;
  project_count: number;
};

function normalizeDisplayName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) throw new AppError('Department name is required', 400);
  if (s.length > 200) throw new AppError('Department name is too long', 400);
  return s;
}

async function codesInUse(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin.from('departments').select('code');
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.code as string));
}

export async function generateUniqueDepartmentCode(displayName: string): Promise<string> {
  const base = slugifyDepartmentCode(displayName);
  const used = await codesInUse();
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new AppError('Could not allocate a unique department code', 500);
}

export async function listDepartmentsWithCounts(): Promise<DepartmentWithCounts[]> {
  const { data: depts, error: dErr } = await supabaseAdmin
    .from('departments')
    .select('code, display_name')
    .order('display_name', { ascending: true });
  if (dErr) throw dErr;

  const { data: users, error: uErr } = await supabaseAdmin.from('users').select('department');
  if (uErr) throw uErr;

  const { data: projects, error: pErr } = await supabaseAdmin.from('projects').select('department_id');
  if (pErr) throw pErr;

  const empByDept = new Map<string, number>();
  for (const row of users ?? []) {
    const d = row.department as string;
    empByDept.set(d, (empByDept.get(d) ?? 0) + 1);
  }

  const projByDept = new Map<string, number>();
  for (const row of projects ?? []) {
    const d = row.department_id as string;
    projByDept.set(d, (projByDept.get(d) ?? 0) + 1);
  }

  return (depts ?? []).map((r) => ({
    code: r.code as string,
    display_name: r.display_name as string,
    employee_count: empByDept.get(r.code as string) ?? 0,
    project_count: projByDept.get(r.code as string) ?? 0,
  }));
}

async function displayNameTaken(name: string, exceptCode?: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('departments').select('code, display_name');
  if (error) throw error;
  const lower = name.toLowerCase();
  return (data ?? []).some(
    (r) =>
      (r.display_name as string).toLowerCase() === lower && (exceptCode == null || (r.code as string) !== exceptCode),
  );
}

export async function createDepartment(displayName: string): Promise<DepartmentWithCounts> {
  const name = normalizeDisplayName(displayName);
  if (await displayNameTaken(name)) throw new AppError('A department with this name already exists', 409);
  const code = await generateUniqueDepartmentCode(name);

  const { data, error } = await supabaseAdmin
    .from('departments')
    .insert({ code, display_name: name })
    .select('code, display_name')
    .single();
  if (error) {
    if (error.code === '23505') throw new AppError('A department with this name already exists', 409);
    throw error;
  }
  return {
    code: data!.code as string,
    display_name: data!.display_name as string,
    employee_count: 0,
    project_count: 0,
  };
}

export async function updateDepartmentDisplayName(code: string, displayName: string): Promise<DepartmentRow> {
  const name = normalizeDisplayName(displayName);

  const { data: row, error: findErr } = await supabaseAdmin
    .from('departments')
    .select('code')
    .eq('code', code)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!row) throw new AppError('Department not found', 404);

  if (await displayNameTaken(name, code)) throw new AppError('A department with this name already exists', 409);

  const { data, error } = await supabaseAdmin
    .from('departments')
    .update({ display_name: name })
    .eq('code', code)
    .select('code, display_name')
    .single();
  if (error) {
    if (error.code === '23505') throw new AppError('A department with this name already exists', 409);
    throw error;
  }
  return { code: data!.code as string, display_name: data!.display_name as string };
}

export async function deleteDepartmentIfEmpty(code: string): Promise<void> {
  const { data: row, error: findErr } = await supabaseAdmin
    .from('departments')
    .select('code')
    .eq('code', code)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!row) throw new AppError('Department not found', 404);

  const { count: empCount, error: eErr } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('department', code);
  if (eErr) throw eErr;

  const nEmp = empCount ?? 0;
  if (nEmp > 0) {
    throw new AppError(`This department has ${nEmp} employee(s). Reassign them before deleting.`, 409, {
      employee_count: nEmp,
    });
  }

  const { count: projCount, error: pErr } = await supabaseAdmin
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('department_id', code);
  if (pErr) throw pErr;

  const nProj = projCount ?? 0;
  if (nProj > 0) {
    throw new AppError(`This department has ${nProj} project(s). Remove or reassign projects first.`, 409, {
      project_count: nProj,
    });
  }

  const { error: delErr } = await supabaseAdmin.from('departments').delete().eq('code', code);
  if (delErr) throw delErr;
}
