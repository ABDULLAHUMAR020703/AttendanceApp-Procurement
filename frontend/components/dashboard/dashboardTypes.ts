export type DashboardDrillCard = 'projects' | 'approvals' | 'exceptions' | 'po';

export type DeptProjectRow = { id: string; name: string; status: string };
export type DeptApprovalRow = {
  id: string;
  request_id: string;
  role: string;
  status: string;
  pr_description: string;
};
export type DeptExceptionRow = {
  id: string;
  type: string;
  status: string;
  reference_id: string;
  severity: 'high' | 'medium';
};
export type DeptPoRow = {
  id: string;
  label: string;
  vendor: string | null;
  total_value: number;
  remaining_value: number;
  line_count: number;
};

export type DashboardDepartmentBucket = {
  name: string;
  code: string;
  projects: DeptProjectRow[];
  pendingApprovals: DeptApprovalRow[];
  exceptions: DeptExceptionRow[];
  poRecords: DeptPoRow[];
};

export type DashboardDepartmentsResponse = {
  section: DashboardDrillCard;
  departments: DashboardDepartmentBucket[];
};
