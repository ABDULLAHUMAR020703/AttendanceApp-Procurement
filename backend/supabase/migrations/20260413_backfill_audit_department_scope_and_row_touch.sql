-- Backfill data created before department_scope and consistent row touches.
-- Safe to re-run: only fills NULL department_scope / NULL updated_by where audits exist.
--
-- Ensure column exists if 20260412_audit_logs_department_scope.sql was not applied yet.

alter table public.audit_logs add column if not exists department_scope text;

create index if not exists audit_logs_department_scope_timestamp_idx
  on public.audit_logs (department_scope, timestamp desc);

comment on column public.audit_logs.department_scope is
  'Department code for scoped activity feeds; set on new audit rows when known.';

-- ---------------------------------------------------------------------------
-- 1) audit_logs.department_scope — resolve from domain tables (entity_id keys)
-- ---------------------------------------------------------------------------

-- Purchase requests → project department
update public.audit_logs al
set department_scope = p.department_id
from public.purchase_requests pr
join public.projects p on p.id = pr.project_id
where al.department_scope is null
  and al.entity_id = pr.id;

-- Projects
update public.audit_logs al
set department_scope = p.department_id
from public.projects p
where al.department_scope is null
  and al.entity_id = p.id;

-- Approvals → PR → project
update public.audit_logs al
set department_scope = p.department_id
from public.approvals a
join public.purchase_requests pr on pr.id = a.request_id
join public.projects p on p.id = pr.project_id
where al.department_scope is null
  and al.entity_id = a.id;

-- Exceptions: no_po reference = project id; over_budget reference = PR id
update public.audit_logs al
set department_scope = p.department_id
from public.exceptions e
join public.projects p on p.id = e.reference_id
where al.department_scope is null
  and al.entity_id = e.id
  and e.type = 'no_po';

update public.audit_logs al
set department_scope = p.department_id
from public.exceptions e
join public.purchase_requests pr on pr.id = e.reference_id
join public.projects p on p.id = pr.project_id
where al.department_scope is null
  and al.entity_id = e.id
  and e.type = 'over_budget';

-- Purchase orders: prefer a linked project’s department, else uploader’s department
update public.audit_logs al
set department_scope = coalesce(
  (
    select p.department_id
    from public.projects p
    where p.po_id = po.id
    order by p.created_at asc
    limit 1
  ),
  u.department
)
from public.purchase_orders po
join public.users u on u.id = po.uploaded_by
where al.department_scope is null
  and al.entity_id = po.id;

-- ---------------------------------------------------------------------------
-- 2) Remaining audit rows: actor’s department (helps legacy entity_type = legacy)
-- ---------------------------------------------------------------------------

update public.audit_logs al
set department_scope = u.department
from public.users u
where al.department_scope is null
  and al.user_id is not null
  and al.user_id = u.id
  and u.department is not null;

-- ---------------------------------------------------------------------------
-- 3) Row touch consistency: set updated_by / updated_at from latest audit per entity
--    Only where updated_by is still null and audit has user_id.
-- ---------------------------------------------------------------------------

with latest_pr as (
  select distinct on (entity_id)
    entity_id,
    user_id,
    timestamp
  from public.audit_logs
  where entity_id in (select id from public.purchase_requests)
  order by entity_id, timestamp desc
)
update public.purchase_requests pr
set
  updated_by = la.user_id,
  updated_at = greatest(pr.updated_at, la.timestamp)
from latest_pr la
where pr.id = la.entity_id
  and pr.updated_by is null
  and la.user_id is not null;

with latest_proj as (
  select distinct on (entity_id)
    entity_id,
    user_id,
    timestamp
  from public.audit_logs
  where entity_id in (select id from public.projects)
  order by entity_id, timestamp desc
)
update public.projects p
set
  updated_by = la.user_id,
  updated_at = greatest(p.updated_at, la.timestamp)
from latest_proj la
where p.id = la.entity_id
  and p.updated_by is null
  and la.user_id is not null;

with latest_po as (
  select distinct on (entity_id)
    entity_id,
    user_id,
    timestamp
  from public.audit_logs
  where entity_id in (select id from public.purchase_orders)
  order by entity_id, timestamp desc
)
update public.purchase_orders po
set
  updated_by = la.user_id,
  updated_at = greatest(po.updated_at, la.timestamp)
from latest_po la
where po.id = la.entity_id
  and po.updated_by is null
  and la.user_id is not null;

with latest_appr as (
  select distinct on (entity_id)
    entity_id,
    user_id,
    timestamp
  from public.audit_logs
  where entity_id in (select id from public.approvals)
  order by entity_id, timestamp desc
)
update public.approvals a
set
  updated_by = la.user_id,
  updated_at = greatest(a.updated_at, la.timestamp)
from latest_appr la
where a.id = la.entity_id
  and a.updated_by is null
  and la.user_id is not null;
