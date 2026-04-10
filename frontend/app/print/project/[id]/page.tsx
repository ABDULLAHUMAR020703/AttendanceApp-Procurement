'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../features/auth/AuthProvider';
import { authedFetchWithSupabase, formatPkr, NoSessionError } from '../../../../lib/api';

type UserLite = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  job_title?: string | null;
};

type ProjectPrintResponse = {
  project: {
    id: string;
    name: string;
    po_id: string | null;
    budget: number;
    status: string;
    department_id: string;
    department_label?: string;
    created_at: string;
    updated_at?: string;
    pm: UserLite | null;
    team_lead: UserLite | null;
    assigned_employees: UserLite[];
  };
  purchaseOrder: {
    id: string;
    po_number: string | null;
    vendor: string | null;
    po: string | null;
    total_value: number;
    remaining_value: number;
  } | null;
  relatedPurchaseRequests?: Array<{
    id: string;
    description: string;
    amount: number;
    status: string;
    created_at: string;
  }>;
};

function statusBadgeClass(status: string) {
  const u = status.toLowerCase();
  if (u === 'active') return 'print-badge print-badge--approved';
  if (u === 'archived') return 'print-badge print-badge--rejected';
  return 'print-badge print-badge--pending';
}

function watermarkForProjectStatus(status: string) {
  const u = status.toLowerCase();
  if (u === 'active') return 'ACTIVE';
  if (u === 'archived') return 'ARCHIVED';
  return status.toUpperCase();
}

export default function PrintProjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { supabase, profile } = useAuth();
  const id = params?.id ?? '';
  const canPrint = profile?.role === 'admin' || profile?.role === 'pm';
  const printedRef = useRef(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['print-project', id],
    enabled: Boolean(supabase && id && canPrint),
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<ProjectPrintResponse>(
          supabase!,
          `/api/projects/${id}?include=related_prs`,
        );
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  useEffect(() => {
    if (!data?.project || printedRef.current) return;
    printedRef.current = true;
    const t = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(t);
  }, [data]);

  const financial = useMemo(() => {
    if (!data?.project) return null;
    const po = data.purchaseOrder;
    const totalBudget = po ? Number(po.total_value) : Number(data.project.budget);
    const remaining = po ? Number(po.remaining_value) : Number(data.project.budget);
    const consumed = Math.max(0, totalBudget - remaining);
    return { totalBudget, remaining, consumed };
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

  if (error || !data?.project) {
    return (
      <div className="print-root">
        <div className="print-doc">
          <p className="text-rose-700">{error instanceof Error ? error.message : 'Could not load project.'}</p>
        </div>
      </div>
    );
  }

  const p = data.project;
  const po = data.purchaseOrder;
  const prs = data.relatedPurchaseRequests ?? [];
  const wm = watermarkForProjectStatus(p.status);
  const shortCode = p.id.slice(0, 8).toUpperCase();

  return (
    <div className="print-root">
      <div className="print-watermark">{wm}</div>
      <div className="print-doc">
        <div className="print-doc-inner">
          <header className="print-header-brand">
            <div className="print-logo" aria-hidden>
              Logo
            </div>
            <div className="print-title-block" style={{ flex: 1 }}>
              <h1>Project Report</h1>
              <div className="print-meta">
                <div>
                  <strong>Project ID:</strong> {p.id}
                </div>
                <div>
                  <strong>Short code:</strong> {shortCode}
                </div>
                <div>
                  <strong>Updated:</strong>{' '}
                  {p.updated_at ? new Date(p.updated_at).toLocaleString() : new Date(p.created_at).toLocaleString()}
                </div>
                <div style={{ marginTop: 8 }}>
                  <span className={statusBadgeClass(p.status)}>{p.status}</span>
                </div>
              </div>
            </div>
          </header>

          <section className="print-section">
            <h2>Details</h2>
            <dl className="print-kv">
              <dt>Project name</dt>
              <dd>{p.name}</dd>
              <dt>Department</dt>
              <dd>{p.department_label ?? p.department_id}</dd>
              <dt>Project manager</dt>
              <dd>{p.pm?.name?.trim() || p.pm?.email?.trim() || '—'}</dd>
              <dt>Team lead</dt>
              <dd>{p.team_lead?.name?.trim() || p.team_lead?.email?.trim() || '—'}</dd>
              <dt>Assigned employees</dt>
              <dd>
                {p.assigned_employees.length
                  ? p.assigned_employees.map((e) => e.name || e.email || e.id).join(', ')
                  : '—'}
              </dd>
              <dt>Linked PO / vendor</dt>
              <dd>
                {po
                  ? `${po.po?.trim() || po.po_number?.trim() || po.id.slice(0, 8)}${po.vendor ? ` · ${po.vendor}` : ''}`
                  : 'No linked PO'}
              </dd>
            </dl>
          </section>

          <section className="print-section">
            <h2>Related purchase requests</h2>
            <div className="print-table-wrap">
              <table className="print-table">
                <thead>
                  <tr>
                    <th>PR ID</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {prs.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ color: '#6b7280' }}>
                        No purchase requests for this project.
                      </td>
                    </tr>
                  ) : (
                    prs.map((r) => (
                      <tr key={r.id}>
                        <td>{r.id.slice(0, 8)}…</td>
                        <td>{r.description}</td>
                        <td>{formatPkr(Number(r.amount))}</td>
                        <td>{r.status.replaceAll('_', ' ')}</td>
                        <td>{new Date(r.created_at).toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="print-section">
            <h2>Financial summary</h2>
            <dl className="print-kv">
              <dt>Total budget / PO value</dt>
              <dd>{financial ? formatPkr(financial.totalBudget) : '—'}</dd>
              <dt>Consumed</dt>
              <dd>{financial ? formatPkr(financial.consumed) : '—'}</dd>
              <dt>Remaining</dt>
              <dd>{financial ? formatPkr(financial.remaining) : '—'}</dd>
            </dl>
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
