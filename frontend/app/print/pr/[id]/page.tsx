'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../features/auth/AuthProvider';
import {
  authedFetchWithSupabase,
  formatPkr,
  NoSessionError,
} from '../../../../lib/api';
import { approvalPipelineStatus, approvalStageLabel, sortApprovalStageIndex } from '../../../../lib/org';
import type { PoLineSummary } from '../../../../components/PrPoLineMetricsCells';

type ApprovalRow = {
  id: string;
  approver_id: string;
  role: string;
  status: string;
  comments: string | null;
  created_at: string;
  updated_at?: string;
  is_admin_override?: boolean | null;
  approver?: { id: string; name?: string | null; email?: string | null; role?: string | null } | null;
};

type DetailResponse = {
  purchaseRequest: {
    id: string;
    description: string;
    amount: number;
    status: string;
    createdAt: string;
    documentUrl: string | null;
    itemCode?: string | null;
    duplicateCount?: number;
    poLineSummary?: PoLineSummary | null;
    createdBy: { id: string; name?: string | null; email?: string | null; role?: string | null } | null;
  } | null;
  project: {
    id: string;
    name: string;
    po_id: string | null;
    budget: number;
    department_id?: string;
    department_label?: string;
  } | null;
  purchaseOrder: {
    id: string;
    po_number: string | null;
    vendor: string | null;
    po: string | null;
    total_value: number;
    remaining_value: number;
  } | null;
  approvals: ApprovalRow[];
};

function statusBadgeClass(status: string) {
  const u = status.toLowerCase();
  if (u === 'approved') return 'print-badge print-badge--approved';
  if (u === 'rejected') return 'print-badge print-badge--rejected';
  if (u === 'pending' || u === 'pending_exception') return 'print-badge print-badge--pending';
  return 'print-badge';
}

function watermarkForStatus(status: string) {
  const u = status.toLowerCase();
  if (u === 'pending' || u === 'pending_exception') return 'PENDING';
  if (u === 'rejected') return 'REJECTED';
  if (u === 'approved') return 'APPROVED';
  return '';
}

function budgetReference(project: DetailResponse['project'], purchaseOrder: DetailResponse['purchaseOrder']) {
  if (!project) return '—';
  if (purchaseOrder) {
    const label = purchaseOrder.po?.trim() || purchaseOrder.po_number?.trim() || purchaseOrder.id.slice(0, 8);
    return `PO ${label}`;
  }
  return `Project budget ${formatPkr(project.budget)}`;
}

