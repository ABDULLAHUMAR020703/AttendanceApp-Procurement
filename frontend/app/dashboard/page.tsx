'use client';

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

export default function DashboardPage() {
  const router = useRouter();
  const { profile, accessToken, session, supabase } = useAuth();
  const token = accessToken;

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
        )}
      </PageContainer>
    </AppLayout>
  );
}

