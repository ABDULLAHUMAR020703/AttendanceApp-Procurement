alter table public.purchase_requests add column if not exists item_code text;

alter table public.purchase_requests add column if not exists duplicate_count integer not null default 1;

create index if not exists purchase_requests_created_by_item_code_idx on public.purchase_requests (created_by, item_code)
where item_code is not null;
