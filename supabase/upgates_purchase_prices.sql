-- Current and historical UpGates purchase prices.
--
-- UpGates `prices[].price_purchase` is the source of truth for catalog
-- purchase prices. Values are stored in the native market currency and are
-- without VAT.

create extension if not exists pgcrypto;

create table if not exists public.upgates_product_purchase_prices_daily (
  id uuid primary key default gen_random_uuid(),
  price_key text not null unique,
  snapshot_date date not null,
  product_code text not null,
  market text not null check (market in ('cz', 'sk', 'hu', 'ro', 'unknown')),
  currency text not null,
  purchase_price_without_vat_native numeric(18, 6),
  purchase_price_czk numeric(18, 6),
  fx_to_czk numeric(18, 9),
  vat_rate numeric(8, 4),
  sale_price_without_vat_native numeric(18, 6),
  sale_price_with_vat_native numeric(18, 6),
  upgates_product_id text,
  ean text,
  title text,
  base_code text,
  bundle_quantity integer not null default 1,
  is_bundle boolean not null default false,
  stock_quantity numeric(18, 6),
  is_active boolean,
  is_archived boolean,
  can_add_to_basket boolean,
  upgates_updated_at timestamptz,
  raw_price jsonb not null default '{}'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, market, product_code)
);

create index if not exists upgates_purchase_prices_code_snapshot_idx
  on public.upgates_product_purchase_prices_daily (product_code, snapshot_date desc);

create index if not exists upgates_purchase_prices_market_code_snapshot_idx
  on public.upgates_product_purchase_prices_daily (market, product_code, snapshot_date desc);

create index if not exists upgates_purchase_prices_market_active_idx
  on public.upgates_product_purchase_prices_daily (market, is_archived, is_active);

create or replace view public.upgates_product_purchase_prices_current
with (security_invoker = true) as
select *
from (
  select
    p.*,
    row_number() over (
      partition by p.market, p.product_code
      order by p.snapshot_date desc, p.fetched_at desc, p.updated_at desc
    ) as row_number
  from public.upgates_product_purchase_prices_daily p
) ranked
where ranked.row_number = 1;

revoke all on public.upgates_product_purchase_prices_daily from anon;
revoke all on public.upgates_product_purchase_prices_current from anon;
grant select on public.upgates_product_purchase_prices_daily to authenticated;
grant select on public.upgates_product_purchase_prices_current to authenticated;

alter table public.upgates_product_purchase_prices_daily enable row level security;

drop policy if exists "upgates_purchase_prices_read_authenticated" on public.upgates_product_purchase_prices_daily;
create policy "upgates_purchase_prices_read_authenticated"
  on public.upgates_product_purchase_prices_daily
  for select
  to authenticated
  using (true);