export default function PrintPurchaseRequestPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { supabase, profile } = useAuth();
  const id = params?.id ?? '';
  const canPrint = profile?.role === 'admin' || profile?.role === 'pm';
  const printedRef = useRef(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['print-pr', id],
    enabled: Boolean(supabase && id && canPrint),
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<DetailResponse>(supabase!, `/api/purchase-requests/${id}`);
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  useEffect(() => {
    if (!data?.purchaseRequest || printedRef.current) return;
    printedRef.current = true;
    const t = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(t);
  }, [data]);

  if (!canPrint) {
    return (
      <div className="print-root">
        <div className="print-doc">
          <p>Print is only available to administrators and project managers.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="print-root">
        <div className="print-doc">
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (error || !data?.purchaseRequest) {
    return (
      <div className="print-root">
        <div className="print-doc">
          <p className="text-rose-700">{error instanceof Error ? error.message : 'Could not load purchase request.'}</p>
        </div>
      </div>
    );
  }

  const pr = data.purchaseRequest;
  const project = data.project;
  const po = data.purchaseOrder;
  const summary = pr.poLineSummary ?? null;
  const qty = summary?.requested_quantity ?? null;
  const unitPrice = summary?.unit_price;
  const itemLabel = summary?.item_code?.trim() || pr.itemCode?.trim() || 'Requested item';
  const desc = summary?.line_description?.trim() || summary?.pr_description || pr.description;
  const requestedBy =
    pr.createdBy?.name?.trim() || pr.createdBy?.email?.trim() || pr.createdBy?.id || '—';
  const dept =
    (project as { department_label?: string })?.department_label ||
    project?.department_id ||
    '—';
  const wm = watermarkForStatus(pr.status);

  const sortedApprovals = [...data.approvals].sort(
    (a, b) => sortApprovalStageIndex(a.role) - sortApprovalStageIndex(b.role),
  );

  return (
    <div className="print-root">
      {wm ? <div className="print-watermark">{wm}</div> : null}
      <div className="print-doc">
        <div className="print-doc-inner">
          <header className="print-header-brand">
            <div className="print-logo" aria-hidden>
              Logo
            </div>
            <div className="print-title-block" style={{ flex: 1 }}>
              <h1>Purchase Request</h1>
              <div className="print-meta">
                <div>
                  <strong>ID:</strong> {pr.id}
                </div>
                <div>
                  <strong>Date:</strong> {new Date(pr.createdAt).toLocaleString()}
                </div>
                <div style={{ marginTop: 8 }}>
                  <span className={statusBadgeClass(pr.status)}>{pr.status.replaceAll('_', ' ')}</span>
                </div>
              </div>
            </div>
          </header>

          <section className="print-section">
            <h2>Details</h2>
            <dl className="print-kv">
              <dt>Project</dt>
              <dd>{project?.name ?? '—'}</dd>
              <dt>Requested by</dt>
              <dd>{requestedBy}</dd>
              <dt>Department</dt>
              <dd>{dept}</dd>
              {pr.duplicateCount != null && pr.duplicateCount > 1 ? (
                <>
                  <dt>Duplicate count</dt>
                  <dd>{pr.duplicateCount}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className="print-section">
            <h2>Line item</h2>
            <div className="print-table-wrap">
              <table className="print-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{itemLabel}</td>
                    <td>{desc}</td>
                    <td>{qty != null && Number.isFinite(qty) ? String(qty) : '—'}</td>
                    <td>
                      {unitPrice != null && Number.isFinite(unitPrice)
                        ? formatPkr(unitPrice)
                        : qty != null &&
                            qty > 0 &&
                            Number.isFinite(pr.amount / qty) &&
                            !Number.isNaN(pr.amount / qty)
                          ? formatPkr(pr.amount / qty)
                          : '—'}
                    </td>
                    <td>{formatPkr(pr.amount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="print-section">
            <h2>Financial summary</h2>
            <dl className="print-kv">
              <dt>Total amount</dt>
              <dd>{formatPkr(pr.amount)}</dd>
              <dt>Budget / PO reference</dt>
              <dd>{budgetReference(project, po)}</dd>
              {po ? (
                <>
                  <dt>PO remaining (system)</dt>
                  <dd>{formatPkr(po.remaining_value)}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className="print-section">
            <h2>Approval flow</h2>
            <div className="print-table-wrap">
              <table className="print-table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Approver</th>
                    <th>Status</th>
                    <th>Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedApprovals.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ color: '#6b7280' }}>
                        No approval rows.
                      </td>
                    </tr>
                  ) : (
                    sortedApprovals.map((a) => (
                      <tr key={a.id}>
                        <td>{approvalStageLabel(a.role, { legacyAdmin: true })}</td>
                        <td>
                          {a.approver?.name?.trim() || a.approver?.email?.trim() || a.approver_id.slice(0, 8)}
                        </td>
                        <td>
                          {approvalPipelineStatus(a.role, a.status, { isAdminOverride: Boolean(a.is_admin_override) })}
                        </td>
                        <td>{(a.comments ?? '—').trim() || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="print-footer">
            Generated {new Date().toLocaleString()} · Procurement Management System
          </footer>

          <div className="print-hint no-print">
            When the print dialog opens, choose <strong>Save as PDF</strong> to download.
          </div>
        </div>
      </div>
    </div>
  );
}
