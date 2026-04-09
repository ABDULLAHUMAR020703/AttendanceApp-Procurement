'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppLayout } from '../../components/AppLayout';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { PageContainer } from '../../components/ui/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from '../../components/ui/Table';
import { useAuth } from '../../features/auth/AuthProvider';
import { ApiError, authedFetchWithSupabase, getAccessTokenFromSupabaseSession, NoSessionError } from '../../lib/api';
import { LastUpdatedMeta } from '../../components/LastUpdatedPanel';

type PurchaseOrderGroup = {
  po: string;
  issue_date: string | null;
  customer: string | null;
  vendor: string | null;
  total_amount: number;
  remaining_amount: number;
  total_value: number;
  remaining_value: number;
  anchor_po_line_id: string;
  created_at: string;
  items: Array<{
    id: string;
    item_code: string | null;
    description: string | null;
    line_no: string | null;
    po_line_sn: string | null;
    unit_price: number | null;
    po_amount: number;
    remaining_amount: number;
  }>;
};
type ProjectPurchaseOrderSnapshot = { total_value: number; remaining_value: number };

type UserSummary = { id: string; name: string | null; email: string | null; role: string };

type Project = {
  id: string;
  name: string;
  po_id: string | null;
  budget: number;
  status: string;
  is_exception: boolean;
  created_at: string;
  created_by: string;
  department_id: string;
  department_label?: string;
  team_lead_id: string | null;
  pm_id?: string | null;
  pm?: UserSummary | null;
  team_lead?: UserSummary | null;
  purchase_order?: ProjectPurchaseOrderSnapshot | ProjectPurchaseOrderSnapshot[] | null;
  last_updated_at?: string | null;
  last_updated_by?: { id: string; name: string | null; email: string | null; role: string | null } | null;
};

function formatPkr(amount: number) {
  if (!Number.isFinite(amount)) return '—';
  return `${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(amount)} PKR`;
}

function linkedPurchaseOrder(p: Project): ProjectPurchaseOrderSnapshot | null {
  const raw = p.purchase_order;
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const row = raw[0];
    if (!row) return null;
    return {
      total_value: Number(row.total_value),
      remaining_value: Number(row.remaining_value),
    };
  }
  return {
    total_value: Number(raw.total_value),
    remaining_value: Number(raw.remaining_value),
  };
}

function isDeptManagerRole(role: string | undefined): boolean {
  return role === 'pm' || role === 'dept_head';
}

function canArchiveProject(
  p: Project,
  profile: { userId: string; role: string; department?: string | null } | null,
): boolean {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  if (isDeptManagerRole(profile.role)) return !!(profile.department && profile.department === p.department_id);
  return false;
}

function canAssignTeamLead(
  profile: { role: string; department?: string | null } | null,
  p: Project,
): boolean {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  if (isDeptManagerRole(profile.role)) return !!(profile.department && profile.department === p.department_id);
  return false;
}

function BudgetUsageBar({ total, remaining }: { total: number; remaining: number }) {
  const used = Math.max(0, total - remaining);
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="space-y-1 min-w-[160px]">
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[11px] text-muted-foreground">
        Used {formatPkr(used)} ({total > 0 ? `${pct.toFixed(0)}%` : '—'})
      </div>
    </div>
  );
}

const ROLES_WITH_PO_LIST = new Set<string>(['admin', 'pm', 'dept_head', 'employee']);

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  job_title?: string | null;
};

type DeptRow = { code: string; display_name: string };

