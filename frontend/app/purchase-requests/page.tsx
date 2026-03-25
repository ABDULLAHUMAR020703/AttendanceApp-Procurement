'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../../components/AppLayout';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { PageContainer } from '../../components/ui/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from '../../components/ui/Table';
import { useAuth } from '../../features/auth/AuthProvider';
import { ApiError, authedFetch, formatPkr } from '../../lib/api';

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
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const token = accessToken ?? '';
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [document, setDocument] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: projectsData } = useQuery({
    queryKey: ['projects', 'for-pr'],
    enabled: !!token,
    queryFn: () => authedFetch<{ projects: Project[] }>('/api/projects', token),
  });

  const { data: prData, isLoading: prLoading, isFetching: prFetching } = useQuery({
    queryKey: ['purchase-requests', 'list'],
    enabled: !!token,
    queryFn: () => authedFetch<{ purchaseRequests: PurchaseRequest[] }>('/api/purchase-requests', token),
  });

  const projects = useMemo(() => (projectsData?.projects ?? []) as Project[], [projectsData]);
  const selectedProject = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const selectedPo = useMemo(() => linkedPurchaseOrder(selectedProject), [selectedProject]);
  const availableBudget = useMemo(() => availableBudgetForProject(selectedProject), [selectedProject]);
  const isOverBudget =
    availableBudget != null && Number.isFinite(amount) && amount > 0 && amount > availableBudget;

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!projectId) throw new Error('Select a project');
      if (!description.trim()) throw new Error('Description is required');
      if (!amount || amount <= 0) throw new Error('Amount must be > 0');
      if (!document) throw new Error('Document upload is required');

      const apiBase = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000';
      const fd = new FormData();
      fd.append('project_id', projectId);
      fd.append('description', description);
      fd.append('amount', String(amount));
      fd.append('document', document);

      const res = await fetch(`${apiBase}/api/purchase-requests`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
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
                required
              />
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
              <label className="block text-sm font-medium">Document</label>
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
              disabled={mutation.isPending || isOverBudget}
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
                  </TR>
                </THead>
                <TBody>
                  {(prData?.purchaseRequests ?? []).map((pr) => (
                    <TR key={pr.id}>
                      <TD>{pr.description}</TD>
                      <TD>{pr.amount}</TD>
                      <TD>{pr.status}</TD>
                      <TD>PR: {pr.id.slice(0, 8)}...</TD>
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
      </PageContainer>
    </AppLayout>
  );
}

