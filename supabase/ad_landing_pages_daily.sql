-- Additive Google Ads landing-page diagnostics.
-- This script creates a separate read model and does not change Ads settings,
-- orders, ad_metrics_daily, ad_campaigns, or marketing business views.

create extension if not exists pgcrypto;

create table if not exists public.ad_landing_pages_daily (
  id uuid primary key default gen_random_uuid(),
  landing_page_key text not null unique,
  date date not null,
  provider text not null default 'google_ads' check (provider = 'google_ads'),
  resource text not null check (resource in ('expanded_landing_page_view', 'landing_page_view')),
  market text not null check (market in ('cz', 'sk', 'hu', 'ro', 'unknown')),
  customer_id text not null,
  customer_name text,
  campaign_id text,
  campaign_name text,
  campaign_status text,
  channel_type text,
  channel_sub_type text,
  ad_group_id text,
  ad_group_name text,
  landing_page_url text,
  expanded_final_url text,
  unexpanded_final_url text,
  landing_page_type text not null default 'other' check (landing_page_type in ('hp', 'category', 'cheap_category', 'product', 'other')),
  landing_page_flags jsonb not null default '{}'::jsonb,
  product_size_flag text not null default 'other' check (product_size_flag in ('180x90x30_40', '150x70x30', 'tall_heavy', 'other')),
  is_hp boolean not null default false,
  is_category boolean not null default false,
  is_cheap_category boolean not null default false,
  is_product boolean not null default false,
  currency text,
  cost_micros bigint not null default 0,
  cost_native numeric(18, 6) not null default 0,
  cost_czk numeric(18, 2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions numeric(18, 6) not null default 0,
  conversion_value_native numeric(18, 6) not null default 0,
  conversion_value_czk numeric(18, 2) not null default 0,
  ads_aov_native numeric(18, 6),
  ads_aov_czk numeric(18, 2),
  raw_data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_landing_pages_daily_date_idx
  on public.ad_landing_pages_daily (date);

create index if not exists ad_landing_pages_daily_market_date_idx
  on public.ad_landing_pages_daily (market, date);

create index if not exists ad_landing_pages_daily_campaign_idx
  on public.ad_landing_pages_daily (provider, customer_id, campaign_id);

create index if not exists ad_landing_pages_daily_type_idx
  on public.ad_landing_pages_daily (market, landing_page_type, product_size_flag);

create index if not exists ad_landing_pages_daily_url_idx
  on public.ad_landing_pages_daily (landing_page_url);

create index if not exists ad_landing_pages_daily_flags_gin_idx
  on public.ad_landing_pages_daily using gin (landing_page_flags);

create or replace view public.ad_landing_page_daily_summary as
select
  date,
  market,
  resource,
  channel_type,
  channel_sub_type,
  landing_page_type,
  product_size_flag,
  count(*) as row_count,
  count(distinct campaign_id) as campaign_count,
  count(distinct landing_page_url) as landing_page_count,
  sum(coalesce(cost_czk, 0)) as cost_czk,
  sum(coalesce(impressions, 0)) as impressions,
  sum(coalesce(clicks, 0)) as clicks,
  sum(coalesce(conversions, 0)) as conversions,
  sum(coalesce(conversion_value_czk, 0)) as conversion_value_czk,
  case
    when sum(coalesce(conversions, 0)) > 0 then sum(coalesce(conversion_value_czk, 0)) / sum(coalesce(conversions, 0))
    else null
  end as ads_aov_czk,
  case
    when sum(coalesce(cost_czk, 0)) > 0 then sum(coalesce(conversion_value_czk, 0)) / sum(coalesce(cost_czk, 0))
    else null
  end as ads_roas
from public.ad_landing_pages_daily
group by
  date,
  market,
  resource,
  channel_type,
  channel_sub_type,
  landing_page_type,
  product_size_flag;

revoke all on public.ad_landing_pages_daily from anon;
revoke all on public.ad_landing_page_daily_summary from anon;
grant select on public.ad_landing_pages_daily to authenticated;
grant select on public.ad_landing_page_daily_summary to authenticated;

alter table public.ad_landing_pages_daily enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ad_landing_pages_daily'
      and policyname = 'ad_landing_pages_daily_read_authenticated'
  ) then
    create policy "ad_landing_pages_daily_read_authenticated"
    on public.ad_landing_pages_daily
    for select to authenticated using (true);
  end if;
end $$;