export default function ProjectsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, profile, supabase } = useAuth();
  const token = accessToken ?? '';

  const {
    data: poData,
    isLoading: poLoading,
    error: poError,
  } = useQuery({
    queryKey: ['po', 'list'],
    enabled: !!token && !!supabase && ROLES_WITH_PO_LIST.has(profile?.role ?? ''),
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ purchaseOrders: PurchaseOrderGroup[] }>(supabase, '/api/po');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const {
    data: projectsData,
    isLoading: projectsLoading,
    isFetching: projectsFetching,
    error: projectsError,
  } = useQuery({
    queryKey: ['projects', 'list'],
    enabled: !!token && !!supabase,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ projects: Project[] }>(supabase, '/api/projects');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const { data: departmentsData } = useQuery({
    queryKey: ['departments', 'list'],
    enabled: !!token && !!supabase && (profile?.role === 'admin' || isDeptManagerRole(profile?.role)),
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ departments: DeptRow[] }>(supabase, '/api/departments');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const [department, setDepartment] = useState<string>('technical');
  const effectiveDept = profile?.role === 'admin' ? department : (profile?.department ?? '');

  const { data: deptUsersData } = useQuery({
    queryKey: ['users', 'by-department', effectiveDept, profile?.role],
    enabled:
      !!token && !!supabase && isDeptManagerRole(profile?.role) && !!effectiveDept,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ users: UserRow[] }>(supabase, '/api/users');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const { data: adminAllUsersData } = useQuery({
    queryKey: ['users', 'admin-full-list'],
    enabled: !!token && !!supabase && profile?.role === 'admin',
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ users: UserRow[] }>(supabase, '/api/users');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const canCreate = profile?.role === 'admin' || isDeptManagerRole(profile?.role);
  const canDownloadPdf = profile?.role === 'admin' || profile?.role === 'pm';

  const [name, setName] = useState('');
  const [poId, setPoId] = useState<string>('');
  const [noPoMode, setNoPoMode] = useState(false);
  const [budget, setBudget] = useState<number>(0);
  const [pmId, setPmId] = useState<string>('');
  const [createTeamLeadId, setCreateTeamLeadId] = useState<string>('');
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(() => new Set());
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const allDepartmentsForSelect = departmentsData?.departments ?? [];

  const deptUsers = useMemo(() => {
    if (profile?.role === 'admin') {
      return (adminAllUsersData?.users ?? []).filter((u) => u.department === effectiveDept);
    }
    return deptUsersData?.users ?? [];
  }, [profile?.role, adminAllUsersData?.users, deptUsersData?.users, effectiveDept]);
  const pmCandidates = useMemo(() => deptUsers.filter((u) => u.role === 'pm'), [deptUsers]);
  const teamLeadCandidates = useMemo(
    () => deptUsers.filter((u) => u.role !== 'admin'),
    [deptUsers],
  );
  const employeePool = useMemo(() => {
    if (profile?.role === 'admin') {
      return (adminAllUsersData?.users ?? []).filter((u) => u.role === 'employee');
    }
    return deptUsers.filter((u) => u.role === 'employee');
  }, [profile?.role, adminAllUsersData?.users, deptUsers]);
  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return employeePool;
    return employeePool.filter(
      (u) =>
        (u.name ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.job_title ?? '').toLowerCase().includes(q),
    );
  }, [employeePool, employeeSearch]);

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      setArchiveError(null);
      try {
        return await authedFetchWithSupabase<{ ok: boolean; status: string }>(supabase, `/api/projects/${id}`, {
          method: 'DELETE',
        });
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      setArchiveTarget(null);
      setArchiveError(null);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Archive failed';
      setArchiveError(msg);
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!pmId || !createTeamLeadId) {
        throw new Error('Project Manager and Team Lead are required');
      }
      const payload: Record<string, unknown> = {
        name,
        pm_id: pmId,
        team_lead_id: createTeamLeadId,
        assigned_employee_ids: [...selectedEmployeeIds],
      };
      payload.department_id = profile?.role === 'admin' ? department : (profile?.department ?? '');
      if (noPoMode) {
        payload.po_id = null;
        payload.budget = Number(budget);
      } else {
        payload.po_id = poId ? poId : null;
      }
      try {
        return await authedFetchWithSupabase<unknown>(supabase, '/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      setError(null);
      setName('');
      setPoId('');
      setNoPoMode(false);
      setBudget(0);
      setPmId('');
      setCreateTeamLeadId('');
      setSelectedEmployeeIds(new Set());
      setEmployeeSearch('');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Create failed'),
  });

  const downloadProjectPdfMutation = useMutation({
    mutationFn: async (projectId: string) => {
      if (!supabase) throw new Error('Not signed in');
      const bearer = await getAccessTokenFromSupabaseSession(supabase);
      const apiBase = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000';
      const res = await fetch(`${apiBase}/api/projects/${projectId}/pdf`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${bearer}` },
      });
      if (!res.ok) {
        let msg = 'Failed to download project PDF';
        try {
          const body = (await res.json()) as { message?: string };
          if (body?.message) msg = body.message;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `PROJECT_${projectId}.pdf`;
      window.document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    },
    onMutate: () => setDownloadError(null),
    onError: (e: unknown) => setDownloadError(e instanceof Error ? e.message : 'Failed to download project PDF'),
  });

  const teamLeadMutation = useMutation({
    mutationFn: async (params: { projectId: string; team_lead_id: string | null }) => {
      try {
        return await authedFetchWithSupabase<unknown>(supabase, `/api/projects/${params.projectId}/team-lead`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ team_lead_id: params.team_lead_id }),
        });
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const poOptions = useMemo(() => poData?.purchaseOrders ?? [], [poData]);

  const selectedPoGroup = useMemo(
    () => poOptions.find((g) => g.anchor_po_line_id === poId) ?? null,
    [poOptions, poId],
  );

  const teamLeadCandidatesForDept = (dept: string) => {
    const pool =
      profile?.role === 'admin' ? (adminAllUsersData?.users ?? []) : (deptUsersData?.users ?? []);
    return pool.filter((u) => u.role !== 'admin' && u.department === dept);
  };

  const departmentBadgeClass =
    'inline-flex items-center rounded-full border border-violet-500/35 bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-violet-100';

  const toggleEmployee = (id: string, checked: boolean) => {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev);
      for (const u of filteredEmployees) next.add(u.id);
      return next;
    });
  };

  const clearEmployeeSelection = () => setSelectedEmployeeIds(new Set());

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader title="Projects" subtitle="Create a project and submit purchase requests through the approval flow." />

        {projectsFetching && !projectsLoading ? (
          <div className="rounded-lg border border-purple-500/30 bg-purple-600/10 px-4 py-2 text-sm text-purple-200">
            Fetching latest data...
          </div>
        ) : null}

        <Card className="p-6">
          <h2 className="text-lg font-medium">Create Project</h2>
          {!canCreate ? (
            <div className="text-sm text-muted-foreground mt-3">Your role does not have permission to create projects.</div>
          ) : (
            <form
              className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!pmId || !createTeamLeadId) {
                  setError('Project Manager and Team Lead are required.');
                  return;
                }
                setError(null);
                mutation.mutate();
              }}
            >
              <div className="md:col-span-2 space-y-2">
                <label className="block text-sm font-medium">Project Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>

              {profile?.role === 'admin' ? (
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-medium">Department</label>
                  <select
                    className="w-full rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70"
                    value={department}
                    onChange={(e) => {
                      setDepartment(e.target.value);
                      setPmId('');
                      setCreateTeamLeadId('');
                      setSelectedEmployeeIds(new Set());
                    }}
                  >
                    {allDepartmentsForSelect.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.display_name}
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-muted-foreground">Pick a department first; user lists update automatically.</div>
                </div>
              ) : isDeptManagerRole(profile?.role) ? (
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-medium">Department</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={departmentBadgeClass}>
                      {allDepartmentsForSelect.find((d) => d.code === profile?.department)?.display_name ??
                        profile?.department ??
                        '—'}
                    </span>
                    <span className="text-xs text-muted-foreground">Projects are created for this department only.</span>
                  </div>
                </div>
              ) : (
                <div className="md:col-span-2 text-xs text-muted-foreground">
                  New projects are created in your department: <span className="text-foreground">{profile?.department}</span>
                </div>
              )}

              <div className="md:col-span-2 space-y-2">
                <label className="block text-sm font-medium">Project Manager</label>
                <select
                  className="w-full rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70"
                  value={pmId}
                  onChange={(e) => setPmId(e.target.value)}
                  required
                  disabled={!effectiveDept}
                >
                  <option value="">Select PM ({effectiveDept || '…'})</option>
                  {pmCandidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name ?? u.email} — PM
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2 space-y-2">
                <label className="block text-sm font-medium">Team Lead</label>
                <select
                  className="w-full rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70"
                  value={createTeamLeadId}
                  onChange={(e) => setCreateTeamLeadId(e.target.value)}
                  required
                  disabled={!effectiveDept}
                >
                  <option value="">Select team lead</option>
                  {teamLeadCandidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name ?? u.email} ({u.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2 space-y-2 rounded-lg border border-white/10 bg-[#2a2640]/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-sm font-medium">Assigned employees</label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" className="text-xs py-1 px-2" onClick={selectAllFiltered}>
                      Select all (filtered)
                    </Button>
                    <Button type="button" variant="secondary" className="text-xs py-1 px-2" onClick={clearEmployeeSelection}>
                      Clear
                    </Button>
                  </div>
                </div>
                <Input
                  placeholder="Search by name, email, or job title…"
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  className="text-sm"
                />
                <div className="text-xs text-muted-foreground">
                  Only <span className="text-foreground">employee</span> users in this department. PM cannot be duplicated as a member row.
                </div>
                <div className="max-h-[200px] overflow-y-auto rounded border border-white/10 divide-y divide-white/5">
                  {filteredEmployees.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No employees match.</div>
                  ) : (
                    filteredEmployees.map((u) => (
                      <label key={u.id} className="flex items-start gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-white/5">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border border-white/20 bg-[#2a2640]"
                          checked={selectedEmployeeIds.has(u.id)}
                          onChange={(e) => toggleEmployee(u.id, e.target.checked)}
                        />
                        <span>
                          <span className="text-foreground">{u.name ?? u.email}</span>
                          <span className="text-muted-foreground text-xs ml-2">{u.email}</span>
                          {u.job_title ? (
                            <span className="ml-2 text-[11px] uppercase tracking-wide text-amber-200/80">{u.job_title}</span>
                          ) : null}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="md:col-span-2 flex items-center gap-3">
                <input
                  id="no-po"
                  type="checkbox"
                  checked={noPoMode}
                  onChange={(e) => setNoPoMode(e.target.checked)}
                  className="h-4 w-4 rounded border border-white/20 bg-[#2a2640]"
                />
                <label htmlFor="no-po" className="text-sm text-muted-foreground">
                  Create without PO (raises `no_po` exception)
                </label>
              </div>

              {!noPoMode ? (
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-medium">Select PO</label>
                  <select
                    className="w-full rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70"
                    value={poId}
                    onChange={(e) => setPoId(e.target.value)}
                    disabled={poLoading}
                  >
                    <option value="">-- Choose PO --</option>
                    {poOptions.map((g) => (
                      <option key={g.anchor_po_line_id} value={g.anchor_po_line_id}>
                        {g.po} ({g.vendor ?? '—'})
                        {g.items.length > 1 ? ` · ${g.items.length} line items` : ''}
                      </option>
                    ))}
                  </select>
                  {selectedPoGroup && selectedPoGroup.items.length > 0 ? (
                    <div className="rounded-lg border border-white/10 bg-[#2a2640]/60 p-3 text-xs space-y-2">
                      <div className="font-medium text-foreground">Lines on this PO</div>
                      <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                        {selectedPoGroup.items.map((it) => (
                          <li key={it.id}>
                            <span className="text-foreground">{it.item_code ?? it.po_line_sn ?? '—'}</span>
                            {it.description ? ` — ${it.description}` : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">
                    Budget is the sum of all lines for this PO (remaining value).
                  </div>
                  {poError ? <div className="text-sm text-rose-300">{String(poError)}</div> : null}
                </div>
              ) : (
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-medium">Budget (required)</label>
                  <Input
                    type="number"
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                    min={0.01}
                    step="0.01"
                    required
                  />
                </div>
              )}

              {error ? <div className="md:col-span-2 text-sm text-rose-300">{error}</div> : null}
              {downloadError ? <div className="md:col-span-2 text-sm text-rose-300">{downloadError}</div> : null}

              <Button className="md:col-span-2" disabled={mutation.isPending} type="submit">
                {mutation.isPending ? 'Creating...' : 'Create Project'}
              </Button>
            </form>
          )}
        </Card>

        <Card className="p-6 space-y-4">
          <h2 className="text-lg font-medium">Project List</h2>
          {projectsLoading ? (
            <div className="text-sm text-muted-foreground">Loading projects...</div>
          ) : projectsError ? (
            <div className="text-sm text-rose-300">{String(projectsError)}</div>
          ) : (
            <TableWrapper className="max-h-[520px] overflow-y-auto rounded-xl border border-white/10">
              <Table>
                <THead>
                  <TR>
                    <TH>Project</TH>
                    <TH>Dept</TH>
                    <TH>PM</TH>
                    <TH>Team lead</TH>
                    <TH>Status</TH>
                    <TH className="min-w-[140px]">Last updated</TH>
                    <TH>Budget & usage</TH>
                    <TH>PO</TH>
                    <TH className="w-[160px]">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {(projectsData?.projects ?? []).map((p) => {
                    const poSnap = linkedPurchaseOrder(p);
                    const total = poSnap?.total_value ?? null;
                    const remaining = poSnap?.remaining_value ?? null;
                    const hasPoBudget = total != null && remaining != null && Number.isFinite(total) && Number.isFinite(remaining);
                    return (
                      <TR key={p.id} className="align-top">
                        <TD>
                          <Link href={`/projects/${p.id}`} className="font-medium text-purple-300 hover:underline">
                            {p.name}
                          </Link>
                          {hasPoBudget ? (
                            <div className="mt-2 space-y-0.5 text-xs text-muted-foreground md:hidden">
                              <div>Total budget: {formatPkr(total!)}</div>
                              <div>Remaining budget: {formatPkr(remaining!)}</div>
                            </div>
                          ) : null}
                        </TD>
                        <TD>
                          <span className={departmentBadgeClass}>{p.department_label ?? p.department_id}</span>
                        </TD>
                        <TD className="text-sm max-w-[140px] truncate">
                          {p.pm?.name ?? p.pm?.email ?? '—'}
                        </TD>
                        <TD className="min-w-[180px]">
                          {canAssignTeamLead(profile, p) ? (
                            <select
                              className="w-full max-w-[200px] rounded-lg border border-white/10 bg-[#2a2640] px-2 py-1 text-xs outline-none"
                              value={p.team_lead_id ?? ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                teamLeadMutation.mutate({ projectId: p.id, team_lead_id: v || null });
                              }}
                              disabled={teamLeadMutation.isPending}
                            >
                              <option value="">None</option>
                              {teamLeadCandidatesForDept(p.department_id).map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {p.team_lead?.name ?? p.team_lead?.email ?? (p.team_lead_id ? `${p.team_lead_id.slice(0, 8)}…` : '—')}
                            </span>
                          )}
                        </TD>
                        <TD>{p.is_exception ? `${p.status} (exception)` : p.status}</TD>
                        <TD className="align-top">
                          <LastUpdatedMeta at={p.last_updated_at} user={p.last_updated_by} />
                        </TD>
                        <TD>
                          {hasPoBudget ? (
                            <div className="space-y-2 py-1">
                              <div className="text-sm space-y-0.5">
                                <div>
                                  <span className="text-muted-foreground">Total budget: </span>
                                  <span className="font-medium text-foreground">{formatPkr(total!)}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Remaining budget: </span>
                                  <span className="font-medium text-emerald-200">{formatPkr(remaining!)}</span>
                                </div>
                              </div>
                              <BudgetUsageBar total={total!} remaining={remaining!} />
                            </div>
                          ) : p.po_id ? (
                            <div className="text-sm text-amber-200/90">PO linked — budget details unavailable</div>
                          ) : (
                            <div className="text-sm space-y-0.5">
                              <div>
                                <span className="text-muted-foreground">Budget (no PO): </span>
                                <span className="font-medium">{formatPkr(Number(p.budget))}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">No purchase order — usage bar N/A</div>
                            </div>
                          )}
                        </TD>
                        <TD className="max-w-[240px] truncate text-sm">{p.po_id ? p.po_id : 'No PO'}</TD>
                        <TD>
                          <div className="flex flex-col gap-1">
                            {canDownloadPdf ? (
                              <Button
                                type="button"
                                variant="secondary"
                                className="px-2 py-1 text-xs"
                                disabled={downloadProjectPdfMutation.isPending}
                                onClick={() => downloadProjectPdfMutation.mutate(p.id)}
                              >
                                {downloadProjectPdfMutation.isPending ? 'Generating PDF...' : 'Download PDF'}
                              </Button>
                            ) : null}
                            {canArchiveProject(p, profile) ? (
                              <Button
                                type="button"
                                variant="danger"
                                className="px-2 py-1 text-xs"
                                onClick={() => {
                                  setArchiveError(null);
                                  setArchiveTarget({ id: p.id, name: p.name });
                                }}
                              >
                                Delete
                              </Button>
                            ) : !canDownloadPdf ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : null}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrapper>
          )}
          {(projectsData?.projects ?? []).length === 0 && !projectsLoading && !projectsError ? (
            <div className="text-sm text-muted-foreground">No projects found.</div>
          ) : null}
        </Card>

        {archiveTarget ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-project-title"
          >
            <Card className="max-w-md w-full p-6 space-y-4 border border-white/15 shadow-xl">
              <h3 id="archive-project-title" className="text-lg font-medium">
                Delete project
              </h3>
              <p className="text-sm text-muted-foreground">Are you sure you want to delete this project?</p>
              <p className="text-sm font-medium text-foreground">{archiveTarget.name}</p>
              <p className="text-xs text-muted-foreground">
                The project will be archived (hidden from lists). This is not allowed if the project has approved spend.
              </p>
              {archiveError ? <p className="text-sm text-rose-300">{archiveError}</p> : null}
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={archiveMutation.isPending}
                  onClick={() => {
                    setArchiveTarget(null);
                    setArchiveError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={archiveMutation.isPending}
                  onClick={() => archiveMutation.mutate(archiveTarget.id)}
                >
                  {archiveMutation.isPending ? 'Archiving...' : 'Delete'}
                </Button>
              </div>
            </Card>
          </div>
        ) : null}
      </PageContainer>
    </AppLayout>
  );
}
