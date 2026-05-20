-- Business-ready marketing analytics views.
-- Run after supabase/ad_marketing_analytics.sql.
--
-- These views intentionally do not write data. They normalize orders the same
-- way as the dashboard/audit scripts: deduplicate first, exclude STORNO orders,
-- calculate product revenue without VAT/shipping, and use exact gross profit
-- only for orders where every product has a buy price.

create or replace view public.order_business_daily_summary
with (security_invoker = true) as
with deduped_orders as (
  select *
  from (
    select
      o.*,
      row_number() over (
        partition by coalesce(o.raw_data ->> 'order_number', o.raw_data ->> 'number', o.id::text)
        order by o.order_date desc nulls last, o.created_at desc nulls last, o.id::text desc
      ) as row_number
    from public.orders o
  ) ranked
  where ranked.row_number = 1
),
clean_orders as (
  select
    id,
    coalesce(order_date, created_at)::date as date,
    lower(coalesce(market, raw_data ->> 'language_id', 'unknown')) as market,
    upper(coalesce(currency, raw_data ->> 'currency_id', 'CZK')) as currency,
    raw_data,
    case upper(coalesce(currency, raw_data ->> 'currency_id', 'CZK'))
      when 'CZK' then 1::numeric
      when 'EUR' then 25.2::numeric
      when 'HUF' then 0.063::numeric
      when 'RON' then 5.1::numeric
      else 1::numeric
    end as fx_rate,
    case
      when replace(coalesce(raw_data -> 'shipment' ->> 'price_without_vat', ''), ',', '.') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then replace(coalesce(raw_data -> 'shipment' ->> 'price_without_vat', ''), ',', '.')::numeric
      else 0::numeric
    end as shipping_revenue_native
  from deduped_orders
  where coalesce(upper(status), '') <> 'STORNO'
    and coalesce(upper(raw_data ->> 'status'), '') <> 'STORNO'
),
order_products as (
  select
    o.id as order_id,
    o.date,
    o.market,
    o.currency,
    o.fx_rate,
    o.shipping_revenue_native,
    product.value as product
  from clean_orders o
  left join lateral jsonb_array_elements(
    case
      when jsonb_typeof(o.raw_data -> 'products') = 'array' then o.raw_data -> 'products'
      else '[]'::jsonb
    end
  ) as product(value) on true
),
line_values as (
  select
    order_id,
    date,
    market,
    currency,
    fx_rate,
    shipping_revenue_native,
    product,
    replace(coalesce(product ->> 'price_without_vat', ''), ',', '.') as price_without_vat_raw,
    replace(coalesce(product ->> 'quantity', ''), ',', '.') as quantity_raw,
    replace(coalesce(product ->> 'buy_price', ''), ',', '.') as buy_price_raw
  from order_products
),
parsed_lines as (
  select
    order_id,
    date,
    market,
    currency,
    fx_rate,
    shipping_revenue_native,
    product,
    case
      when price_without_vat_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then price_without_vat_raw::numeric
      else 0::numeric
    end as revenue_native,
    greatest(
      case
        when quantity_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then quantity_raw::numeric
        else 0::numeric
      end,
      1::numeric
    ) as quantity,
    case
      when buy_price_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then buy_price_raw::numeric
      else 0::numeric
    end as buy_price_native
  from line_values
),
order_metrics as (
  select
    order_id,
    date,
    market,
    currency,
    fx_rate,
    count(product) as product_rows,
    coalesce(sum(revenue_native), 0) as revenue_native,
    max(shipping_revenue_native) as shipping_revenue_native,
    coalesce(sum(
      case
        when buy_price_native > 0 then buy_price_native * quantity
        else 0
      end
    ), 0) as cost_native,
    count(product) filter (where product is not null and buy_price_native <= 0) as missing_cost_items
  from parsed_lines
  group by order_id, date, market, currency, fx_rate
),
daily as (
  select
    date,
    market,
    count(*) as orders,
    count(*) filter (
      where product_rows > 0 and revenue_native > 0 and missing_cost_items = 0
    ) as exact_orders,
    count(*) filter (
      where product_rows > 0 and missing_cost_items > 0
    ) as missing_cost_orders,
    sum(product_rows) as product_rows,
    sum(missing_cost_items) as missing_cost_items,
    round(sum(revenue_native * fx_rate), 2) as revenue_czk,
    round(sum(shipping_revenue_native * fx_rate), 2) as shipping_revenue_czk,
    round(sum(
      case
        when product_rows > 0 and revenue_native > 0 and missing_cost_items = 0 then revenue_native * fx_rate
        else 0
      end
    ), 2) as exact_revenue_czk,
    round(sum(
      case
        when product_rows > 0 and revenue_native > 0 and missing_cost_items = 0 then cost_native * fx_rate
        else 0
      end
    ), 2) as exact_cost_czk,
    round(sum(
      case
        when product_rows > 0 and revenue_native > 0 and missing_cost_items = 0 then (revenue_native - cost_native) * fx_rate
        else 0
      end
    ), 2) as exact_gross_profit_czk
  from order_metrics
  group by date, market
)
select
  date,
  market,
  orders,
  exact_orders,
  missing_cost_orders,
  product_rows,
  missing_cost_items,
  revenue_czk,
  exact_revenue_czk,
  exact_cost_czk,
  exact_gross_profit_czk,
  case
    when exact_revenue_czk > 0 then round((exact_gross_profit_czk / exact_revenue_czk) * 100, 4)
    else 0
  end as exact_gross_profit_pct,
  case
    when orders > 0 then round((exact_orders::numeric / orders::numeric) * 100, 4)
    else 0
  end as exact_order_share_pct,
  shipping_revenue_czk
