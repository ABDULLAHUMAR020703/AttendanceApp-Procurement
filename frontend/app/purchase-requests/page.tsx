'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppLayout } from '../../components/AppLayout';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { PageContainer } from '../../components/ui/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from '../../components/ui/Table';
import { useAuth } from '../../features/auth/AuthProvider';
import { ApiError, authedFetchWithSupabase, formatPkr, getAccessTokenFromSupabaseSession, NoSessionError } from '../../lib/api';

type ProjectPurchaseOrderSnapshot = { total_value: number; remaining_value: number };
type Project = {
  id: string;
  name: string;
  status: string;
  is_exception: boolean;
  po_id: string | null;
  budget: number;
  purchase_order?: ProjectPurchaseOrderSnapshot | ProjectPurchaseOrderSnapshot[] | null;
};
type PurchaseRequest = { id: string; project_id: string; description: string; amount: number; document_url: string | null; status: string; created_at: string; created_by: string };

function linkedPurchaseOrder(p: Project | undefined): ProjectPurchaseOrderSnapshot | null {
  if (!p) return null;
  const raw = p.purchase_order;
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const row = raw[0];
    if (!row) return null;
    return { total_value: Number(row.total_value), remaining_value: Number(row.remaining_value) };
  }
  return { total_value: Number(raw.total_value), remaining_value: Number(raw.remaining_value) };
}

/** Matches backend: PO-linked projects use PO remaining_value; no-PO uses project budget. */
function availableBudgetForProject(p: Project | undefined): number | null {
  if (!p) return null;
  const po = linkedPurchaseOrder(p);
  if (po && Number.isFinite(po.remaining_value)) return po.remaining_value;
  if (!p.po_id && Number.isFinite(Number(p.budget))) return Number(p.budget);
  return null;
}

