-- Last-updated metadata + audit log enhancements + touch triggers

-- ---------------------------------------------------------------------------
-- Core tables: updated_at / updated_by
-- ---------------------------------------------------------------------------
alter table public.purchase_requests
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users (id) on delete set null;

update public.purchase_requests
set updated_at = coalesce(updated_at, created_at),
    updated_by = coalesce(updated_by, created_by);

alter table public.projects
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users (id) on delete set null;

update public.projects
set updated_at = coalesce(updated_at, created_at),
    updated_by = coalesce(updated_by, created_by);

alter table public.purchase_orders
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users (id) on delete set null;

update public.purchase_orders
set updated_at = coalesce(updated_at, created_at),
    updated_by = coalesce(updated_by, uploaded_by);

alter table public.approvals
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users (id) on delete set null;

update public.approvals
set updated_at = coalesce(updated_at, created_at),
    updated_by = coalesce(updated_by, approver_id);

-- ---------------------------------------------------------------------------
-- Auto-touch updated_at on UPDATE (updated_by set in application code)
-- ---------------------------------------------------------------------------
create or replace function public.touch_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists purchase_requests_touch_updated_at on public.purchase_requests;
create trigger purchase_requests_touch_updated_at
  before update on public.purchase_requests
  for each row execute procedure public.touch_row_updated_at();

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute procedure public.touch_row_updated_at();

drop trigger if exists purchase_orders_touch_updated_at on public.purchase_orders;
create trigger purchase_orders_touch_updated_at
  before update on public.purchase_orders
  for each row execute procedure public.touch_row_updated_at();

drop trigger if exists approvals_touch_updated_at on public.approvals;
create trigger approvals_touch_updated_at
  before update on public.approvals
  for each row execute procedure public.touch_row_updated_at();

-- ---------------------------------------------------------------------------
-- audit_logs: entity_type + changes JSON (performed_by = user_id in API)
-- ---------------------------------------------------------------------------
alter table public.audit_logs
  add column if not exists entity_type text not null default 'legacy',
  add column if not exists changes jsonb;

update public.audit_logs set entity_type = entity where entity_type = 'legacy' or entity_type is null;

create index if not exists audit_logs_entity_type_entity_id_idx on public.audit_logs (entity_type, entity_id);

comment on column public.audit_logs.entity_type is 'Normalized entity key, e.g. purchase_request, project, purchase_order.';
comment on column public.audit_logs.changes is 'Optional JSON payload: before/after snapshots or field-level deltas.';