from daily;

create or replace view public.marketing_business_provider_daily_summary
with (security_invoker = true) as
select
  ads.date,
  ads.market,
  ads.provider,
  ads.currency as ads_currency,
  ads.spend_czk,
  ads.impressions,
  ads.clicks,
  ads.interactions,
  ads.conversions,
  ads.conversion_value_czk,
  ads.platform_average_order_value_czk,
  ads.roas_platform,
  coalesce(orders.orders, 0) as orders,
  coalesce(orders.exact_orders, 0) as exact_orders,
  coalesce(orders.missing_cost_orders, 0) as missing_cost_orders,
  coalesce(orders.revenue_czk, 0) as real_revenue_czk,
  coalesce(orders.exact_revenue_czk, 0) as exact_revenue_czk,
  coalesce(orders.exact_cost_czk, 0) as exact_cost_czk,
  coalesce(orders.exact_gross_profit_czk, 0) as exact_gross_profit_czk,
  coalesce(orders.exact_gross_profit_czk, 0) - coalesce(ads.spend_czk, 0) as gross_profit_after_ads_czk,
  case
    when coalesce(orders.revenue_czk, 0) > 0 then round((coalesce(ads.spend_czk, 0) / orders.revenue_czk) * 100, 4)
    else 0
  end as pno,
  case
    when coalesce(ads.spend_czk, 0) > 0 then round(coalesce(orders.revenue_czk, 0) / ads.spend_czk, 6)
    else 0
  end as real_roas,
  case
    when coalesce(orders.exact_gross_profit_czk, 0) > 0 then round((coalesce(ads.spend_czk, 0) / orders.exact_gross_profit_czk) * 100, 4)
    else 0
  end as spend_to_gross_profit_pct,
  coalesce(orders.shipping_revenue_czk, 0) as shipping_revenue_czk
from public.marketing_daily_summary ads
left join public.order_business_daily_summary orders
  on orders.date = ads.date
  and orders.market = ads.market;

create or replace view public.marketing_business_daily_total
with (security_invoker = true) as
with ads as (
  select
    date,
    market,
    array_agg(distinct provider order by provider) as providers,
    array_agg(distinct currency order by currency) as ads_currencies,
    sum(coalesce(spend_czk, 0)) as spend_czk,
    sum(coalesce(impressions, 0)) as impressions,
    sum(coalesce(clicks, 0)) as clicks,
    sum(coalesce(interactions, 0)) as interactions,
    sum(coalesce(conversions, 0)) as conversions,
    sum(coalesce(conversion_value_czk, 0)) as conversion_value_czk
  from public.marketing_daily_summary
  group by date, market
)
select
  coalesce(ads.date, orders.date) as date,
  coalesce(ads.market, orders.market) as market,
  coalesce(ads.providers, array[]::text[]) as providers,
  coalesce(ads.ads_currencies, array[]::text[]) as ads_currencies,
  coalesce(ads.spend_czk, 0) as spend_czk,
  coalesce(ads.impressions, 0) as impressions,
  coalesce(ads.clicks, 0) as clicks,
  coalesce(ads.interactions, 0) as interactions,
  coalesce(ads.conversions, 0) as conversions,
  coalesce(ads.conversion_value_czk, 0) as conversion_value_czk,
  case
    when coalesce(ads.conversions, 0) > 0 then round(coalesce(ads.conversion_value_czk, 0) / ads.conversions, 4)
    else 0
  end as platform_average_order_value_czk,
  case
    when coalesce(ads.spend_czk, 0) > 0 then round(coalesce(ads.conversion_value_czk, 0) / ads.spend_czk, 6)
    else 0
  end as roas_platform,
  coalesce(orders.orders, 0) as orders,
  coalesce(orders.exact_orders, 0) as exact_orders,
  coalesce(orders.missing_cost_orders, 0) as missing_cost_orders,
  coalesce(orders.revenue_czk, 0) as real_revenue_czk,
  coalesce(orders.exact_revenue_czk, 0) as exact_revenue_czk,
  coalesce(orders.exact_cost_czk, 0) as exact_cost_czk,
  coalesce(orders.exact_gross_profit_czk, 0) as exact_gross_profit_czk,
  coalesce(orders.exact_gross_profit_czk, 0) - coalesce(ads.spend_czk, 0) as gross_profit_after_ads_czk,
  case
    when coalesce(orders.revenue_czk, 0) > 0 then round((coalesce(ads.spend_czk, 0) / orders.revenue_czk) * 100, 4)
    else 0
  end as pno,
  case
    when coalesce(ads.spend_czk, 0) > 0 then round(coalesce(orders.revenue_czk, 0) / ads.spend_czk, 6)
    else 0
  end as real_roas,
  case
    when coalesce(orders.exact_gross_profit_czk, 0) > 0 then round((coalesce(ads.spend_czk, 0) / orders.exact_gross_profit_czk) * 100, 4)
    else 0
  end as spend_to_gross_profit_pct,
  coalesce(orders.shipping_revenue_czk, 0) as shipping_revenue_czk
from ads
full outer join public.order_business_daily_summary orders
  on orders.date = ads.date
  and orders.market = ads.market;

revoke all on public.order_business_daily_summary from anon;
revoke all on public.marketing_business_provider_daily_summary from anon;
revoke all on public.marketing_business_daily_total from anon;
grant select on public.order_business_daily_summary to authenticated;
grant select on public.marketing_business_provider_daily_summary to authenticated;
grant select on public.marketing_business_daily_total to authenticated;
