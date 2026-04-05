'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppLayout } from '../../components/AppLayout';
import { AuditHistoryModal } from '../../components/AuditHistoryModal';
import { LastUpdatedMeta, LastUpdatedPanel } from '../../components/LastUpdatedPanel';
import { Card } from '../../components/ui/Card';
import { PageContainer } from '../../components/ui/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { useAuth } from '../../features/auth/AuthProvider';
import { authedFetchWithSupabase, NoSessionError } from '../../lib/api';

type ActivityFeedItem = {
  id: string;
  action: string;
  timestamp: string;
  entity_type: string;
  entity_id: string;
  department_scope: string | null;
  actor: { id: string; name: string | null; email: string | null; role: string | null } | null;
};

type DashboardResponse = {
  projects: number;
  pendingApprovals: number;
  pendingExceptions: number;
  poRecords: number;
  lastSystemUpdate: {
    last_updated_at: string | null;
    last_updated_by: { id: string; name: string | null; email: string | null; role: string | null } | null;
    action: string | null;
    entity_type: string | null;
    entity_id: string | null;
  } | null;
  activityFeed: ActivityFeedItem[];
};
type PurchaseRequestListItem = {
  id: string;
  description: string;
  status: string;
  created_at: string;
  last_updated_at?: string | null;
  last_updated_by?: { id: string; name: string | null; email: string | null; role: string | null } | null;
};
type PoGroup = {
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
  updated_at: string;
  last_updated_at?: string | null;
  last_updated_by?: { id: string; name: string | null; email: string | null; role: string | null } | null;
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
  po_last_transaction?: {
    po_id: string;
    po_number: string | null;
    last_transaction: {
      type: string;
      description: string;
      performed_by: { user_id: string; user_name: string; role: string };
      timestamp: string;
      financials: {
        previous_budget: number;
        transaction_amount: number;
        current_budget: number;
      };
      reference: {
        pr_id: string | null;
        approval_stage: string | null;
        exception_type: string | null;
      };
    } | null;
  };
};

function formatCurrency(amount: number) {
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(amount);
}

function poStatus(remaining: number) {
  if (remaining <= 0) return 'Exhausted';
  return 'Active';
}

/** Badge + financial row colors: green = approval / budget applied, red = rejection, amber = submit / exception. */
function lastActivityStyles(activityType: string) {
  const t = activityType.toLowerCase();
  if (t.includes('reject')) {
    return {
      badge: 'border border-rose-500/45 bg-rose-500/15 text-rose-100',
      money: 'text-rose-100/95',
    };
  }
  if (t.includes('budget applied') || (t.includes('approved') && !t.includes('exception'))) {
    return {
      badge: 'border border-emerald-500/45 bg-emerald-500/15 text-emerald-100',
      money: 'text-emerald-100/95',
    };
  }
  return {
    badge: 'border border-amber-500/45 bg-amber-500/15 text-amber-100',
    money: 'text-amber-100/95',
  };
}

function formatRoleLabel(role: string) {
  if (!role || role === '—') return '—';
  if (role === 'pm') return 'PM';
  if (role === 'dept_head') return 'Dept head';
  if (role === 'admin') return 'Admin';
  if (role === 'employee') return 'Team member';
  if (role === 'team_lead') return 'Team lead';
  return role;
}

function entityDetailHref(entityType: string, entityId: string): string | null {
  const t = entityType.toLowerCase().replace(/-/g, '_');
  if (t === 'purchase_request') return `/purchase-requests/${entityId}`;
  if (t === 'project') return `/projects/${entityId}`;
  if (t === 'approval') return '/approvals';
  return null;
}

