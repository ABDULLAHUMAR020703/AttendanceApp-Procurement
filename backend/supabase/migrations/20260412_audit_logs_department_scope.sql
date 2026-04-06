-- Denormalized department for dashboard activity filtering (non-admin users).

alter table public.audit_logs add column if not exists department_scope text;

create index if not exists audit_logs_department_scope_timestamp_idx
  on public.audit_logs (department_scope, timestamp desc);

comment on column public.audit_logs.department_scope is
  'Department code for scoped activity feeds; set on new audit rows when known.';
