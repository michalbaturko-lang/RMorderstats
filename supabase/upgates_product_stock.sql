-- Current and historical UpGates product stock snapshots.
--
-- UpGates `/products[].stock` is the source of truth for current stock.
-- Keep this separate from purchase prices because some products have stock
-- but no price row, and some import SKUs exist in master data before UpGates
-- exposes a stock card.

create extension if not exists pgcrypto;

create table if not exists public.upgates_product_stock_daily (
  id uuid primary key default gen_random_uuid(),
  stock_key text not null unique,
  snapshot_date date not null,
  product_code text not null,
  ean text,
  title text,
  stock_quantity numeric(18, 6),
  stock_status text not null default 'unknown'
    check (stock_status in ('known', 'unknown')),
  availability text,
  availability_type text,
  upgates_product_id text,
  is_active boolean,
  is_archived boolean,
  can_add_to_basket boolean,
  upgates_updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, product_code)
);

create index if not exists upgates_product_stock_code_snapshot_idx
  on public.upgates_product_stock_daily (product_code, snapshot_date desc);

create index if not exists upgates_product_stock_ean_snapshot_idx
  on public.upgates_product_stock_daily (ean, snapshot_date desc);

create index if not exists upgates_product_stock_status_idx
  on public.upgates_product_stock_daily (stock_status, is_active, is_archived);

create or replace view public.upgates_product_stock_current
with (security_invoker = true) as
select *
from (
  select
    s.*,
    row_number() over (
      partition by s.product_code
      order by s.snapshot_date desc, s.fetched_at desc, s.updated_at desc
    ) as row_number
  from public.upgates_product_stock_daily s
) ranked
where ranked.row_number = 1;

revoke all on public.upgates_product_stock_daily from anon;
revoke all on public.upgates_product_stock_current from anon;
grant select on public.upgates_product_stock_daily to authenticated;
grant select on public.upgates_product_stock_current to authenticated;

alter table public.upgates_product_stock_daily enable row level security;

drop policy if exists "upgates_product_stock_read_authenticated" on public.upgates_product_stock_daily;
create policy "upgates_product_stock_read_authenticated"
  on public.upgates_product_stock_daily
  for select
  to authenticated
  using (true);
