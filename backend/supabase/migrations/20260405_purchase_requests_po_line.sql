alter table public.purchase_requests add column if not exists po_line_id uuid references public.purchase_orders (id) on delete set null;

alter table public.purchase_requests add column if not exists requested_quantity numeric(20, 4);

create index if not exists purchase_requests_po_line_id_idx on public.purchase_requests (po_line_id)
where po_line_id is not null;
