'use client';

import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '../../components/AppLayout';
import { Card } from '../../components/ui/Card';
import { PageContainer } from '../../components/ui/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { useAuth } from '../../features/auth/AuthProvider';
import { authedFetch } from '../../lib/api';

type DashboardResponse = {
  role: string;
  projects: Array<{ id: string }>;
  pendingApprovals: Array<{ id: string }>;
  pendingExceptions: Array<{ id: string }>;
  poUtilization: Array<{ id: string; total_value: number; remaining_value: number }>;
};

function formatPkr(amount: number) {
  return `${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(amount)} PKR`;
}

export default function DashboardPage() {
  const { profile, accessToken, session } = useAuth() as any;
  const token = accessToken as string | null;

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['dashboard'],
    enabled: !!token,
    queryFn: () => authedFetch<DashboardResponse>('/api/dashboard', token!),
  });

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Projects</div>
              <div className="text-2xl font-semibold mt-1">{data?.projects?.length ?? 0}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Pending Approvals</div>
              <div className="text-2xl font-semibold mt-1">{data?.pendingApprovals?.length ?? 0}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Pending Exceptions</div>
              <div className="text-2xl font-semibold mt-1">{data?.pendingExceptions?.length ?? 0}</div>
            </Card>
            <Card className="p-4 border-emerald-500/25 bg-emerald-500/5">
              <div className="text-sm text-muted-foreground">Remaining Budget Across POs</div>
              <div className="text-2xl font-semibold mt-1 text-emerald-200">
                {formatPkr(
                  (data?.poUtilization ?? []).reduce((sum, po) => sum + Number(po.remaining_value ?? 0), 0),
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Sum of remaining_value on all loaded POs</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">PO Records</div>
              <div className="text-2xl font-semibold mt-1">{data?.poUtilization?.length ?? 0}</div>
            </Card>
          </div>
        )}
      </PageContainer>
    </AppLayout>
  );
}