export default function DashboardPage() {
  const router = useRouter();
  const { profile, accessToken, session, supabase } = useAuth();
  const token = accessToken;
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'last_activity' | 'vendor' | 'total' | 'remaining'>('last_activity');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [poHistoryAnchorId, setPoHistoryAnchorId] = useState<string | null>(null);
  const [activityDeptFilter, setActivityDeptFilter] = useState('');
  const pageSize = 8;

  const isAdmin = profile?.role === 'admin';

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['dashboard', isAdmin ? activityDeptFilter : 'dept-scoped'],
    enabled: !!token && !!supabase,
    queryFn: async () => {
      try {
        const q =
          isAdmin && activityDeptFilter.trim()
            ? `?department=${encodeURIComponent(activityDeptFilter.trim())}`
            : '';
        return await authedFetchWithSupabase<DashboardResponse>(supabase, `/api/dashboard${q}`);
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const { data: departmentsList } = useQuery({
    queryKey: ['departments'],
    enabled: !!token && !!supabase && isAdmin,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ departments: { code: string; display_name: string }[] }>(
          supabase,
          '/api/departments',
        );
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });
  const { data: recentPrs } = useQuery({
    queryKey: ['dashboard', 'recent-prs'],
    enabled: !!token && !!supabase && isAdmin,
    queryFn: async () => {
      try {
        const payload = await authedFetchWithSupabase<{ purchaseRequests: PurchaseRequestListItem[] }>(
          supabase,
          '/api/purchase-requests',
        );
        return payload.purchaseRequests.slice(0, 8);
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });
  const { data: poList } = useQuery({
    queryKey: ['dashboard', 'po-overview'],
    enabled: !!token && !!supabase,
    queryFn: async () => {
      try {
        const payload = await authedFetchWithSupabase<{ purchaseOrders: PoGroup[] }>(supabase, '/api/po');
        return payload.purchaseOrders ?? [];
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const filteredSortedPos = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = (poList ?? []).filter((g) => {
      if (!term) return true;
      const vend = (g.vendor ?? '').toLowerCase();
      const cust = (g.customer ?? '').toLowerCase();
      const po = g.po.toLowerCase();
      if (vend.includes(term) || cust.includes(term) || po.includes(term)) return true;
      return g.items.some((it) => {
        const code = (it.item_code ?? '').toLowerCase();
        const desc = (it.description ?? '').toLowerCase();
        const sn = (it.po_line_sn ?? '').toLowerCase();
        return code.includes(term) || desc.includes(term) || sn.includes(term);
      });
    });
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'last_activity') {
        const ta = a.po_last_transaction?.last_transaction?.timestamp ?? '';
        const tb = b.po_last_transaction?.last_transaction?.timestamp ?? '';
        if (sortDir === 'desc') return tb.localeCompare(ta);
        return ta.localeCompare(tb);
      }
      const dir = sortDir === 'asc' ? 1 : -1;
      const va = (a.vendor ?? '').toLowerCase();
      const vb = (b.vendor ?? '').toLowerCase();
      if (sortBy === 'vendor') return va.localeCompare(vb) * dir;
      if (sortBy === 'total') return (Number(a.total_value) - Number(b.total_value)) * dir;
      return (Number(a.remaining_value) - Number(b.remaining_value)) * dir;
    });
    return sorted;
  }, [poList, search, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredSortedPos.length / pageSize));
  const pagedPos = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    return filteredSortedPos.slice(start, start + pageSize);
  }, [filteredSortedPos, page, totalPages]);

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader
          title="Dashboard"
          subtitle={profile?.role ? `Role: ${profile.role}` : session ? 'Loading role...' : 'Sign in required'}
        />

        {isFetching && !isLoading ? (
          <Card className="p-3 text-sm text-purple-200 border-purple-500/30">Fetching latest data...</Card>
        ) : null}

        {isLoading ? (
          <Card className="p-4 text-sm text-muted-foreground">Loading...</Card>
        ) : error ? (
          <Card className="p-4 text-sm text-rose-300">{error instanceof Error ? error.message : 'Failed to load dashboard'}</Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Projects</div>
              <div className="text-2xl font-semibold mt-1">{data?.projects ?? 0}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Pending Approvals</div>
              <div className="text-2xl font-semibold mt-1">{data?.pendingApprovals ?? 0}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Pending Exceptions</div>
              <div className="text-2xl font-semibold mt-1">{data?.pendingExceptions ?? 0}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">PO Records</div>
              <div className="text-2xl font-semibold mt-1">{data?.poRecords ?? 0}</div>
            </Card>
            </div>

            <Card className="p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">Activity feed</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Latest actions across the system
                    {isAdmin ? '' : ' · filtered to your department'}
                  </div>
                </div>
                {isAdmin ? (
                  <div className="flex items-center gap-2">
                    <label htmlFor="dash-dept-filter" className="text-xs text-muted-foreground whitespace-nowrap">
                      Department
                    </label>
                    <select
                      id="dash-dept-filter"
                      value={activityDeptFilter}
                      onChange={(e) => setActivityDeptFilter(e.target.value)}
                      className="rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70 min-w-[200px]"
                    >
                      <option value="">All departments</option>
                      {(departmentsList?.departments ?? []).map((d) => (
                        <option key={d.code} value={d.code}>
                          {d.display_name} ({d.code})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
              {(data?.activityFeed ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity.</p>
              ) : (
                <ul className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
                  {(data?.activityFeed ?? []).map((row) => {
                    const href = entityDetailHref(row.entity_type, row.entity_id);
                    const who =
                      row.actor?.name?.trim() ||
                      row.actor?.email?.trim() ||
                      (row.actor ? formatRoleLabel(row.actor.role ?? '') : null) ||
                      'System';
                    return (
                      <li
                        key={row.id}
                        className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {new Date(row.timestamp).toLocaleString()}
                          </span>
                          {row.department_scope ? (
                            <span className="text-[10px] uppercase tracking-wide text-purple-300/90">
                              {row.department_scope}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-foreground">
                          <span className="font-medium">{row.action}</span>
                          <span className="text-muted-foreground">
                            {' '}
                            · {row.entity_type}
                            {href ? (
                              <>
                                {' '}
                                <Link className="text-purple-300 underline" href={href}>
                                  {row.entity_id.slice(0, 8)}…
                                </Link>
                              </>
                            ) : (
                              <span className="text-foreground/80"> {row.entity_id.slice(0, 8)}…</span>
                            )}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {who}
                          {row.actor?.role ? (
                            <span> ({formatRoleLabel(row.actor.role)})</span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            {isAdmin ? (
              <Card className="p-4 space-y-2">
                <div className="text-sm text-muted-foreground">Recent Purchase Requests (Admin)</div>
                {(recentPrs ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground">No purchase requests found.</div>
                ) : (
                  <div className="space-y-1">
                    {(recentPrs ?? []).map((pr) => (
                      <div key={pr.id} className="text-sm space-y-1 border-b border-white/5 pb-2 last:border-0">
                        <div>
                          <Link className="text-purple-300 underline" href={`/purchase-requests/${pr.id}`}>
                            {pr.id.slice(0, 8)}...
                          </Link>{' '}
                          — {pr.status}
                        </div>
                        <LastUpdatedMeta at={pr.last_updated_at} user={pr.last_updated_by} />
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ) : null}
            <Card className="p-4 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="text-sm text-muted-foreground">PO Overview</div>
                <div className="flex flex-col md:flex-row gap-2">
                  <input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search PO, vendor, item…"
                    className="rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70"
                  />
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'vendor' | 'total' | 'remaining')}
                    className="rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70"
                  >
                    <option value="last_activity">Sort: Last activity</option>
                    <option value="vendor">Sort: Vendor</option>
                    <option value="total">Sort: Total Budget</option>
                    <option value="remaining">Sort: Remaining Budget</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                    className="rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm hover:bg-[#352f52]"
                  >
                    {sortDir === 'asc' ? 'Asc' : 'Desc'}
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {pagedPos.map((group) => {
                  const total = Number(group.total_value);
                  const remaining = Number(group.remaining_value);
                  const consumed = Math.max(0, total - remaining);
                  const usedPct = total > 0 ? Math.min(100, (consumed / total) * 100) : 0;
                  const barColor =
                    remaining <= 0 ? 'bg-rose-500' : usedPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
                  return (
                    <Card key={group.anchor_po_line_id} className="p-4 space-y-3 border border-white/10">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-white/10 pb-3">
                        <div>
                          <div className="text-base font-semibold text-foreground">{group.po}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {(group.vendor ?? '—') + (group.customer ? ` · ${group.customer}` : '')}
                            {group.issue_date ? ` · Issued ${group.issue_date}` : ''}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-1">
                            {group.items.length} line item{group.items.length === 1 ? '' : 's'}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm shrink-0">
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</div>
                            <div className="font-medium tabular-nums">{formatCurrency(total)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Remaining</div>
                            <div className="font-medium tabular-nums text-emerald-200">{formatCurrency(remaining)}</div>
                          </div>
                          <div className="col-span-2 sm:col-span-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Consumed</div>
                            <div className="font-medium tabular-nums">{formatCurrency(consumed)}</div>
                            <div className="h-1.5 mt-1 w-full max-w-[200px] rounded-full bg-white/10 overflow-hidden">
                              <div className={`h-full ${barColor}`} style={{ width: `${usedPct}%` }} />
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-start gap-1 sm:items-end">
                          <span
                            className={`rounded px-2 py-1 text-xs ${
                              poStatus(remaining) === 'Exhausted'
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            {poStatus(remaining)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            Last activity {new Date(group.last_updated_at ?? group.updated_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <LastUpdatedPanel
                        updatedAt={group.last_updated_at ?? group.updated_at}
                        updatedBy={
                          group.last_updated_by
                            ? {
                                id: group.last_updated_by.id,
                                name: group.last_updated_by.name,
                                email: group.last_updated_by.email,
                                role: group.last_updated_by.role,
                              }
                            : null
                        }
                        onViewHistory={() => setPoHistoryAnchorId(group.anchor_po_line_id)}
                        className="mt-2"
                      />

                      <div className="rounded-xl border border-purple-500/25 bg-[#1a1730]/90 p-4 space-y-3">
                        <div className="text-[11px] font-bold uppercase tracking-widest text-purple-200/90">
                          Last activity
                        </div>
                        {(() => {
                          const lt = group.po_last_transaction?.last_transaction;
                          if (!lt) {
                            return (
                              <p className="text-sm text-muted-foreground">No transactions yet</p>
                            );
                          }
                          const styles = lastActivityStyles(lt.type);
                          const who = lt.performed_by?.user_name?.trim() || 'System';
                          const role = formatRoleLabel(lt.performed_by?.role ?? '');
                          const { previous_budget, transaction_amount, current_budget } = lt.financials;
                          const showDeduction = transaction_amount > 0 && lt.type.includes('Budget Applied');
                          const sameBudget =
                            Number.isFinite(previous_budget) &&
                            Number.isFinite(current_budget) &&
                            Math.abs(previous_budget - current_budget) < 0.005 &&
                            transaction_amount < 0.005;
                          return (
                            <>
                              <div className="flex flex-wrap items-start gap-2">
                                <span
                                  className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ${styles.badge}`}
                                >
                                  {lt.type}
                                </span>
                              </div>
                              <p className="text-sm text-foreground leading-snug">{lt.description}</p>
                              <div className="text-xs text-muted-foreground space-y-0.5">
                                <div>
                                  <span className="text-muted-foreground">Performed by: </span>
                                  <span className="text-foreground">
                                    {who}
                                    {role !== '—' ? (
                                      <span className="text-muted-foreground"> ({role})</span>
                                    ) : null}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">At: </span>
                                  <span className="text-foreground tabular-nums">
                                    {new Date(lt.timestamp).toLocaleString()}
                                  </span>
                                </div>
                                {lt.reference.pr_id ? (
                                  <div className="text-[11px] pt-1">
                                    PR:{' '}
                                    {isAdmin ? (
                                      <Link
                                        className="text-purple-300 underline"
                                        href={`/purchase-requests/${lt.reference.pr_id}`}
                                      >
                                        {lt.reference.pr_id.slice(0, 8)}…
                                      </Link>
                                    ) : (
                                      <span className="text-foreground/80">{lt.reference.pr_id.slice(0, 8)}…</span>
                                    )}
                                    {lt.reference.approval_stage ? (
                                      <span className="text-muted-foreground">
                                        {' '}
                                        · Stage: {formatRoleLabel(lt.reference.approval_stage)}
                                      </span>
                                    ) : null}
                                    {lt.reference.exception_type ? (
                                      <span className="text-muted-foreground">
                                        {' '}
                                        · Exception: {lt.reference.exception_type}
                                      </span>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                              <div
                                className={`grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-xs ${styles.money}`}
                              >
                                <div>
                                  <div className="text-[10px] uppercase tracking-wide text-white/50">
                                    Budget before
                                  </div>
                                  <div className="font-semibold tabular-nums">{formatCurrency(previous_budget)}</div>
                                </div>
                                <div>
                                  <div className="text-[10px] uppercase tracking-wide text-white/50">
                                    {showDeduction ? 'Transaction' : lt.type.includes('Submitted') ? 'Requested' : 'Transaction'}
                                  </div>
                                  <div className="font-semibold tabular-nums">
                                    {showDeduction
                                      ? `−${formatCurrency(transaction_amount)}`
                                      : lt.type.includes('Submitted') && transaction_amount > 0
                                        ? formatCurrency(transaction_amount)
                                        : sameBudget
                                          ? '—'
                                          : transaction_amount > 0
                                            ? formatCurrency(transaction_amount)
                                            : '—'}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[10px] uppercase tracking-wide text-white/50">Remaining</div>
                                  <div className="font-semibold tabular-nums">{formatCurrency(current_budget)}</div>
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      <div className="overflow-x-auto rounded-lg border border-white/5">
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground border-b border-white/10">
                              <th className="px-2 py-1.5 font-medium">Item</th>
                              <th className="px-2 py-1.5 font-medium">Line</th>
                              <th className="px-2 py-1.5 font-medium text-right">Line amount</th>
                              <th className="px-2 py-1.5 font-medium text-right">Remaining</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.items.map((it, idx) => (
                              <tr
                                key={it.id}
                                className={idx % 2 === 0 ? 'bg-white/[0.02]' : 'bg-transparent'}
                              >
                                <td className="px-2 py-1.5 max-w-[200px]">
                                  <div className="text-foreground font-medium">{it.item_code ?? '—'}</div>
                                  {it.description ? (
                                    <div className="text-muted-foreground line-clamp-2">{it.description}</div>
                                  ) : null}
                                </td>
                                <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                                  {it.line_no ?? it.po_line_sn ?? '—'}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(it.po_amount)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-emerald-200/90">
                                  {formatCurrency(it.remaining_amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  );
                })}
                {pagedPos.length === 0 ? (
                  <div className="rounded-xl border border-white/10 px-3 py-4 text-sm text-muted-foreground text-center">
                    No PO records found.
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, filteredSortedPos.length)} of {filteredSortedPos.length}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-white/10 px-3 py-1 text-xs disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded border border-white/10 px-3 py-1 text-xs disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </Card>

            <AuditHistoryModal
              open={poHistoryAnchorId != null}
              onClose={() => setPoHistoryAnchorId(null)}
              entityType="purchase_order"
              entityId={poHistoryAnchorId ?? ''}
              title="PO line history (anchor row)"
              supabase={supabase}
              token={token ?? ''}
              onAuthRedirect={() => router.replace('/login')}
            />
          </>
        )}
      </PageContainer>
    </AppLayout>
  );
}

