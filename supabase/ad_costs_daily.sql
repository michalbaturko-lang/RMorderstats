-- Google Ads daily costs (synchronized by external job)
create extension if not exists pgcrypto;

create table if not exists public.ad_costs_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  market text not null check (market in ('cz', 'sk', 'hu', 'unknown')),
  account_customer_id text not null,
  currency text not null,
  cost_micros bigint not null check (cost_micros >= 0),
  cost_native numeric(14, 2) not null,
  cost_czk numeric(14, 2) not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, market, account_customer_id)
);

create index if not exists ad_costs_daily_date_idx on public.ad_costs_daily (date);
create index if not exists ad_costs_daily_market_idx on public.ad_costs_daily (market);
create index if not exists ad_costs_daily_date_market_idx on public.ad_costs_daily (date, market);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ad_costs_daily_set_updated_at on public.ad_costs_daily;
create trigger ad_costs_daily_set_updated_at
before update on public.ad_costs_daily
for each row execute function public.set_updated_at_timestamp();

alter table public.ad_costs_daily enable row level security;

drop policy if exists "ad_costs_daily_read_authenticated" on public.ad_costs_daily;
create policy "ad_costs_daily_read_authenticated"
on public.ad_costs_daily
for select
to authenticated
using (true);
