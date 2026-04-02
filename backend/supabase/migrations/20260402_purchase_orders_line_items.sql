create extension if not exists pgcrypto;

-- remaining_amount = po_amount - po_invoiced - po_acceptance_approved - pending_to_apply

alter table public.purchase_orders add column if not exists po text;

alter table public.purchase_orders add column if not exists issue_date date;

alter table public.purchase_orders add column if not exists month integer;

alter table public.purchase_orders add column if not exists year integer;

alter table public.purchase_orders add column if not exists customer text;

alter table public.purchase_orders add column if not exists project_name text;

alter table public.purchase_orders add column if not exists sub_contract_no text;

alter table public.purchase_orders add column if not exists project_code text;

alter table public.purchase_orders add column if not exists milestone text;

alter table public.purchase_orders add column if not exists item_code text;

alter table public.purchase_orders add column if not exists description text;

alter table public.purchase_orders add column if not exists site_code text;

alter table public.purchase_orders add column if not exists site_name text;

alter table public.purchase_orders add column if not exists site_id text;

alter table public.purchase_orders add column if not exists qc_status text;

alter table public.purchase_orders add column if not exists approver_level text;

alter table public.purchase_orders add column if not exists shipment_number text;

alter table public.purchase_orders add column if not exists line_no text;

alter table public.purchase_orders add column if not exists department text;

alter table public.purchase_orders add column if not exists sub_department text;

alter table public.purchase_orders add column if not exists uom text;

alter table public.purchase_orders add column if not exists po_quantity numeric(20, 4);

alter table public.purchase_orders add column if not exists unit_price numeric(20, 4);

alter table public.purchase_orders add column if not exists po_amount numeric(20, 4);

alter table public.purchase_orders add column if not exists start_date date;

alter table public.purchase_orders add column if not exists end_date date;

alter table public.purchase_orders add column if not exists po_line_sn text;

alter table public.purchase_orders add column if not exists po_invoiced numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists po_acceptance_approved numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists po_acceptance_pending numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists acceptance_rejected_amount numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists wnd numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists pending_to_apply numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists remaining_amount numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists milestone_status text;

alter table public.purchase_orders add column if not exists po_status text;

alter table public.purchase_orders add column if not exists confirmation_status text;

alter table public.purchase_orders add column if not exists pending_milestone text;

alter table public.purchase_orders add column if not exists acceptance_status text;

alter table public.purchase_orders add column if not exists rejection_remarks text;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_orders'
      and column_name = 'id'
  ) then
    alter table public.purchase_orders add column id uuid not null default gen_random_uuid();
    alter table public.purchase_orders add primary key (id);
  end if;
end $$;

create unique index if not exists purchase_orders_po_line_sn_uidx on public.purchase_orders (po_line_sn)
where po_line_sn is not null;

create index if not exists purchase_orders_item_code_idx on public.purchase_orders (item_code);

create index if not exists purchase_orders_project_code_idx on public.purchase_orders (project_code);
