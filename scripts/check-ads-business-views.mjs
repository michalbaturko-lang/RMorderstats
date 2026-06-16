#!/usr/bin/env node

/**
 * Read-only verifier for Supabase business marketing views.
 *
 * It compares the SQL views from supabase/ad_business_analytics_views.sql with
 * the same source data used by the dashboard: campaign-level Ads rows and
 * deduplicated, non-cancelled orders. It does not call ad platforms and does
 * not write to Supabase.
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
  return `${toNumber(value).toFixed(2)} %`;
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
    missingCostOrders: 0,
    revenue: 0,
    shippingRevenue: 0,
    exactRevenue: 0,
    exactCost: 0,
    exactGrossProfit: 0,
    missingCostItems: 0,
  };
}

function emptyAdMetrics() {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    interactions: 0,
    conversions: 0,
    conversionValue: 0,
  };
}

function addOrderMetrics(target, order, fxRates) {
  const products = getOrderLineItems(order, { allowRawFallback: false });
  const currency = getOrderCurrency(order);
  const rate = fxRates[currency];
  if (rate == null) throw new Error(`Missing FX rate for currency "${currency}"`);

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
  const shippingRevenueCzk = toNumber(order.raw_data?.shipment?.price_without_vat) * rate;
  const costCzk = cost * rate;

  target.orders += 1;
  target.revenue += revenueCzk;
  target.shippingRevenue += shippingRevenueCzk;

  if (products.length && revenueCzk > 0 && missingItems === 0) {
    target.exactOrders += 1;
    target.exactRevenue += revenueCzk;
    target.exactCost += costCzk;
    target.exactGrossProfit += revenueCzk - costCzk;
  } else if (products.length && missingItems > 0) {
    target.missingCostOrders += 1;
    target.missingCostItems += missingItems;
  }
}

function addAdMetrics(target, row) {
  target.spend += toNumber(row.spend_czk);
  target.impressions += toNumber(row.impressions);
  target.clicks += toNumber(row.clicks);
  target.interactions += toNumber(row.interactions);
  target.conversions += toNumber(row.conversions);
  target.conversionValue += toNumber(row.conversion_value_czk);
}

async function fetchAllRowsWithRange({ supabaseUrl, serviceRoleKey, table, select, filters = {}, orderBy }) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const searchParams = { select, ...filters };
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

async function fetchViewRows({ supabaseUrl, serviceRoleKey, table, select, filters, orderBy }) {
  try {
    const rows = await fetchAllRowsWithRange({
      supabaseUrl,
      serviceRoleKey,
      table,
      select,
      filters,
      orderBy,
    });
    return { table, rows, missing: false };
  } catch (error) {
    const message = String(error.message || '');
    if (/PGRST205|could not find the table|relation .* does not exist|schema cache/i.test(message)) {
      return { table, rows: [], missing: true, error: message };
    }
    throw error;
  }
}

function buildOrderDaily(rows, fxRates, from, to, marketFilter) {
  const byKey = new Map();
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

    const key = `${date}:${market}`;
    if (!byKey.has(key)) byKey.set(key, { date, market, ...emptyOrderMetrics() });
    addOrderMetrics(byKey.get(key), order, fxRates);
  }

  return {
    rows: Array.from(byKey.values()),
    stats: {
      sourceRows: rows.length,
      deduplicatedRows: dedupedRows.length,
      duplicateRows: rows.length - dedupedRows.length,
      cancelledRows,
    },
  };
}

function buildAdDaily(rows) {
  const byProvider = new Map();
  const byTotal = new Map();

  for (const row of rows) {
    const providerKey = `${row.date}:${row.market}:${row.provider}`;
    if (!byProvider.has(providerKey)) {
      byProvider.set(providerKey, { date: row.date, market: row.market, provider: row.provider, ...emptyAdMetrics() });
    }
    addAdMetrics(byProvider.get(providerKey), row);

    const totalKey = `${row.date}:${row.market}`;
    if (!byTotal.has(totalKey)) {
      byTotal.set(totalKey, { date: row.date, market: row.market, ...emptyAdMetrics() });
    }
    addAdMetrics(byTotal.get(totalKey), row);
  }

  return {
    providerRows: Array.from(byProvider.values()),
    totalRows: Array.from(byTotal.values()),
  };
}

function aggregateOrderByMarket(rows) {
  const byMarket = new Map();
  for (const row of rows) {
    if (!byMarket.has(row.market)) byMarket.set(row.market, { market: row.market, ...emptyOrderMetrics() });
    const target = byMarket.get(row.market);
    target.orders += toNumber(row.orders);
    target.exactOrders += toNumber(row.exactOrders ?? row.exact_orders);
    target.missingCostOrders += toNumber(row.missingCostOrders ?? row.missing_cost_orders);
    target.revenue += toNumber(row.revenue ?? row.revenue_czk);
    target.shippingRevenue += toNumber(row.shippingRevenue ?? row.shipping_revenue_czk);
    target.exactRevenue += toNumber(row.exactRevenue ?? row.exact_revenue_czk);
    target.exactCost += toNumber(row.exactCost ?? row.exact_cost_czk);
    target.exactGrossProfit += toNumber(row.exactGrossProfit ?? row.exact_gross_profit_czk);
    target.missingCostItems += toNumber(row.missingCostItems ?? row.missing_cost_items);
  }
  return Array.from(byMarket.values()).sort((a, b) => a.market.localeCompare(b.market));
}

function aggregateBusinessRows(rows, keyFields) {
  const byKey = new Map();
  for (const row of rows) {
    const key = keyFields.map((field) => row[field]).join(':');
    if (!byKey.has(key)) {
      const initial = Object.fromEntries(keyFields.map((field) => [field, row[field]]));
      byKey.set(key, { ...initial, ...emptyAdMetrics(), ...emptyOrderMetrics(), grossProfitAfterAds: 0 });
    }
    const target = byKey.get(key);
    target.spend += toNumber(row.spend ?? row.spend_czk);
    target.impressions += toNumber(row.impressions);
    target.clicks += toNumber(row.clicks);
    target.interactions += toNumber(row.interactions);
    target.conversions += toNumber(row.conversions);
    target.conversionValue += toNumber(row.conversionValue ?? row.conversion_value_czk);
    target.orders += toNumber(row.orders);
    target.exactOrders += toNumber(row.exactOrders ?? row.exact_orders);
    target.missingCostOrders += toNumber(row.missingCostOrders ?? row.missing_cost_orders);
    target.revenue += toNumber(row.revenue ?? row.real_revenue_czk);
    target.shippingRevenue += toNumber(row.shippingRevenue ?? row.shipping_revenue_czk);
    target.exactRevenue += toNumber(row.exactRevenue ?? row.exact_revenue_czk);
    target.exactCost += toNumber(row.exactCost ?? row.exact_cost_czk);
    target.exactGrossProfit += toNumber(row.exactGrossProfit ?? row.exact_gross_profit_czk);
    target.grossProfitAfterAds += toNumber(row.grossProfitAfterAds ?? row.gross_profit_after_ads_czk);
  }
  return Array.from(byKey.values()).sort((a, b) => keyFields.map((field) => String(a[field]).localeCompare(String(b[field]))).find(Boolean) || 0);
}

function expectedBusinessRows({ adRows, orderRows, keyFields }) {
  const ordersByDateMarket = new Map(orderRows.map((row) => [`${row.date}:${row.market}`, row]));
  const businessRows = adRows.map((ad) => {
    const orders = ordersByDateMarket.get(`${ad.date}:${ad.market}`) || emptyOrderMetrics();
    return {
      ...ad,
      orders: orders.orders,
      exactOrders: orders.exactOrders,
      missingCostOrders: orders.missingCostOrders,
      revenue: orders.revenue,
      shippingRevenue: orders.shippingRevenue,
      exactRevenue: orders.exactRevenue,
      exactCost: orders.exactCost,
      exactGrossProfit: orders.exactGrossProfit,
      grossProfitAfterAds: orders.exactGrossProfit - ad.spend,
    };
  });

  if (keyFields.length === 1 && keyFields[0] === 'market') {
    const adKeys = new Set(adRows.map((row) => `${row.date}:${row.market}`));
    for (const orders of orderRows) {
      const key = `${orders.date}:${orders.market}`;
      if (adKeys.has(key)) continue;
      businessRows.push({
        date: orders.date,
        market: orders.market,
        ...emptyAdMetrics(),
        orders: orders.orders,
        exactOrders: orders.exactOrders,
        missingCostOrders: orders.missingCostOrders,
        revenue: orders.revenue,
        shippingRevenue: orders.shippingRevenue,
        exactRevenue: orders.exactRevenue,
        exactCost: orders.exactCost,
        exactGrossProfit: orders.exactGrossProfit,
        grossProfitAfterAds: orders.exactGrossProfit,
      });
    }
  }

  return aggregateBusinessRows(businessRows, keyFields);
}

function compareNumber(label, expected, actual, tolerance, failures) {
  const diff = Math.abs(toNumber(expected) - toNumber(actual));
  if (diff > tolerance) {
    failures.push(`${label}: expected ${expected}, got ${actual}, diff ${diff}`);
  }
}

function compareOrderAggregates(expectedRows, actualRows) {
  const failures = [];
  const actualByMarket = new Map(actualRows.map((row) => [row.market, row]));

  for (const expected of expectedRows) {
    const actual = actualByMarket.get(expected.market);
    if (!actual) {
      failures.push(`missing order market ${expected.market}`);
      continue;
    }
    compareNumber(`${expected.market} orders`, expected.orders, actual.orders, 0, failures);
    compareNumber(`${expected.market} exactOrders`, expected.exactOrders, actual.exactOrders, 0, failures);
    compareNumber(`${expected.market} missingCostOrders`, expected.missingCostOrders, actual.missingCostOrders, 0, failures);
    compareNumber(`${expected.market} revenue`, expected.revenue, actual.revenue, 0.5, failures);
    compareNumber(`${expected.market} shippingRevenue`, expected.shippingRevenue, actual.shippingRevenue, 0.5, failures);
    compareNumber(`${expected.market} exactCost`, expected.exactCost, actual.exactCost, 0.5, failures);
    compareNumber(`${expected.market} exactGrossProfit`, expected.exactGrossProfit, actual.exactGrossProfit, 0.5, failures);
  }

  return failures;
}

function compareBusinessAggregates(expectedRows, actualRows, keyFields) {
  const failures = [];
  const actualByKey = new Map(actualRows.map((row) => [keyFields.map((field) => row[field]).join(':'), row]));

  for (const expected of expectedRows) {
    const key = keyFields.map((field) => expected[field]).join(':');
    const actual = actualByKey.get(key);
    if (!actual) {
      failures.push(`missing business key ${key}`);
      continue;
    }
    compareNumber(`${key} spend`, expected.spend, actual.spend, 0.5, failures);
    compareNumber(`${key} revenue`, expected.revenue, actual.revenue, 0.5, failures);
    compareNumber(`${key} shippingRevenue`, expected.shippingRevenue, actual.shippingRevenue, 0.5, failures);
    compareNumber(`${key} exactGrossProfit`, expected.exactGrossProfit, actual.exactGrossProfit, 0.5, failures);
    compareNumber(`${key} grossProfitAfterAds`, expected.grossProfitAfterAds, actual.grossProfitAfterAds, 0.5, failures);
    compareNumber(`${key} orders`, expected.orders, actual.orders, 0, failures);
    compareNumber(`${key} exactOrders`, expected.exactOrders, actual.exactOrders, 0, failures);
  }

  return failures;
}

function printOrderSummary(rows) {
  for (const row of rows) {
    const grossProfitPct = row.exactRevenue ? (row.exactGrossProfit / row.exactRevenue) * 100 : 0;
    console.log([
      `[check-ads-business-views] orders/${row.market.toUpperCase()}`,
      `orders=${formatNumber(row.orders)}`,
      `exact=${formatNumber(row.exactOrders)}`,
      `revenue=${formatCurrency(row.revenue)}`,
      `shipping_revenue=${formatCurrency(row.shippingRevenue)}`,
      `gross_profit=${formatCurrency(row.exactGrossProfit)}`,
      `gross_profit_pct=${formatPercent(grossProfitPct)}`,
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
  const requireViews = process.env.ADS_BUSINESS_VIEWS_REQUIRE !== '0';

  const adFilters = {
    date: [`gte.${from}`, `lte.${to}`],
    level: `eq.${CAMPAIGN_LEVEL}`,
    provider: `in.(${providers.join(',')})`,
  };
  const viewFilters = {
    date: [`gte.${from}`, `lte.${to}`],
  };
  if (marketFilter) {
    const markets = Array.from(marketFilter).join(',');
    adFilters.market = `in.(${markets})`;
    viewFilters.market = `in.(${markets})`;
  }

  const orderFilters = {
    order_date: [`gte.${from}T00:00:00`, `lte.${to}T23:59:59`],
  };

  console.log(`[check-ads-business-views] Range: ${from} -> ${to}`);
  console.log(`[check-ads-business-views] Providers: ${providers.join(', ')}`);

  const [adRows, sourceOrderRowsRaw, purchasePriceRows, orderView, providerBusinessView, totalBusinessView] = await Promise.all([
    fetchAllRowsWithRange({
      supabaseUrl,
      serviceRoleKey,
      table: 'ad_metrics_daily',
      select: 'date,provider,market,level,spend_czk,impressions,clicks,interactions,conversions,conversion_value_czk',
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
    fetchViewRows({
      supabaseUrl,
      serviceRoleKey,
      table: 'order_business_daily_summary',
      select: 'date,market,orders,exact_orders,missing_cost_orders,missing_cost_items,revenue_czk,shipping_revenue_czk,exact_revenue_czk,exact_cost_czk,exact_gross_profit_czk',
      filters: viewFilters,
      orderBy: 'date.asc',
    }),
    fetchViewRows({
      supabaseUrl,
      serviceRoleKey,
      table: 'marketing_business_provider_daily_summary',
      select: 'date,market,provider,spend_czk,impressions,clicks,interactions,conversions,conversion_value_czk,orders,exact_orders,missing_cost_orders,real_revenue_czk,shipping_revenue_czk,exact_revenue_czk,exact_cost_czk,exact_gross_profit_czk,gross_profit_after_ads_czk,pno,real_roas',
      filters: {
        ...viewFilters,
        provider: `in.(${providers.join(',')})`,
      },
      orderBy: 'date.asc',
    }),
    fetchViewRows({
      supabaseUrl,
      serviceRoleKey,
      table: 'marketing_business_daily_total',
      select: 'date,market,spend_czk,impressions,clicks,interactions,conversions,conversion_value_czk,orders,exact_orders,missing_cost_orders,real_revenue_czk,shipping_revenue_czk,exact_revenue_czk,exact_cost_czk,exact_gross_profit_czk,gross_profit_after_ads_czk,pno,real_roas',
      filters: viewFilters,
      orderBy: 'date.asc',
    }),
  ]);
  const purchasePriceLookup = buildPurchasePriceLookup(purchasePriceRows);
  const sourceOrderRows = attachPurchasePriceLookup(sourceOrderRowsRaw, purchasePriceLookup);

  const views = [orderView, providerBusinessView, totalBusinessView];
  const missing = views.filter((view) => view.missing);
  if (missing.length) {
    console.warn(`[check-ads-business-views] Missing view(s): ${missing.map((view) => view.table).join(', ')}`);
    console.warn('[check-ads-business-views] Apply supabase/ad_business_analytics_views.sql in Supabase, then rerun this check.');
    if (requireViews) throw new Error(`Required business view(s) missing: ${missing.map((view) => view.table).join(', ')}`);
    return;
  }

  const { rows: expectedOrderDaily, stats } = buildOrderDaily(sourceOrderRows, fxRates, from, to, marketFilter);
  const { providerRows: expectedProviderAdDaily, totalRows: expectedTotalAdDaily } = buildAdDaily(adRows);
  const expectedOrdersByMarket = aggregateOrderByMarket(expectedOrderDaily);
  const actualOrdersByMarket = aggregateOrderByMarket(orderView.rows);
  const expectedProviderBusiness = expectedBusinessRows({
    adRows: expectedProviderAdDaily,
    orderRows: expectedOrderDaily,
    keyFields: ['market', 'provider'],
  });
  const actualProviderBusiness = aggregateBusinessRows(providerBusinessView.rows, ['market', 'provider']);
  const expectedTotalBusiness = expectedBusinessRows({
    adRows: expectedTotalAdDaily,
    orderRows: expectedOrderDaily,
    keyFields: ['market'],
  });
  const actualTotalBusiness = aggregateBusinessRows(totalBusinessView.rows, ['market']);

  console.log([
    '[check-ads-business-views] Orders source',
    `source_rows=${formatNumber(stats.sourceRows)}`,
    `deduped=${formatNumber(stats.deduplicatedRows)}`,
    `duplicates_removed=${formatNumber(stats.duplicateRows)}`,
    `cancelled_removed=${formatNumber(stats.cancelledRows)}`,
  ].join(' | '));
  console.log(`[check-ads-business-views] Ads rows: ${formatNumber(adRows.length)}`);
  printOrderSummary(actualOrdersByMarket);

  const failures = [
    ...compareOrderAggregates(expectedOrdersByMarket, actualOrdersByMarket),
    ...compareBusinessAggregates(expectedProviderBusiness, actualProviderBusiness, ['market', 'provider']),
    ...compareBusinessAggregates(expectedTotalBusiness, actualTotalBusiness, ['market']),
  ];

  if (failures.length) {
    console.error('[check-ads-business-views] Mismatches:');
    for (const failure of failures.slice(0, 20)) console.error(`- ${failure}`);
    if (failures.length > 20) console.error(`- ...and ${failures.length - 20} more`);
    throw new Error(`Business view verification failed with ${failures.length} mismatch(es).`);
  }

  console.log('[check-ads-business-views] Business views match source Ads/order calculations.');
}

main().catch((error) => {
  console.error('[check-ads-business-views] FAILED:', error.message);
  process.exit(1);
});
