-- Detailed marketing analytics storage for Google Ads and Meta Ads.
-- Run in Supabase SQL editor before enabling scripts/sync-ads-analytics.mjs.

create extension if not exists pgcrypto;

create table if not exists public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google_ads', 'meta_ads')),
  market text not null check (market in ('cz', 'sk', 'hu', 'ro', 'unknown')),
  account_id text not null,
  account_name text,
  currency text,
  timezone text,
  enabled boolean not null default true,
  active_from date,
  active_to date,
  raw_data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, account_id)
);

create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google_ads', 'meta_ads')),
  market text not null check (market in ('cz', 'sk', 'hu', 'ro', 'unknown')),
  account_id text not null,
  campaign_id text not null,
  campaign_name text,
  status text,
  serving_status text,
  channel_type text,
  channel_sub_type text,
  objective text,
  bidding_strategy_type text,
  budget_amount_micros bigint,
  budget_amount_native numeric(18, 4),
  currency text,
  raw_data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, account_id, campaign_id)
);

create table if not exists public.ad_groups (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google_ads', 'meta_ads')),
  market text not null check (market in ('cz', 'sk', 'hu', 'ro', 'unknown')),
  account_id text not null,
  campaign_id text,
  ad_group_id text not null,
  ad_group_name text,
  group_type text,
  raw_data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, account_id, ad_group_id)
);

create table if not exists public.ad_ads (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google_ads', 'meta_ads')),
  market text not null check (market in ('cz', 'sk', 'hu', 'ro', 'unknown')),
  account_id text not null,
  campaign_id text,
  ad_group_id text,
  ad_id text not null,
  ad_name text,
  raw_data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, account_id, ad_id)
);

