/**
 * Types aligned with main app API responses for /print/* document views.
 */
import type { PoLineSummary } from '../components/PrPoLineMetricsCells';

export type PrintApprovalRow = {
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

/** Matches GET /api/purchase-requests/:id payload used by the detail & print pages. */
export type PrintPurchaseRequestDetailResponse = {
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
  approvals: PrintApprovalRow[];
};

export type PrintUserLite = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  job_title?: string | null;
};

/** Matches GET /api/projects/:id?include=related_prs */
export type PrintProjectDetailResponse = {
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
    pm: PrintUserLite | null;
    team_lead: PrintUserLite | null;
    assigned_employees: PrintUserLite[];
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
