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
import { isExcludedBusinessOrder } from '../src/businessOrderStatus.js';
import {
  attachPurchasePriceLookup,
  buildPurchasePriceLookup,
  getOrderLineItems,
  getLineBuyPriceWithoutVat,
  getLineQuantity,
  getLineRevenueWithoutVat,
} from '../src/orderLineItems.js';
import fs from 'node:fs';

function loadLocalEnvFile(filePath = '.env.ads') {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    if (process.env[key]) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadLocalEnvFile();

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
  return order.currency || order.raw_data?.currency_id || order.raw_data?.currency?.code || order.raw_data?.currency || 'CZK';
}

function getOrderMarket(order) {
  return String(order.market || order.raw_data?.language_id || 'unknown').toLowerCase();
}

function getOrderDedupeKey(order) {
  return order.raw_data?.order_number || order.raw_data?.number || order.id;
}

function deduplicateOrders(rows) {
  const seen = new Set();
  const deduped = [];

  for (const order of rows) {
    const key = getOrderDedupeKey(order);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(order);
  }

  return deduped;
}

function isCancelled(order) {
  return isExcludedBusinessOrder(order);
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
  const products = getOrderLineItems(order, { allowRawFallback: false });
  const rate = fxRates[getOrderCurrency(order)];
  if (rate == null) throw new Error(`Missing FX rate for currency "${getOrderCurrency(order)}"`);

  let revenue = 0;
  let cost = 0;
  let missingItems = 0;

  for (const product of products) {
    const quantity = Math.max(getLineQuantity(product), 1);
    const buyPrice = getLineBuyPriceWithoutVat(product);
    revenue += getLineRevenueWithoutVat(product);
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
  const dedupedRows = deduplicateOrders(rows);
  let cancelledRows = 0;

  for (const order of dedupedRows) {
    if (isCancelled(order)) {
      cancelledRows += 1;
      continue;
    }
    const date = dateOnly(order.order_date || order.created_at);
    if (!date || date < from || date > to) continue;
    const market = getOrderMarket(order);
    if (marketFilter && !marketFilter.has(market)) continue;

    const key = orderKey(market);
    if (!summary.has(key)) summary.set(key, { market, ...emptyOrderMetrics() });
    addOrderMetrics(summary.get(key), order, fxRates);
  }

  return {
    summary,
    stats: {
      sourceRows: rows.length,
      deduplicatedRows: dedupedRows.length,
      duplicateRows: rows.length - dedupedRows.length,
      cancelledRows,
    },
  };
}

function printCoverage({ from, to, adSummary, orderSummary, orderStats }) {
  console.log(`[check-ads-coverage] Range: ${from} -> ${to}`);
  console.log([
    '[check-ads-coverage] Orders',
    `source_rows=${formatNumber(orderStats.sourceRows)}`,
    `deduped=${formatNumber(orderStats.deduplicatedRows)}`,
    `duplicates_removed=${formatNumber(orderStats.duplicateRows)}`,
    `cancelled_removed=${formatNumber(orderStats.cancelledRows)}`,
  ].join(' | '));
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

  const [adRows, orderRowsRaw, purchasePriceRows] = await Promise.all([
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
      select: 'id,order_date,created_at,market,currency,status,raw_data,order_items(order_id,product_code,product_name,quantity,buy_price,unit_price_without_vat,total_price_without_vat,vat_rate,sku,ean)',
      filters: orderFilters,
      orderBy: 'order_date.desc',
    }),
    fetchAllRowsWithRange({
      supabaseUrl,
      serviceRoleKey,
      table: 'upgates_product_purchase_prices_current',
      select: 'product_code,currency,purchase_price_without_vat_native',
      filters: {
        purchase_price_without_vat_native: 'not.is.null',
      },
      orderBy: 'product_code.asc',
    }),
  ]);

  const adSummary = buildAdSummary(adRows);
  const orderRows = attachPurchasePriceLookup(orderRowsRaw, buildPurchasePriceLookup(purchasePriceRows));
  const { summary: orderSummary, stats: orderStats } = buildOrderSummary(orderRows, fxRates, from, to, marketFilter);
  printCoverage({ from, to, adSummary, orderSummary, orderStats });

  if (requireData && !adRows.length) {
    throw new Error('Required Ads coverage data is missing for the selected filter.');
  }
}

main().catch((error) => {
  console.error('[check-ads-coverage] FAILED:', error.message);
  process.exit(1);
});
