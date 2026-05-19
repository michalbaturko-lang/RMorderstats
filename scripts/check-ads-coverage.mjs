#!/usr/bin/env node

/**
 * Read-only coverage audit for the Ads dashboard.
 *
 * It verifies which marketing rows are already present in Supabase for a date
 * range and compares campaign spend with real order revenue/margin by market.
 * This does not call Google Ads or Meta APIs and does not write to Supabase.
 */

import {
  DEFAULT_FX_RATES,
  parseJsonEnv,
  parseMarketFilter,
  requireEnv,
  resolveDateRange,
  supabaseRequest,
} from './lib/ads-sync-utils.mjs';

const CAMPAIGN_LEVEL = 'campaign';

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return Math.round(toNumber(value)).toLocaleString('cs-CZ');
}

function formatCurrency(value) {
  return `${formatNumber(value)} Kč`;
}

function formatPercent(value) {
  return `${toNumber(value).toFixed(1)} %`;
}

function parseCsv(value, fallback) {
  const values = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : fallback;
}

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

function getOrderCurrency(order) {
  return order.currency || order.raw_data?.currency_id || 'CZK';
}

function getOrderMarket(order) {
  return String(order.market || order.raw_data?.language_id || 'unknown').toLowerCase();
}

function isCancelled(order) {
  const status = String(order.status || '').toUpperCase();
  const rawStatus = String(order.raw_data?.status || '').toUpperCase();
  return status === 'STORNO' || rawStatus === 'STORNO';
}

function emptyOrderMetrics() {
  return {
    orders: 0,
    exactOrders: 0,
    revenue: 0,
    exactGrossProfit: 0,
    missingCostOrders: 0,
  };
}

function addOrderMetrics(target, order, fxRates) {
  const products = Array.isArray(order.raw_data?.products) ? order.raw_data.products : [];
  const rate = fxRates[getOrderCurrency(order)];
  if (rate == null) throw new Error(`Missing FX rate for currency "${getOrderCurrency(order)}"`);

  let revenue = 0;
  let cost = 0;
  let missingItems = 0;

  for (const product of products) {
    const quantity = Math.max(toNumber(product.quantity), 1);
    const buyPrice = toNumber(product.buy_price);
    revenue += toNumber(product.price_without_vat);
    if (buyPrice > 0) {
      cost += buyPrice * quantity;
    } else {
      missingItems += 1;
    }
  }

  const revenueCzk = revenue * rate;
  const costCzk = cost * rate;

  target.orders += 1;
  target.revenue += revenueCzk;

  if (products.length && revenueCzk > 0 && missingItems === 0) {
    target.exactOrders += 1;
    target.exactGrossProfit += revenueCzk - costCzk;
  } else if (products.length) {
    target.missingCostOrders += 1;
  }
}

async function fetchAllRowsWithRange({ supabaseUrl, serviceRoleKey, table, select, filters = {}, orderBy }) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const searchParams = {
      select,
      ...filters,
    };
    if (orderBy) searchParams.order = orderBy;

    const page = await supabaseRequest({
      supabaseUrl,
      serviceRoleKey,
      path: `/rest/v1/${table}`,
      searchParams,
      prefer: 'count=exact',
      headers: { Range: `${from}-${from + pageSize - 1}` },
    });

    const chunk = Array.isArray(page) ? page : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
}

function adKey(provider, market) {
  return `${provider}:${market}`;
}

function orderKey(market) {
  return market;
}

function buildAdSummary(rows) {
  const summary = new Map();

  for (const row of rows) {
    const key = adKey(row.provider, row.market);
    if (!summary.has(key)) {
      summary.set(key, {
        provider: row.provider,
        market: row.market,
        rows: 0,
        days: new Set(),
        firstDate: null,
        lastDate: null,
        spend: 0,
        conversionValue: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
      });
    }
    const target = summary.get(key);
    target.rows += 1;
    target.spend += toNumber(row.spend_czk);
    target.conversionValue += toNumber(row.conversion_value_czk);
    target.clicks += toNumber(row.clicks);
    target.impressions += toNumber(row.impressions);
    target.conversions += toNumber(row.conversions);
    if (row.date) {
      target.days.add(row.date);
      target.firstDate = !target.firstDate || row.date < target.firstDate ? row.date : target.firstDate;
      target.lastDate = !target.lastDate || row.date > target.lastDate ? row.date : target.lastDate;
    }
  }

  return Array.from(summary.values()).map((row) => ({
    ...row,
    days: row.days.size,
  }));
}

