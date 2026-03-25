'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../../components/AppLayout';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageContainer } from '../../components/ui/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from '../../components/ui/Table';
import { useAuth } from '../../features/auth/AuthProvider';
import { authedFetch } from '../../lib/api';
import { useState } from 'react';

type Approval = {
  id: string;
  request_id: string;
  approver_id: string;
  role: string;
  status: string;
  comments: string | null;
  created_at: string;
};

export default function ApprovalsPage() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  const [comments, setComments] = useState<Record<string, string>>({});

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['approvals', 'mine'],
    enabled: !!token,
    queryFn: () => authedFetch<{ approvals: Approval[] }>('/api/approvals', token),
  });

  const decisionMutation = useMutation({
    mutationFn: async (params: { approvalId: string; decision: 'approved' | 'rejected' }) => {
      return authedFetch('/api/approvals/' + params.approvalId + '/decision', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: params.decision,
          comments: (comments[params.approvalId] ?? '').trim() || undefined,
        }),
      } as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader title="Approvals" subtitle="Approve or reject workflow items assigned to your role." />

        {isFetching && !isLoading ? (
          <Card className="p-3 text-sm text-purple-200 border-purple-500/30">Fetching latest data...</Card>
        ) : null}

        {isLoading ? (
          <Card className="p-4 text-sm text-muted-foreground">Loading...</Card>
        ) : error ? (
          <Card className="p-4 text-sm text-rose-300">{error instanceof Error ? error.message : 'Failed to load approvals'}</Card>
        ) : (
          <div className="space-y-4">
            <Card className="p-0">
              <TableWrapper className="max-h-[360px] overflow-y-auto rounded-2xl">
                <Table>
                  <THead>
                    <TR>
                      <TH>Request</TH>
                      <TH>Role</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {(data?.approvals ?? []).map((a) => (
                      <TR key={a.id}>
                        <TD>{a.request_id}</TD>
                        <TD>{a.role}</TD>
                        <TD>{a.status}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            </Card>

            {(data?.approvals ?? []).map((a) => (
              <Card key={a.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Request: {a.request_id}</div>
                    <div className="text-sm text-muted-foreground">Stage role: {a.role}</div>
                    <div className="text-sm text-muted-foreground">Status: {a.status}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium">Comments (optional)</label>
                  <textarea
                    value={comments[a.id] ?? ''}
                    onChange={(e) => setComments((prev) => ({ ...prev, [a.id]: e.target.value }))}
                    className="w-full rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70"
                    rows={3}
                    placeholder="Add a decision comment"
                  />
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="success"
                    disabled={a.status !== 'pending' || decisionMutation.isPending}
                    onClick={() => decisionMutation.mutate({ approvalId: a.id, decision: 'approved' })}
                    type="button"
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    disabled={a.status !== 'pending' || decisionMutation.isPending}
                    onClick={() => decisionMutation.mutate({ approvalId: a.id, decision: 'rejected' })}
                    type="button"
                  >
                    Reject
                  </Button>
                </div>
              </Card>
            ))}
            {(data?.approvals ?? []).length === 0 ? (
              <Card className="p-4 text-sm text-muted-foreground">No approvals found.</Card>
            ) : null}
          </div>
        )}
      </PageContainer>
    </AppLayout>
  );
}

