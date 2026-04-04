'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppLayout } from '../../components/AppLayout';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { PageContainer } from '../../components/ui/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { PoLineTypeahead, type PoSearchLine } from '../../components/PoLineTypeahead';
import { PrPoLineMetricsCells, type PoLineSummary } from '../../components/PrPoLineMetricsCells';
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from '../../components/ui/Table';
import { useAuth } from '../../features/auth/AuthProvider';
import { ApiError, authedFetchWithSupabase, formatPkr, getAccessTokenFromSupabaseSession, NoSessionError } from '../../lib/api';
import { sortApprovalStageIndex } from '../../lib/org';

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
type PurchaseRequest = {
  id: string;
  project_id: string;
  description: string;
  amount: number;
  document_url: string | null;
  item_code?: string | null;
  duplicate_count?: number | null;
  po_line_id?: string | null;
  requested_quantity?: number | null;
  po_line_summary?: PoLineSummary | null;
  status: string;
  created_at: string;
  created_by: string;
};

function ordinalTimeWord(occurrence: number): string {
  const specials: Record<number, string> = {
    2: 'second',
    3: 'third',
    4: 'fourth',
    5: 'fifth',
    6: 'sixth',
    7: 'seventh',
    8: 'eighth',
    9: 'ninth',
    10: 'tenth',
    11: 'eleventh',
    12: 'twelfth',
  };
  if (specials[occurrence]) return specials[occurrence]!;
  const mod100 = occurrence % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${occurrence}th`;
  switch (occurrence % 10) {
    case 1:
      return `${occurrence}st`;
    case 2:
      return `${occurrence}nd`;
    case 3:
      return `${occurrence}rd`;
    default:
      return `${occurrence}th`;
  }
}

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
  const [selectedPoLine, setSelectedPoLine] = useState<PoSearchLine | null>(null);
  const [fallbackItemCode, setFallbackItemCode] = useState('');
  const [requestedQty, setRequestedQty] = useState<string>('');
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
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

  const prListIds = useMemo(() => (prData?.purchaseRequests ?? []).map((p) => p.id), [prData]);

  const { data: prApprovalsForAdmin } = useQuery({
    queryKey: ['approvals', 'admin-pr-force-map', prListIds.join(',')],
    enabled: isAdmin && !!supabase && prListIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('approvals')
        .select('id, request_id, role, status')
        .in('request_id', prListIds);
      if (error) throw error;
      return (data ?? []) as { id: string; request_id: string; role: string; status: string }[];
    },
  });

  const firstPendingRequiredByPr = useMemo(() => {
    const map = new Map<string, string>();
    const rows = prApprovalsForAdmin ?? [];
    for (const prId of prListIds) {
      const pending = rows.filter(
        (r) =>
          r.request_id === prId &&
          r.status === 'pending' &&
          (r.role === 'team_lead' || r.role === 'pm'),
      );
      pending.sort((a, b) => sortApprovalStageIndex(a.role) - sortApprovalStageIndex(b.role));
      if (pending[0]) map.set(prId, pending[0].id);
    }
    return map;
  }, [prApprovalsForAdmin, prListIds]);

  const projects = useMemo(() => (projectsData?.projects ?? []) as Project[], [projectsData]);
  const selectedProject = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const selectedPo = useMemo(() => linkedPurchaseOrder(selectedProject), [selectedProject]);
  const availableBudget = useMemo(() => availableBudgetForProject(selectedProject), [selectedProject]);
  const hasProjectPo = Boolean(selectedProject?.po_id);
  const duplicateItemKey = (
    selectedPoLine?.item_code?.trim().toLowerCase() ||
    fallbackItemCode.trim().toLowerCase() ||
    ''
  ).trim();

  const lineDrivesAmount = Boolean(
    selectedPoLine != null && Number.isFinite(Number(selectedPoLine.unit_price)) && Number(selectedPoLine.unit_price) > 0,
  );

  const qtyNum = useMemo(() => {
    const q = Number(String(requestedQty).trim());
    return Number.isFinite(q) && q > 0 ? q : 0;
  }, [requestedQty]);

  const computedAmount = useMemo(() => {
    if (!lineDrivesAmount || !selectedPoLine || qtyNum <= 0) return null;
    const up = Number(selectedPoLine.unit_price);
    if (!(up > 0)) return null;
    return Math.round(qtyNum * up * 100) / 100;
  }, [lineDrivesAmount, selectedPoLine, qtyNum]);

  /** Amount used for validation, submission, and PO line checks (backend recomputes when line + qty). */
  const effectiveAmount = useMemo(() => {
    if (!hasProjectPo) {
      return Number.isFinite(amount) && amount > 0 ? amount : 0;
    }
    if (!selectedPoLine) return 0;
    if (lineDrivesAmount) {
      return computedAmount != null && computedAmount > 0 ? computedAmount : 0;
    }
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }, [hasProjectPo, selectedPoLine, lineDrivesAmount, computedAmount, amount]);

  const isOverBudgetNoPo =
    !hasProjectPo &&
    availableBudget != null &&
    Number.isFinite(amount) &&
    amount > 0 &&
    amount > availableBudget;

  const exceedsLineBudget =
    hasProjectPo &&
    selectedPoLine != null &&
    effectiveAmount > 0 &&
    effectiveAmount > selectedPoLine.effective_remaining;

  const descriptionTrimmed = description.trim();
  const descriptionInvalid = descriptionTrimmed.length < 10;

  const { data: duplicateCountData } = useQuery({
    queryKey: ['purchase-requests', 'duplicate-count', duplicateItemKey],
    enabled: !!token && !!supabase && duplicateItemKey.length > 0,
    queryFn: async () => {
      try {
        const params = new URLSearchParams({ item_code: duplicateItemKey });
        return await authedFetchWithSupabase<{ previousCount: number }>(
          supabase!,
          `/api/purchase-requests/item-duplicate-count?${params.toString()}`,
        );
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const previousSameItemCount = duplicateCountData?.previousCount ?? 0;
  const nextOccurrence = previousSameItemCount + 1;
  const showDuplicateHighlight = duplicateItemKey.length > 0 && previousSameItemCount >= 1;
  const duplicateBorderClass = !showDuplicateHighlight
    ? undefined
    : previousSameItemCount >= 3
      ? 'border-red-500'
      : previousSameItemCount >= 2
        ? 'border-orange-500'
        : 'border-amber-400';

  useEffect(() => {
    setDuplicateModalOpen(false);
  }, [duplicateItemKey]);

  useEffect(() => {
    setSelectedPoLine(null);
    setFallbackItemCode('');
    setRequestedQty('');
  }, [projectId]);

  useEffect(() => {
    if (!selectedPoLine) setRequestedQty('');
  }, [selectedPoLine]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!projectId) throw new Error('Select a project');
      if (!description.trim()) throw new Error('Description is required');
      if (description.trim().length < 10) throw new Error('Description must be at least 10 characters');
      if (!effectiveAmount || effectiveAmount <= 0) throw new Error('Amount must be > 0');

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
      fd.append('amount', String(effectiveAmount));
      if (selectedPoLine) {
        fd.append('po_line_sn', selectedPoLine.po_line_sn);
      } else if (fallbackItemCode.trim()) {
        fd.append('item_code', fallbackItemCode.trim());
      }
      if (selectedPoLine && lineDrivesAmount && qtyNum > 0) {
        fd.append('requested_quantity', String(qtyNum));
      }
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
      setSelectedPoLine(null);
      setFallbackItemCode('');
      setRequestedQty('');
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

  const forceApproveFromListMutation = useMutation({
    mutationFn: async (approvalId: string) => {
      try {
        return await authedFetchWithSupabase<unknown>(
          supabase,
          '/api/approvals/' + approvalId + '/decision',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved' }),
          },
        );
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Force approve failed'),
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
              if (!projectId) {
                setError('Select a project');
                return;
              }
              if (!effectiveAmount || effectiveAmount <= 0) {
                setError(
                  hasProjectPo && selectedPoLine && lineDrivesAmount
                    ? 'Enter a valid quantity (amount is calculated from unit price)'
                    : 'Amount must be greater than 0',
                );
                return;
              }
              if (hasProjectPo && !selectedPoLine) {
                setError('Select an item / PO line for this project');
                return;
              }
              if (isOverBudgetNoPo) return;
              if (hasProjectPo && exceedsLineBudget) return;
              if (duplicateItemKey && previousSameItemCount >= 1) {
                setDuplicateModalOpen(true);
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

            {hasProjectPo ? (
              <div className={`md:col-span-2 space-y-2 rounded-lg border border-white/10 bg-[#2a1820]/20 p-3 ${duplicateBorderClass ?? ''}`}>
                <label className="block text-sm font-medium">Select Item / PO Line</label>
                <PoLineTypeahead
                  projectId={projectId}
                  enabled={hasProjectPo && !!projectId}
                  supabase={supabase}
                  token={token}
                  selectedLine={selectedPoLine}
                  onSelectLine={(line) => {
                    setSelectedPoLine(line);
                    if (line?.description && description.trim().length < 10) {
                      setDescription(line.description);
                    }
                  }}
                />
                {showDuplicateHighlight ? (
                  <p className="text-sm text-amber-200/90">
                    You have already submitted {previousSameItemCount}{' '}
                    {previousSameItemCount === 1 ? 'request' : 'requests'} for this item code.
                  </p>
                ) : null}
                {hasProjectPo && selectedPoLine && exceedsLineBudget ? (
                  <p className="text-sm font-medium text-rose-300">Exceeds PO limit for this line (remaining after other pending PRs: {formatPkr(selectedPoLine.effective_remaining)}).</p>
                ) : null}
              </div>
            ) : (
              <div className={`md:col-span-2 space-y-2 ${duplicateBorderClass ? `rounded-lg border p-3 ${duplicateBorderClass}` : ''}`}>
                <label className="block text-sm font-medium">Item code (optional, no PO on project)</label>
                <Input
                  value={fallbackItemCode}
                  onChange={(e) => setFallbackItemCode(e.target.value)}
                  placeholder="SKU when project has no linked PO"
                />
                {showDuplicateHighlight ? (
                  <p className="text-sm text-amber-200/90">
                    You have already submitted {previousSameItemCount}{' '}
                    {previousSameItemCount === 1 ? 'request' : 'requests'} for this item code.
                  </p>
                ) : null}
              </div>
            )}

            {hasProjectPo && selectedPoLine && lineDrivesAmount ? (
              <>
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Quantity</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.0001"
                    value={requestedQty}
                    onChange={(e) => setRequestedQty(e.target.value)}
                    placeholder="Units to order"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Unit price</label>
                  <div className="rounded-lg border border-white/10 bg-[#2a2640]/80 px-3 py-2 text-sm text-foreground">
                    {formatPkr(Number(selectedPoLine.unit_price))}
                  </div>
                </div>
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-medium">Amount (quantity × unit price)</label>
                  <Input
                    type="number"
                    value={computedAmount ?? ''}
                    readOnly
                    disabled
                    className="opacity-90 cursor-not-allowed bg-[#2a2640]/60"
                  />
                  {computedAmount == null && requestedQty.trim() ? (
                    <p className="text-xs text-muted-foreground">Enter a quantity greater than 0.</p>
                  ) : null}
                </div>
              </>
            ) : hasProjectPo && selectedPoLine && !lineDrivesAmount ? (
              <div className="md:col-span-2 space-y-2">
                <label className="block text-sm font-medium">Amount</label>
                <p className="text-xs text-amber-200/90 mb-1">
                  This line has no unit price — enter the total amount manually.
                </p>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  min={0}
                  step="0.01"
                />
              </div>
            ) : !hasProjectPo ? (
              <div className="md:col-span-2 space-y-2">
                <label className="block text-sm font-medium">Amount</label>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  min={0}
                  step="0.01"
                />
              </div>
            ) : (
              <p className="md:col-span-2 text-sm text-muted-foreground">
                Select a PO line to enter quantity and amount.
              </p>
            )}

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

            {isOverBudgetNoPo ? (
              <div className="md:col-span-2">
                <p className="text-sm font-medium text-rose-300">
                  This exceeds the available budget ({formatPkr(availableBudget!)}). Reduce the amount or pick another
                  project.
                </p>
              </div>
            ) : null}

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
              disabled={
                mutation.isPending ||
                descriptionInvalid ||
                isOverBudgetNoPo ||
                (hasProjectPo &&
                  (!selectedPoLine || exceedsLineBudget || effectiveAmount <= 0))
              }
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
            <TableWrapper className="max-h-[480px] overflow-x-auto overflow-y-auto rounded-xl border border-white/10">
              <Table>
                <THead>
                  <TR>
                    <TH>Item code</TH>
                    <TH>Description</TH>
                    <TH>Unit price</TH>
                    <TH>
                      <span title="Requested quantity">Qty</span>
                    </TH>
                    <TH>Requested</TH>
                    <TH>
                      <span title="PO line remaining (net of other pending PRs on this line)">Remaining</span>
                    </TH>
                    <TH>After approval</TH>
                    <TH>Status</TH>
                    <TH>Request</TH>
                    {isAdmin ? <TH>Actions</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {(prData?.purchaseRequests ?? []).map((pr) => (
                    <TR key={pr.id}>
                      <PrPoLineMetricsCells summary={pr.po_line_summary} />
                      <TD className="text-xs">{pr.status}</TD>
                      <TD className="text-xs">
                        {isAdmin ? (
                          <Link className="text-purple-300 underline" href={`/purchase-requests/${pr.id}`}>
                            {pr.id.slice(0, 8)}…
                          </Link>
                        ) : (
                          <>{pr.id.slice(0, 8)}…</>
                        )}
                      </TD>
                      {isAdmin ? (
                        <TD>
                          <div className="flex flex-col gap-1 min-w-[9rem]">
                            <Button
                              type="button"
                              variant="secondary"
                              className="text-xs px-2 py-1"
                              onClick={() => {
                                setOverrideTarget(pr.id);
                                setOverrideDecision('approved');
                                setOverrideReason('');
                              }}
                            >
                              Override approval
                            </Button>
                            <Button
                              type="button"
                              variant="success"
                              className="text-xs px-2 py-1"
                              disabled={
                                forceApproveFromListMutation.isPending ||
                                !(
                                  (pr.status === 'pending' || pr.status === 'pending_exception') &&
                                  firstPendingRequiredByPr.get(pr.id)
                                )
                              }
                              title="Finalize immediately (admin only)"
                              onClick={() => {
                                const aid = firstPendingRequiredByPr.get(pr.id);
                                if (aid) forceApproveFromListMutation.mutate(aid);
                              }}
                            >
                              Force approve
                            </Button>
                          </div>
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
        {duplicateModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
            <Card className="max-w-md w-full p-6 space-y-4 border border-amber-500/40 shadow-xl">
              <h3 className="text-lg font-medium text-amber-100">Duplicate item</h3>
              <p className="text-sm text-foreground/90">
                You are requesting this item for the {ordinalTimeWord(nextOccurrence)} time.
              </p>
              <p className="text-xs text-muted-foreground">
                Continue only if you intend to order this same item again.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setDuplicateModalOpen(false)}>
                  Go back
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setDuplicateModalOpen(false);
                    mutation.mutate();
                  }}
                  disabled={mutation.isPending}
                >
                  Continue to submit
                </Button>
              </div>
            </Card>
          </div>
        ) : null}

        {overrideTarget && isAdmin ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
            <Card className="max-w-md w-full p-6 space-y-4 border border-white/15 shadow-xl">
              <h3 className="text-lg font-medium">Override approval</h3>
              <p className="text-sm text-muted-foreground">
                Request: {overrideTarget}. A written reason is required for audit.
              </p>
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
                  placeholder="Document why this override is appropriate"
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
                  {overrideMutation.isPending ? 'Applying...' : 'Apply override'}
                </Button>
              </div>
            </Card>
          </div>
        ) : null}
      </PageContainer>
    </AppLayout>
  );
}