function buildOrderSummary(rows, fxRates, from, to, marketFilter) {
  const summary = new Map();

  for (const order of rows) {
    if (isCancelled(order)) continue;
    const date = dateOnly(order.order_date || order.created_at);
    if (!date || date < from || date > to) continue;
    const market = getOrderMarket(order);
    if (marketFilter && !marketFilter.has(market)) continue;

    const key = orderKey(market);
    if (!summary.has(key)) summary.set(key, { market, ...emptyOrderMetrics() });
    addOrderMetrics(summary.get(key), order, fxRates);
  }

  return summary;
}

function printCoverage({ from, to, adSummary, orderSummary }) {
  console.log(`[check-ads-coverage] Range: ${from} -> ${to}`);
  if (!adSummary.length) {
    console.log('[check-ads-coverage] No campaign Ads rows found for this filter.');
    return;
  }

  for (const row of adSummary.sort((a, b) => `${a.provider}:${a.market}`.localeCompare(`${b.provider}:${b.market}`))) {
    const orders = orderSummary.get(row.market) || emptyOrderMetrics();
    const pno = orders.revenue ? (row.spend / orders.revenue) * 100 : 0;
    const realRoas = row.spend ? orders.revenue / row.spend : 0;
    const grossProfitAfterAds = orders.exactGrossProfit - row.spend;

    console.log([
      `[check-ads-coverage] ${row.provider}/${row.market.toUpperCase()}`,
      `ads_rows=${formatNumber(row.rows)}`,
      `days=${formatNumber(row.days)}`,
      `data=${row.firstDate || 'n/a'}..${row.lastDate || 'n/a'}`,
      `spend=${formatCurrency(row.spend)}`,
      `platform_value=${formatCurrency(row.conversionValue)}`,
      `real_revenue=${formatCurrency(orders.revenue)}`,
      `PNO=${formatPercent(pno)}`,
      `real_roas=${realRoas.toFixed(2).replace('.', ',')}`,
      `gross_profit_after_ads=${formatCurrency(grossProfitAfterAds)}`,
      `exact_orders=${formatNumber(orders.exactOrders)}/${formatNumber(orders.orders)}`,
    ].join(' | '));
  }
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const fxRates = parseJsonEnv('FX_RATES_JSON', DEFAULT_FX_RATES);
  const { from, to } = resolveDateRange();
  const marketFilter = parseMarketFilter();
  const providers = parseCsv(process.env.ADS_COVERAGE_PROVIDERS || process.env.ADS_SYNC_PROVIDERS, ['google_ads', 'meta_ads']);
  const requireData = process.env.ADS_COVERAGE_REQUIRE_DATA === '1';

  const adFilters = {
    date: [`gte.${from}`, `lte.${to}`],
    level: `eq.${CAMPAIGN_LEVEL}`,
    provider: `in.(${providers.join(',')})`,
  };
  if (marketFilter) adFilters.market = `in.(${Array.from(marketFilter).join(',')})`;

  const orderFilters = {
    order_date: [`gte.${from}T00:00:00`, `lte.${to}T23:59:59`],
  };

  const [adRows, orderRows] = await Promise.all([
    fetchAllRowsWithRange({
      supabaseUrl,
      serviceRoleKey,
      table: 'ad_metrics_daily',
      select: 'date,provider,market,level,spend_czk,impressions,clicks,conversions,conversion_value_czk',
      filters: adFilters,
      orderBy: 'date.asc',
    }),
    fetchAllRowsWithRange({
      supabaseUrl,
      serviceRoleKey,
      table: 'orders',
      select: 'id,order_date,created_at,market,currency,status,raw_data',
      filters: orderFilters,
      orderBy: 'order_date.asc',
    }),
  ]);

  const adSummary = buildAdSummary(adRows);
  const orderSummary = buildOrderSummary(orderRows, fxRates, from, to, marketFilter);
  printCoverage({ from, to, adSummary, orderSummary });

  if (requireData && !adRows.length) {
    throw new Error('Required Ads coverage data is missing for the selected filter.');
  }
}

main().catch((error) => {
  console.error('[check-ads-coverage] FAILED:', error.message);
  process.exit(1);
});
