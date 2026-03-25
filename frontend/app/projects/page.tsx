'use client';

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
import { ApiError, authedFetchWithSupabase, NoSessionError } from '../../lib/api';

type PurchaseOrder = { id: string; po_number: string; vendor: string; total_value: number; remaining_value: number };
type ProjectPurchaseOrderSnapshot = { total_value: number; remaining_value: number };
type Project = {
  id: string;
  name: string;
  po_id: string | null;
  budget: number;
  status: string;
  is_exception: boolean;
  created_at: string;
  created_by: string;
  /** Populated by GET /projects when project is linked to a PO (additive field). */
  purchase_order?: ProjectPurchaseOrderSnapshot | ProjectPurchaseOrderSnapshot[] | null;
};

function formatPkr(amount: number) {
  if (!Number.isFinite(amount)) return '—';
  return `${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(amount)} PKR`;
}

/** Normalize Supabase embed (object or rare array) into a single PO snapshot. */
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

function canArchiveProject(
  p: Project,
  profile: { userId: string; role: string } | null,
): boolean {
  if (!profile) return false;
  if (profile.role === 'admin' || profile.role === 'super_admin') return true;
  if (profile.role === 'pm') return p.created_by === profile.userId;
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

/** Matches backend GET /api/po allowed roles (shared PO list for procurement roles). */
const ROLES_WITH_PO_LIST = new Set<string>([
  'admin',
  'super_admin',
  'pm',
  'manager',
  'team_lead',
  'finance',
  'dept_head',
  'gm',
]);

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
        return await authedFetchWithSupabase<{ purchaseOrders: PurchaseOrder[] }>(supabase, '/api/po');
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

  const canCreate =
    profile?.role === 'super_admin' ||
    profile?.role === 'manager' ||
    profile?.role === 'admin' ||
    profile?.role === 'pm' ||
    profile?.role === 'team_lead';

  const [name, setName] = useState('');
  const [poId, setPoId] = useState<string>('');
  const [noPoMode, setNoPoMode] = useState(false);
  const [budget, setBudget] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

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
      const payload: any = { name };
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
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: any) => setError(err?.message ?? 'Create failed'),
  });

  const poOptions = useMemo(() => poData?.purchaseOrders ?? [], [poData]);

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
                mutation.mutate();
              }}
            >
              <div className="md:col-span-2 space-y-2">
                <label className="block text-sm font-medium">Project Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
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
                    {poOptions.map((po) => (
                      <option key={po.id} value={po.id}>
                        {po.po_number} ({po.vendor})
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-muted-foreground">
                    Budget will be derived from the selected PO remaining value.
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

              <Button
                className="md:col-span-2"
                disabled={mutation.isPending}
                type="submit"
              >
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
                    <TH>Status</TH>
                    <TH>Budget & usage</TH>
                    <TH>PO</TH>
                    <TH className="w-[120px]">Actions</TH>
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
                          <div className="font-medium">{p.name}</div>
                          {hasPoBudget ? (
                            <div className="mt-2 space-y-0.5 text-xs text-muted-foreground md:hidden">
                              <div>Total budget: {formatPkr(total!)}</div>
                              <div>Remaining budget: {formatPkr(remaining!)}</div>
                            </div>
                          ) : null}
                        </TD>
                        <TD>{p.is_exception ? `${p.status} (exception)` : p.status}</TD>
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
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
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
              <p className="text-sm text-muted-foreground">
                Are you sure you want to delete this project?
              </p>
              <p className="text-sm font-medium text-foreground">{archiveTarget.name}</p>
              <p className="text-xs text-muted-foreground">
                The project will be archived (hidden from lists). This is not allowed if the project has approved
                spend.
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