export default function PurchaseRequestsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, supabase, profile } = useAuth();
  const token = accessToken ?? '';
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [document, setDocument] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<string | null>(null);
  const [overrideDecision, setOverrideDecision] = useState<'approved' | 'rejected'>('approved');
  const [overrideReason, setOverrideReason] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const isAdmin = profile?.role === 'admin';

  const { data: projectsData } = useQuery({
    queryKey: ['projects', 'for-pr'],
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

  const { data: prData, isLoading: prLoading, isFetching: prFetching } = useQuery({
    queryKey: ['purchase-requests', 'list'],
    enabled: !!token && !!supabase,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ purchaseRequests: PurchaseRequest[] }>(
          supabase,
          '/api/purchase-requests',
        );
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const projects = useMemo(() => (projectsData?.projects ?? []) as Project[], [projectsData]);
  const selectedProject = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const selectedPo = useMemo(() => linkedPurchaseOrder(selectedProject), [selectedProject]);
  const availableBudget = useMemo(() => availableBudgetForProject(selectedProject), [selectedProject]);
  const isOverBudget =
    availableBudget != null && Number.isFinite(amount) && amount > 0 && amount > availableBudget;
  const descriptionTrimmed = description.trim();
  const descriptionInvalid = descriptionTrimmed.length < 10;

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!projectId) throw new Error('Select a project');
      if (!description.trim()) throw new Error('Description is required');
      if (description.trim().length < 10) throw new Error('Description must be at least 10 characters');
      if (!amount || amount <= 0) throw new Error('Amount must be > 0');

      const apiBase = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000';
      let bearer: string;
      try {
        bearer = await getAccessTokenFromSupabaseSession(supabase);
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
      const fd = new FormData();
      fd.append('project_id', projectId);
      fd.append('description', description);
      fd.append('amount', String(amount));
      if (document) fd.append('document', document);

      const res = await fetch(`${apiBase}/api/purchase-requests`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
        body: fd,
      });
      let body: Record<string, unknown> = {};
      try {
        const json = await res.json();
        if (json && typeof json === 'object' && !Array.isArray(json)) body = json as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      if (!res.ok) throw new ApiError(res.status, body);
      return body;
    },
    onSuccess: () => {
      setError(null);
      setSubmitAttempted(false);
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setProjectId('');
      setDescription('');
      setAmount(0);
      setDocument(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'PR creation failed'),
  });

  const overrideMutation = useMutation({
    mutationFn: async (params: { requestId: string; decision: 'approved' | 'rejected'; reason: string }) => {
      try {
        return await authedFetchWithSupabase<unknown>(supabase, '/api/approvals/override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      setOverrideTarget(null);
      setOverrideReason('');
      setOverrideDecision('approved');
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Override failed'),
  });

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader title="Purchase Requests" subtitle="Submit and track procurement requests." />

        {prFetching && !prLoading ? (
          <div className="rounded-lg border border-purple-500/30 bg-purple-600/10 px-4 py-2 text-sm text-purple-200">
            Fetching latest data...
          </div>
        ) : null}

        <Card className="p-6">
          <h2 className="text-lg font-medium">Create PR</h2>
          <form
            className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitAttempted(true);
              if (descriptionInvalid) {
                setError('Description is required');
                return;
              }
              mutation.mutate();
            }}
          >
            <div className="md:col-span-2 space-y-2">
              <label className="block text-sm font-medium">Project</label>
              <select
                className="w-full rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">-- Select Project --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.status !== 'active'}>
                    {p.name} {p.status !== 'active' ? '(blocked)' : ''}
                  </option>
                ))}
              </select>
              {selectedProject ? (
                <div className="rounded-lg border border-white/10 bg-[#2a2640]/80 px-3 py-2 text-sm space-y-1">
                  <div className="text-muted-foreground">Available budget for this project</div>
                  {availableBudget != null ? (
                    <div className="font-semibold text-emerald-200">{formatPkr(availableBudget)}</div>
                  ) : selectedProject.po_id ? (
                    <div className="text-amber-200/90 text-xs">
                      Linked PO details could not be loaded. Refresh the page or check the project on the Projects page.
                    </div>
                  ) : (
                    <div className="font-semibold text-foreground">{formatPkr(Number(selectedProject.budget))}</div>
                  )}
                  {selectedPo ? (
                    <div className="text-xs text-muted-foreground pt-1 space-y-0.5">
                      <div>Total budget (PO): {formatPkr(selectedPo.total_value)}</div>
                      <div>Remaining budget: {formatPkr(selectedPo.remaining_value)}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="md:col-span-2 space-y-2">
              <label className="block text-sm font-medium">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={submitAttempted && descriptionInvalid ? 'border-rose-500 focus:ring-rose-500/70 focus:border-rose-400/70' : undefined}
                required
              />
              {submitAttempted && descriptionInvalid ? (
                <p className="text-sm text-rose-300">Description is required (minimum 10 characters).</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium">Amount</label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                min={0}
                step="0.01"
                required
              />
              {isOverBudget ? (
                <p className="text-sm font-medium text-rose-300">
                  This exceeds the available budget ({formatPkr(availableBudget!)}). Reduce the amount or pick another
                  project.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium">Upload Document (Optional)</label>
              <Input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                onChange={(e) => setDocument(e.target.files?.[0] ?? null)}
                className="file:mr-4 file:rounded-lg file:border-0 file:bg-purple-600 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-purple-700"
              />
            </div>

            {error ? <div className="md:col-span-2 text-sm text-rose-300">{error}</div> : null}

            <Button
              className="md:col-span-2"
              disabled={mutation.isPending || isOverBudget || descriptionInvalid}
              type="submit"
            >
              {mutation.isPending ? 'Submitting...' : 'Submit PR'}
            </Button>
          </form>
        </Card>

        <Card className="p-6 space-y-4">
          <h2 className="text-lg font-medium">PR List</h2>
          {prLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <TableWrapper className="max-h-[420px] overflow-y-auto rounded-xl border border-white/10">
              <Table>
                <THead>
                  <TR>
                    <TH>Description</TH>
                    <TH>Amount</TH>
                    <TH>Status</TH>
                    <TH>Request</TH>
                    {isAdmin ? <TH>Actions</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {(prData?.purchaseRequests ?? []).map((pr) => (
                    <TR key={pr.id}>
                      <TD>{pr.description}</TD>
                      <TD>{pr.amount}</TD>
                      <TD>{pr.status}</TD>
                      <TD>
                        {isAdmin ? (
                          <Link className="text-purple-300 underline" href={`/purchase-requests/${pr.id}`}>
                            PR: {pr.id.slice(0, 8)}...
                          </Link>
                        ) : (
                          <>PR: {pr.id.slice(0, 8)}...</>
                        )}
                      </TD>
                      {isAdmin ? (
                        <TD>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setOverrideTarget(pr.id);
                              setOverrideDecision('approved');
                              setOverrideReason('');
                            }}
                          >
                            Override
                          </Button>
                        </TD>
                      ) : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
          {(prData?.purchaseRequests ?? []).length === 0 && !prLoading ? (
            <div className="text-sm text-muted-foreground">No purchase requests found.</div>
          ) : null}
        </Card>
        {overrideTarget && isAdmin ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
            <Card className="max-w-md w-full p-6 space-y-4 border border-white/15 shadow-xl">
              <h3 className="text-lg font-medium">Admin Override</h3>
              <p className="text-sm text-muted-foreground">Request: {overrideTarget}</p>
              <div className="space-y-2">
                <label className="block text-sm font-medium">Decision</label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={overrideDecision === 'approved' ? 'success' : 'secondary'}
                    onClick={() => setOverrideDecision('approved')}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant={overrideDecision === 'rejected' ? 'danger' : 'secondary'}
                    onClick={() => setOverrideDecision('rejected')}
                  >
                    Reject
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium">Reason (required)</label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#2a2640] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/70"
                  rows={4}
                  placeholder="Enter override reason"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setOverrideTarget(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant={overrideDecision === 'approved' ? 'success' : 'danger'}
                  disabled={!overrideReason.trim() || overrideMutation.isPending}
                  onClick={() =>
                    overrideMutation.mutate({
                      requestId: overrideTarget,
                      decision: overrideDecision,
                      reason: overrideReason.trim(),
                    })
                  }
                >
                  {overrideMutation.isPending ? 'Applying...' : 'Apply Override'}
                </Button>
              </div>
            </Card>
          </div>
        ) : null}
      </PageContainer>
    </AppLayout>
  );
}

