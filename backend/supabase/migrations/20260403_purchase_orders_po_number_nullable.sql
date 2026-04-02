alter table public.purchase_orders drop constraint if exists purchase_orders_po_number_key;

alter table public.purchase_orders alter column po_number drop not null;

alter table public.purchase_orders alter column vendor drop not null;
