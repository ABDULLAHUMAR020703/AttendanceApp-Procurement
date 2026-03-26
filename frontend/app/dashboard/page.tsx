'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppLayout } from '../../components/AppLayout';
import { Card } from '../../components/ui/Card';
import { PageContainer } from '../../components/ui/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { useAuth } from '../../features/auth/AuthProvider';
import { authedFetchWithSupabase, NoSessionError } from '../../lib/api';

type DashboardResponse = {
  projects: number;
  pendingApprovals: number;
  pendingExceptions: number;
  poRecords: number;
};
type PurchaseRequestListItem = {
  id: string;
  description: string;
  status: string;
  created_at: string;
};
type PoRow = {
  id: string;
  po_number: string;
  vendor: string;
  total_value: number;
  remaining_value: number;
  created_at: string;
};

function formatCurrency(amount: number) {
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(amount);
}

function poStatus(remaining: number) {
  if (remaining <= 0) return 'Exhausted';
  return 'Active';
}

export default function DashboardPage() {
  const router = useRouter();
  const { profile, accessToken, session, supabase } = useAuth();
  const token = accessToken;
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'vendor' | 'total' | 'remaining'>('vendor');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['dashboard'],
    enabled: !!token && !!supabase,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<DashboardResponse>(supabase, '/api/dashboard');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });
  const isAdmin = profile?.role === 'admin';
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
        const payload = await authedFetchWithSupabase<{ purchaseOrders: PoRow[] }>(supabase, '/api/po');
        return payload.purchaseOrders ?? [];
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const filteredSortedPos = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = (poList ?? []).filter((row) => row.vendor.toLowerCase().includes(term));
    const sorted = [...filtered].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'vendor') return a.vendor.localeCompare(b.vendor) * dir;
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
            {isAdmin ? (
              <Card className="p-4 space-y-2">
                <div className="text-sm text-muted-foreground">Recent Purchase Requests (Admin)</div>
                {(recentPrs ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground">No purchase requests found.</div>
                ) : (
                  <div className="space-y-1">
                    {(recentPrs ?? []).map((pr) => (
                      <div key={pr.id} className="text-sm">
                        <Link className="text-purple-300 underline" href={`/purchase-requests/${pr.id}`}>
                          {pr.id.slice(0, 8)}...
                        </Link>{' '}
                        - {pr.status}
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
                    placeholder="Search vendor"
                    className="rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70"
                  />
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'vendor' | 'total' | 'remaining')}
                    className="rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70"
                  >
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

              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-[#1f1b33] z-10">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2">Vendor Name</th>
                      <th className="px-3 py-2">PO Number / ID</th>
                      <th className="px-3 py-2">Total Budget</th>
                      <th className="px-3 py-2">Remaining Budget</th>
                      <th className="px-3 py-2">Consumed Amount</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPos.map((row, idx) => {
                      const total = Number(row.total_value);
                      const remaining = Number(row.remaining_value);
                      const consumed = Math.max(0, total - remaining);
                      const usedPct = total > 0 ? Math.min(100, (consumed / total) * 100) : 0;
                      const barColor =
                        remaining <= 0 ? 'bg-rose-500' : usedPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
                      return (
                        <tr
                          key={row.id}
                          className={`${idx % 2 === 0 ? 'bg-white/[0.02]' : 'bg-transparent'} hover:bg-white/[0.06] transition-colors`}
                        >
                          <td className="px-3 py-2">{row.vendor}</td>
                          <td className="px-3 py-2">{row.po_number || row.id.slice(0, 8)}</td>
                          <td className="px-3 py-2">{formatCurrency(total)}</td>
                          <td className="px-3 py-2">{formatCurrency(remaining)}</td>
                          <td className="px-3 py-2">
                            <div className="space-y-1 min-w-[160px]">
                              <div>{formatCurrency(consumed)}</div>
                              <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                                <div className={`h-full ${barColor}`} style={{ width: `${usedPct}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded px-2 py-1 text-xs ${
                                poStatus(remaining) === 'Exhausted'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : 'bg-emerald-500/20 text-emerald-300'
                              }`}
                            >
                              {poStatus(remaining)}
                            </span>
                          </td>
                          <td className="px-3 py-2">{new Date(row.created_at).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                    {pagedPos.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-4 text-muted-foreground">
                          No PO records found.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
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
          </>
        )}
      </PageContainer>
    </AppLayout>
  );
}