create table if not exists public.ad_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null unique,
  date date not null,
  provider text not null check (provider in ('google_ads', 'meta_ads')),
  market text not null check (market in ('cz', 'sk', 'hu', 'ro', 'unknown')),
  account_id text not null,
  account_name text,
  level text not null,
  campaign_id text,
  campaign_name text,
  ad_group_id text,
  ad_group_name text,
  ad_id text,
  ad_name text,
  currency text,
  spend_micros bigint,
  spend_native numeric(18, 6),
  spend_czk numeric(18, 2),
  impressions bigint,
  clicks bigint,
  interactions bigint,
  reach bigint,
  frequency numeric(18, 8),
  video_views numeric(18, 6),
  conversions numeric(18, 6),
  conversion_value_native numeric(18, 6),
  conversion_value_czk numeric(18, 2),
  average_order_value_native numeric(18, 6),
  average_order_value_czk numeric(18, 2),
  all_conversions numeric(18, 6),
  all_conversion_value_native numeric(18, 6),
  all_conversion_value_czk numeric(18, 2),
  view_through_conversions numeric(18, 6),
  ctr numeric(18, 8),
  cpc_czk numeric(18, 2),
  cpm_czk numeric(18, 2),
  roas_platform numeric(18, 6),
  cost_per_conversion_czk numeric(18, 2),
  dimension_hash text,
  dimensions jsonb not null default '{}'::jsonb,
  actions jsonb not null default '{}'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ad_raw_insights (
  id uuid primary key default gen_random_uuid(),
  raw_key text not null unique,
  provider text not null check (provider in ('google_ads', 'meta_ads')),
  market text not null check (market in ('cz', 'sk', 'hu', 'ro', 'unknown')),
  account_id text not null,
  resource text not null,
  date_start date,
  date_stop date,
  raw_data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.ad_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google_ads', 'meta_ads')),
  sync_type text not null,
  range_from date not null,
  range_to date not null,
  status text not null check (status in ('running', 'success', 'partial_success', 'failed')),
  rows_upserted integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ad_accounts_market_idx on public.ad_accounts (market);
create index if not exists ad_campaigns_account_idx on public.ad_campaigns (provider, account_id);
create index if not exists ad_groups_campaign_idx on public.ad_groups (provider, account_id, campaign_id);
create index if not exists ad_ads_group_idx on public.ad_ads (provider, account_id, ad_group_id);
create index if not exists ad_metrics_daily_date_idx on public.ad_metrics_daily (date);
create index if not exists ad_metrics_daily_market_provider_idx on public.ad_metrics_daily (market, provider);
create index if not exists ad_metrics_daily_campaign_idx on public.ad_metrics_daily (provider, account_id, campaign_id);
create index if not exists ad_metrics_daily_level_idx on public.ad_metrics_daily (level);
create index if not exists ad_metrics_daily_dimensions_gin_idx on public.ad_metrics_daily using gin (dimensions);
create index if not exists ad_raw_insights_date_idx on public.ad_raw_insights (provider, resource, date_start);
create index if not exists ad_sync_runs_started_at_idx on public.ad_sync_runs (started_at desc);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ad_accounts_set_updated_at on public.ad_accounts;
create trigger ad_accounts_set_updated_at
before update on public.ad_accounts
for each row execute function public.set_updated_at_timestamp();

drop trigger if exists ad_campaigns_set_updated_at on public.ad_campaigns;
create trigger ad_campaigns_set_updated_at
before update on public.ad_campaigns
for each row execute function public.set_updated_at_timestamp();

drop trigger if exists ad_groups_set_updated_at on public.ad_groups;
create trigger ad_groups_set_updated_at
before update on public.ad_groups
for each row execute function public.set_updated_at_timestamp();

drop trigger if exists ad_ads_set_updated_at on public.ad_ads;
create trigger ad_ads_set_updated_at
before update on public.ad_ads
for each row execute function public.set_updated_at_timestamp();

drop trigger if exists ad_metrics_daily_set_updated_at on public.ad_metrics_daily;
create trigger ad_metrics_daily_set_updated_at
before update on public.ad_metrics_daily
for each row execute function public.set_updated_at_timestamp();

create or replace view public.marketing_daily_summary
with (security_invoker = true) as
select
  date,
  market,
  provider,
  currency,
  sum(coalesce(spend_czk, 0)) as spend_czk,
  sum(coalesce(impressions, 0)) as impressions,
  sum(coalesce(clicks, 0)) as clicks,
  sum(coalesce(interactions, 0)) as interactions,
  sum(coalesce(conversions, 0)) as conversions,
  sum(coalesce(conversion_value_czk, 0)) as conversion_value_czk,
  case
    when sum(coalesce(conversions, 0)) > 0 then sum(coalesce(conversion_value_czk, 0)) / sum(coalesce(conversions, 0))
    else 0
  end as platform_average_order_value_czk,
  case
    when sum(coalesce(spend_czk, 0)) > 0 then sum(coalesce(conversion_value_czk, 0)) / sum(coalesce(spend_czk, 0))
    else 0
  end as roas_platform
from public.ad_metrics_daily
where level = 'campaign'
group by date, market, provider, currency;

create or replace view public.marketing_campaign_daily_summary
with (security_invoker = true) as
select
  date,
  market,
  provider,
  account_id,
  account_name,
  campaign_id,
  campaign_name,
  currency,
  sum(coalesce(spend_czk, 0)) as spend_czk,
  sum(coalesce(impressions, 0)) as impressions,
  sum(coalesce(clicks, 0)) as clicks,
  sum(coalesce(interactions, 0)) as interactions,
  sum(coalesce(conversions, 0)) as conversions,
  sum(coalesce(conversion_value_czk, 0)) as conversion_value_czk,
  case
    when sum(coalesce(conversions, 0)) > 0 then sum(coalesce(conversion_value_czk, 0)) / sum(coalesce(conversions, 0))
    else 0
  end as platform_average_order_value_czk,
  case
    when sum(coalesce(spend_czk, 0)) > 0 then sum(coalesce(conversion_value_czk, 0)) / sum(coalesce(spend_czk, 0))
    else 0
  end as roas_platform
from public.ad_metrics_daily
where level = 'campaign'
group by date, market, provider, account_id, account_name, campaign_id, campaign_name, currency;

revoke all on public.marketing_daily_summary from anon;
revoke all on public.marketing_campaign_daily_summary from anon;
grant select on public.marketing_daily_summary to authenticated;
grant select on public.marketing_campaign_daily_summary to authenticated;

alter table public.ad_accounts enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_groups enable row level security;
alter table public.ad_ads enable row level security;
alter table public.ad_metrics_daily enable row level security;
alter table public.ad_raw_insights enable row level security;
alter table public.ad_sync_runs enable row level security;

drop policy if exists "ad_accounts_read_authenticated" on public.ad_accounts;
create policy "ad_accounts_read_authenticated" on public.ad_accounts
for select to authenticated using (true);

drop policy if exists "ad_campaigns_read_authenticated" on public.ad_campaigns;
create policy "ad_campaigns_read_authenticated" on public.ad_campaigns
for select to authenticated using (true);

drop policy if exists "ad_groups_read_authenticated" on public.ad_groups;
create policy "ad_groups_read_authenticated" on public.ad_groups
for select to authenticated using (true);

drop policy if exists "ad_ads_read_authenticated" on public.ad_ads;
create policy "ad_ads_read_authenticated" on public.ad_ads
for select to authenticated using (true);

drop policy if exists "ad_metrics_daily_read_authenticated" on public.ad_metrics_daily;
create policy "ad_metrics_daily_read_authenticated" on public.ad_metrics_daily
for select to authenticated using (true);

drop policy if exists "ad_raw_insights_read_authenticated" on public.ad_raw_insights;
create policy "ad_raw_insights_read_authenticated" on public.ad_raw_insights
for select to authenticated using (true);

drop policy if exists "ad_sync_runs_read_authenticated" on public.ad_sync_runs;
create policy "ad_sync_runs_read_authenticated" on public.ad_sync_runs
for select to authenticated using (true);
