-- Apply once in Supabase SQL editor if ad_marketing_analytics.sql was run
-- before the marketing summary views used security_invoker.
--
-- The tables themselves are protected by RLS. These views must also run as the
-- querying user, otherwise anonymous REST requests can read aggregated Ads data.

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
