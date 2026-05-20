import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

const PROVIDER_LABELS = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
};

const MARKET_LABELS = {
  cz: 'CZ',
  sk: 'SK',
  hu: 'HU',
  ro: 'RO',
  unknown: 'Neznámé',
};

const CURRENCY_RATES = { CZK: 1, EUR: 25.2, HUF: 0.063, RON: 5.1 };

const LEVEL_LABELS = {
  device: 'Zařízení',
  ad_group: 'Ad groups',
  ad: 'Ads',
  keyword: 'Keywords',
  search_term: 'Search terms',
  shopping_product: 'Shopping produkty',
  asset_group: 'Asset groups',
  hour: 'Hodiny',
  conversion_action: 'Konverzní akce',
  audience: 'Meta audience',
  geo: 'Geo',
  placement: 'Meta placement',
};

const EXPECTED_PROVIDERS = ['google_ads', 'meta_ads'];
const DETAIL_COVERAGE_LEVELS = [
  'device',
  'hour',
  'ad_group',
  'ad',
  'keyword',
  'search_term',
  'shopping_product',
  'asset_group',
  'conversion_action',
  'audience',
  'geo',
  'placement',
];
const DETAIL_LEVEL_ROW_LIMIT = 700;
const MAX_CAMPAIGN_SYNC_AGE_MINUTES = 45;

const toNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};

const formatNumber = (value) => Math.round(toNumber(value)).toLocaleString('cs-CZ');
const formatCurrency = (value) => `${formatNumber(value)} Kč`;
const formatPercent = (value) => `${toNumber(value).toFixed(1)} %`;
const formatRatio = (value) => toNumber(value).toFixed(2).replace('.', ',');
const formatDate = (value) => {
  const [, month, day] = String(value || '').split('-');
  return month && day ? `${day}.${month}.` : value;
};
const parseDateKey = (value) => {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
};
const formatDateKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
const inclusiveDayCount = (from, to) => {
  const start = parseDateKey(from);
  const end = parseDateKey(to);
  if (start === null || end === null || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
};
const addDays = (value, days) => {
  const timestamp = parseDateKey(value);
  if (timestamp === null) return null;
  return formatDateKey(timestamp + days * 86_400_000);
};
const previousDateRange = (from, to) => {
  const days = inclusiveDayCount(from, to);
  if (!days) return null;
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(from, -days);
  if (!previousFrom || !previousTo) return null;
  return { from: previousFrom, to: previousTo, days };
};
const formatDateTime = (value) => {
  if (!value) return 'bez času';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' });
};
const syncRunTimestamp = (run) => run?.finished_at || run?.started_at || '';
const syncAgeMinutes = (run) => {
  const timestamp = new Date(syncRunTimestamp(run)).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return Number.POSITIVE_INFINITY;
  return (Date.now() - timestamp) / 60_000;
};
const formatAgeMinutes = (value) => Number.isFinite(value)
  ? `${toNumber(value).toFixed(1).replace('.', ',')} min`
  : 'bez syncu';
const formatSignedPercent = (value) => `${toNumber(value) > 0 ? '+' : ''}${toNumber(value).toFixed(1)} %`;
const formatSignedPercentagePoints = (value) => `${toNumber(value) > 0 ? '+' : ''}${toNumber(value).toFixed(1)} p. b.`;
const relativeChange = (current, previous) => {
  const prev = toNumber(previous);
  if (!prev) return null;
  return ((toNumber(current) - prev) / Math.abs(prev)) * 100;
};
const formatRelativeChange = (current, previous) => {
  const change = relativeChange(current, previous);
  return change === null ? 'bez srovnání' : formatSignedPercent(change);
};
const isMissingViewError = (error) => {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /PGRST205|PGRST204|schema cache|could not find|relation .* does not exist/i.test(text);
};
const syncTypeLevels = (syncType) => {
  const [, rawLevels = ''] = String(syncType || '').split(':');
  return rawLevels.split(',').map((level) => level.trim()).filter(Boolean);
};
const isDeepDetailRun = (run) => (
  String(run?.sync_type || '').startsWith('detail:') &&
  syncTypeLevels(run.sync_type).some((level) => level !== 'campaign')
);
const isCampaignSyncRun = (run) => syncTypeLevels(run?.sync_type).includes('campaign');

const emptyMetrics = () => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  interactions: 0,
  conversions: 0,
  conversionValue: 0,
});

const emptyOrderMetrics = () => ({
  orders: 0,
  exactOrders: 0,
  revenue: 0,
  exactRevenue: 0,
  exactCost: 0,
  exactGrossProfit: 0,
  missingCostOrders: 0,
});

const addMetrics = (target, row) => {
  target.spend += toNumber(row.spend_czk);
  target.impressions += toNumber(row.impressions);
  target.clicks += toNumber(row.clicks);
  target.interactions += toNumber(row.interactions);
  target.conversions += toNumber(row.conversions);
  target.conversionValue += toNumber(row.conversion_value_czk);
};

const enrichMetrics = (metrics) => ({
  ...metrics,
  ctr: metrics.impressions ? (metrics.clicks / metrics.impressions) * 100 : 0,
  cpc: metrics.clicks ? metrics.spend / metrics.clicks : 0,
  cpm: metrics.impressions ? (metrics.spend / metrics.impressions) * 1000 : 0,
  roas: metrics.spend ? metrics.conversionValue / metrics.spend : 0,
  aov: metrics.conversions ? metrics.conversionValue / metrics.conversions : 0,
  costPerConversion: metrics.conversions ? metrics.spend / metrics.conversions : 0,
});

const getOrderCurrency = (order) => order.currency || order.raw_data?.currency_id || 'CZK';
const getOrderMarket = (order) => (order.market || order.raw_data?.language_id || 'unknown').toLowerCase();
const getOrderDateKey = (order) => String(order.order_date || order.created_at || '').slice(0, 10);

function addOrderMetrics(target, order) {
  const products = Array.isArray(order.raw_data?.products) ? order.raw_data.products : [];
  const rate = CURRENCY_RATES[getOrderCurrency(order)] || 1;
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
    target.exactRevenue += revenueCzk;
    target.exactCost += costCzk;
    target.exactGrossProfit += revenueCzk - costCzk;
  } else if (products.length) {
    target.missingCostOrders += 1;
  }
}

function aggregateOrders(orders) {
  return orders.reduce((acc, order) => {
    addOrderMetrics(acc, order);
    return acc;
  }, emptyOrderMetrics());
}

function aggregateOrdersByDate(orders) {
  const byDate = new Map();
  for (const order of orders) {
    const date = getOrderDateKey(order);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, { date, ...emptyOrderMetrics() });
    addOrderMetrics(byDate.get(date), order);
  }
  return byDate;
}

function aggregateOrdersByMarket(orders) {
  const byMarket = new Map();
  for (const order of orders) {
    const market = getOrderMarket(order);
    if (!byMarket.has(market)) byMarket.set(market, { market, ...emptyOrderMetrics() });
    addOrderMetrics(byMarket.get(market), order);
  }
  return byMarket;
}

function orderMetricsFromBusinessRows(rows) {
  return rows.reduce((acc, row) => {
    acc.orders += toNumber(row.orders);
    acc.exactOrders += toNumber(row.exact_orders);
    acc.revenue += toNumber(row.real_revenue_czk);
    acc.exactRevenue += toNumber(row.exact_revenue_czk);
    acc.exactCost += toNumber(row.exact_cost_czk);
    acc.exactGrossProfit += toNumber(row.exact_gross_profit_czk);
    acc.missingCostOrders += toNumber(row.missing_cost_orders);
    return acc;
  }, emptyOrderMetrics());
}

const metricSummary = (rows) => enrichMetrics(rows.reduce((acc, row) => {
  addMetrics(acc, row);
  return acc;
}, emptyMetrics()));

const providerLabel = (provider) => PROVIDER_LABELS[provider] || provider || 'Neznámý zdroj';
const marketLabel = (market) => MARKET_LABELS[market] || String(market || '').toUpperCase();

function aggregateCampaigns(rows, campaignMeta) {
  const byKey = new Map();

  for (const row of rows) {
    const key = `${row.provider}:${row.account_id}:${row.campaign_id}`;
    if (!byKey.has(key)) {
      const meta = campaignMeta.get(key) || {};
      byKey.set(key, {
        key,
        provider: row.provider,
        market: row.market,
        accountName: row.account_name,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name || meta.campaign_name || 'Bez názvu kampaně',
        status: meta.status || null,
        servingStatus: meta.serving_status || null,
        channelType: meta.channel_type || null,
        channelSubType: meta.channel_sub_type || null,
        biddingStrategyType: meta.bidding_strategy_type || null,
        budget: toNumber(meta.budget_amount_native),
        currency: row.currency || meta.currency || 'CZK',
        ...emptyMetrics(),
      });
    }
    addMetrics(byKey.get(key), row);
  }

  return Array.from(byKey.values())
    .map(enrichMetrics)
    .sort((a, b) => b.spend - a.spend);
}

function aggregateDaily(rows, orderByDate) {
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, { date: row.date, label: formatDate(row.date), ...emptyMetrics() });
    }
    addMetrics(byDate.get(row.date), row);
  }

  return Array.from(byDate.values())
    .map((row) => {
      const enriched = enrichMetrics(row);
      const orders = orderByDate.get(row.date) || emptyOrderMetrics();
      return {
        ...enriched,
        realRevenue: orders.revenue,
        exactGrossProfit: orders.exactGrossProfit,
        grossProfitAfterAds: orders.exactGrossProfit - enriched.spend,
        realRoas: enriched.spend ? orders.revenue / enriched.spend : 0,
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function aggregateDailyFromBusinessRows(rows) {
  return rows
    .map((row) => {
      const enriched = enrichMetrics({
        date: row.date,
        label: formatDate(row.date),
        spend: toNumber(row.spend_czk),
        impressions: toNumber(row.impressions),
        clicks: toNumber(row.clicks),
        interactions: toNumber(row.interactions),
        conversions: toNumber(row.conversions),
        conversionValue: toNumber(row.conversion_value_czk),
      });
      return {
        ...enriched,
        realRevenue: toNumber(row.real_revenue_czk),
        exactGrossProfit: toNumber(row.exact_gross_profit_czk),
        grossProfitAfterAds: toNumber(row.gross_profit_after_ads_czk),
        realRoas: enriched.spend ? toNumber(row.real_revenue_czk) / enriched.spend : 0,
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function aggregateMarkets(rows, orderByMarket, dateFrom, dateTo) {
  const byKey = new Map();
  const expectedDays = inclusiveDayCount(dateFrom, dateTo);
  for (const row of rows) {
    const key = `${row.provider}:${row.market}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        provider: row.provider,
        market: row.market,
        dates: new Set(),
        firstDate: null,
        lastDate: null,
        expectedDays,
        ...emptyMetrics(),
      });
    }
    const target = byKey.get(key);
    if (row.date) {
      target.dates.add(row.date);
      target.firstDate = !target.firstDate || row.date < target.firstDate ? row.date : target.firstDate;
      target.lastDate = !target.lastDate || row.date > target.lastDate ? row.date : target.lastDate;
    }
    addMetrics(target, row);
  }

  return Array.from(byKey.values())
    .map((row) => {
      const enriched = enrichMetrics(row);
      const orders = orderByMarket.get(row.market) || emptyOrderMetrics();
      const days = row.dates.size;
      return {
        ...enriched,
        days,
        coveragePct: expectedDays ? (days / expectedDays) * 100 : 0,
        realRevenue: orders.revenue,
        exactGrossProfit: orders.exactGrossProfit,
        grossProfitAfterAds: orders.exactGrossProfit - enriched.spend,
        realRoas: enriched.spend ? orders.revenue / enriched.spend : 0,
        pno: orders.revenue ? (enriched.spend / orders.revenue) * 100 : 0,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

function aggregateMarketsFromBusinessRows(rows, dateFrom, dateTo) {
  const byKey = new Map();
  const expectedDays = inclusiveDayCount(dateFrom, dateTo);
  for (const row of rows) {
    const key = `${row.provider}:${row.market}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        provider: row.provider,
        market: row.market,
        dates: new Set(),
        firstDate: null,
        lastDate: null,
        expectedDays,
        ...emptyMetrics(),
        realRevenue: 0,
        exactGrossProfit: 0,
      });
    }
    const target = byKey.get(key);
    if (row.date) {
      target.dates.add(row.date);
      target.firstDate = !target.firstDate || row.date < target.firstDate ? row.date : target.firstDate;
      target.lastDate = !target.lastDate || row.date > target.lastDate ? row.date : target.lastDate;
    }
    addMetrics(target, row);
    target.realRevenue += toNumber(row.real_revenue_czk);
    target.exactGrossProfit += toNumber(row.exact_gross_profit_czk);
  }

  return Array.from(byKey.values())
    .map((row) => {
      const enriched = enrichMetrics(row);
      const days = row.dates.size;
      return {
        ...enriched,
        days,
        coveragePct: expectedDays ? (days / expectedDays) * 100 : 0,
        grossProfitAfterAds: row.exactGrossProfit - enriched.spend,
        realRoas: enriched.spend ? row.realRevenue / enriched.spend : 0,
        pno: row.realRevenue ? (enriched.spend / row.realRevenue) * 100 : 0,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

function aggregateAdMarkets(rows, dateFrom, dateTo) {
  const byKey = new Map();
  const expectedDays = inclusiveDayCount(dateFrom, dateTo);
  for (const row of rows) {
    const key = `${row.provider}:${row.market}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        provider: row.provider,
        market: row.market,
        dates: new Set(),
        firstDate: null,
        lastDate: null,
        expectedDays,
        ...emptyMetrics(),
      });
    }
    const target = byKey.get(key);
    if (row.date) {
      target.dates.add(row.date);
      target.firstDate = !target.firstDate || row.date < target.firstDate ? row.date : target.firstDate;
      target.lastDate = !target.lastDate || row.date > target.lastDate ? row.date : target.lastDate;
    }
    addMetrics(target, row);
  }

  return Array.from(byKey.values())
    .map((row) => {
      const enriched = enrichMetrics(row);
      const days = row.dates.size;
      return {
        ...enriched,
        days,
        coveragePct: expectedDays ? (days / expectedDays) * 100 : 0,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

function formatGeoTarget(value, prefix) {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value);
  const match = text.match(/geoTargetConstants\/(\d+)/i);
  if (/^\d+$/.test(text)) return `${prefix} ${text}`;
  return match ? `${prefix} ${match[1]}` : text;
}

function geoDetailLabel(dimensions) {
  const candidates = [
    ['Lokace', dimensions.geo_target_most_specific_location],
    ['Město', dimensions.geo_target_city],
    ['Region', dimensions.geo_target_region],
    ['Země', dimensions.geo_target_country || dimensions.country || dimensions.country_criterion_id],
  ];
  const [prefix, value] = candidates.find(([, value]) => value !== null && value !== undefined && value !== '') || [];
  return value ? formatGeoTarget(value, prefix) : '(bez geo)';
}

function geoDetailSubLabel(dimensions) {
  const locationMode = dimensions.targeting_location !== null && dimensions.targeting_location !== undefined
    ? (dimensions.targeting_location ? 'targetovaná lokace' : 'uživatelská lokace')
    : null;
  const country = dimensions.country_criterion_id ? formatGeoTarget(dimensions.country_criterion_id, 'země') : null;
  return [locationMode, country].filter(Boolean).join(' · ') || null;
}

function aggregateDetails(rows, level) {
  const byKey = new Map();
  const levelRows = rows.filter((row) => row.level === level);

  for (const row of levelRows) {
    const dimensions = row.dimensions || {};
    const keyValue = [
      dimensions.search_term,
      dimensions.keyword_text,
      dimensions.product_item_id,
      dimensions.product_title,
      dimensions.publisher_platform,
      dimensions.platform_position,
      dimensions.impression_device,
      dimensions.device,
      dimensions.age,
      dimensions.gender,
      dimensions.country,
      dimensions.geo_target_most_specific_location,
      dimensions.geo_target_city,
      dimensions.geo_target_region,
      dimensions.geo_target_country,
      dimensions.country_criterion_id,
      dimensions.ad_id,
      dimensions.ad_group_id,
      dimensions.asset_group_id,
      dimensions.conversion_action,
      dimensions.hour,
      dimensions.asset_group_name,
    ].find((value) => value !== null && value !== undefined && value !== '');

    const key = `${row.provider}:${row.market}:${level}:${keyValue || 'unknown'}`;
    if (!byKey.has(key)) {
      const label = level === 'search_term'
        ? dimensions.search_term || '(bez search termu)'
        : level === 'keyword'
          ? dimensions.keyword_text || '(bez keywordu)'
          : level === 'shopping_product'
            ? dimensions.product_title || dimensions.product_item_id || '(bez produktu)'
            : level === 'asset_group'
              ? dimensions.asset_group_name || '(bez asset group)'
              : level === 'audience'
                ? [dimensions.age, dimensions.gender].filter(Boolean).join(' / ') || '(bez audience)'
                : level === 'geo'
                  ? geoDetailLabel(dimensions)
                : level === 'placement'
                  ? [dimensions.publisher_platform, dimensions.platform_position, dimensions.impression_device].filter(Boolean).join(' / ') || '(bez placementu)'
                  : level === 'device'
                    ? dimensions.device || dimensions.impression_device || '(bez zařízení)'
              : level === 'ad'
                ? dimensions.ad_name || dimensions.ad_id || '(bez reklamy)'
                : level === 'ad_group'
                  ? dimensions.ad_group_name || dimensions.ad_group_id || '(bez sestavy)'
                  : level === 'hour'
                    ? `${String(dimensions.hour ?? '').padStart(2, '0')}:00`
                    : level === 'conversion_action'
                      ? dimensions.conversion_action_name || dimensions.conversion_action || '(bez konverzní akce)'
                      : keyValue || '(bez detailu)';

      const subLabel = level === 'shopping_product'
        ? dimensions.product_item_id
        : level === 'keyword'
          ? dimensions.match_type
          : level === 'search_term'
            ? dimensions.match_type
            : level === 'ad'
              ? dimensions.ad_type || dimensions.ad_status
              : level === 'ad_group'
                ? dimensions.ad_group_type || dimensions.ad_group_status
                : level === 'geo'
                  ? geoDetailSubLabel(dimensions)
                  : level === 'placement'
                    ? dimensions.publisher_platform
                    : level === 'device'
                      ? [dimensions.publisher_platform, dimensions.platform_position].filter(Boolean).join(' / ') || null
                    : null;

      byKey.set(key, {
        key,
        level,
        provider: row.provider,
        market: row.market,
        campaignName: row.campaign_name,
        label,
        subLabel,
        ...emptyMetrics(),
      });
    }
    addMetrics(byKey.get(key), row);
  }

  return Array.from(byKey.values())
    .map(enrichMetrics)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 12);
}

function finiteCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function aggregateProviderCoverage(campaignRows, detailRows, syncRuns, dateFrom, dateTo, detailCountByProvider = {}) {
  const expectedDays = inclusiveDayCount(dateFrom, dateTo);
  const byProvider = new Map(EXPECTED_PROVIDERS.map((provider) => [provider, {
    provider,
    campaignRows: 0,
    detailRows: 0,
    dates: new Set(),
    expectedDays,
    lastDataDate: null,
    latestRun: null,
    latestCampaignRun: null,
    latestDeepDetailRun: null,
    ...emptyMetrics(),
  }]));

  for (const row of campaignRows) {
    const target = byProvider.get(row.provider) || {
      provider: row.provider,
      campaignRows: 0,
      detailRows: 0,
      dates: new Set(),
      expectedDays,
      lastDataDate: null,
      latestRun: null,
      latestCampaignRun: null,
      latestDeepDetailRun: null,
      ...emptyMetrics(),
    };
    target.campaignRows += 1;
    if (row.date) {
      target.dates.add(row.date);
      target.lastDataDate = !target.lastDataDate || row.date > target.lastDataDate ? row.date : target.lastDataDate;
    }
    addMetrics(target, row);
    byProvider.set(row.provider, target);
  }

  for (const row of detailRows) {
    const target = byProvider.get(row.provider) || {
      provider: row.provider,
      campaignRows: 0,
      detailRows: 0,
      dates: new Set(),
      expectedDays,
      lastDataDate: null,
      latestRun: null,
      latestCampaignRun: null,
      latestDeepDetailRun: null,
      ...emptyMetrics(),
    };
    target.detailRows += 1;
    byProvider.set(row.provider, target);
  }

  for (const run of syncRuns) {
    const target = byProvider.get(run.provider);
    if (!target) continue;
    if (!target.latestRun) target.latestRun = run;
    if (!target.latestCampaignRun && isCampaignSyncRun(run)) target.latestCampaignRun = run;
    if (!target.latestDeepDetailRun && isDeepDetailRun(run)) target.latestDeepDetailRun = run;
  }

  return Array.from(byProvider.values()).map((row) => ({
    ...row,
    detailRowsExact: finiteCount(detailCountByProvider[row.provider]),
  })).map((row) => {
    const enriched = enrichMetrics(row);
    const detailRowsLoaded = row.detailRows;
    const detailRowsTotal = row.detailRowsExact ?? detailRowsLoaded;
    return {
      ...enriched,
      detailRows: detailRowsTotal,
      detailRowsLoaded,
      hasExactDetailCount: row.detailRowsExact !== null,
      days: row.dates.size,
      coveragePct: expectedDays ? (row.dates.size / expectedDays) * 100 : 0,
      hasData: row.campaignRows > 0 || row.spend > 0,
      hasDeepDetail: detailRowsTotal > 0 || Boolean(row.latestDeepDetailRun),
    };
  });
}

function aggregateDetailCoverage(rows, detailCountByLevel = {}) {
  const byLevel = new Map(DETAIL_COVERAGE_LEVELS.map((level) => [level, {
    level,
    rows: 0,
    ...emptyMetrics(),
  }]));

  for (const row of rows) {
    const target = byLevel.get(row.level);
    if (!target) continue;
    target.rows += 1;
    addMetrics(target, row);
  }

  return Array.from(byLevel.values()).map((row) => {
    const enriched = enrichMetrics(row);
    const loadedRows = row.rows;
    const exactRows = finiteCount(detailCountByLevel[row.level]);
    return {
      ...enriched,
      loadedRows,
      rows: exactRows ?? loadedRows,
      hasExactCount: exactRows !== null,
    };
  });
}

function insight({ severity = 'info', title, finding, evidence, recommendation, confidence = 'střední' }) {
  return { severity, title, finding, evidence, recommendation, confidence };
}

function comparisonMetric({ label, current, previous, formatter = formatNumber }) {
  return {
    label,
    current,
    previous,
    changePct: relativeChange(current, previous),
    currentLabel: formatter(current),
    previousLabel: formatter(previous),
  };
}

function buildPeriodComparison({ currentRange, previousRange, currentTotal, previousTotal, currentMarkets, previousMarkets, currentCampaigns, previousCampaigns }) {
  const previousHasData = previousTotal.spend > 0 || previousTotal.conversionValue > 0 || previousTotal.clicks > 0;
  const summary = [
    comparisonMetric({ label: 'Spend', current: currentTotal.spend, previous: previousTotal.spend, formatter: formatCurrency }),
    comparisonMetric({ label: 'Konv. hodnota', current: currentTotal.conversionValue, previous: previousTotal.conversionValue, formatter: formatCurrency }),
    comparisonMetric({ label: 'Platform AOV', current: currentTotal.aov, previous: previousTotal.aov, formatter: formatCurrency }),
    comparisonMetric({ label: 'ROAS', current: currentTotal.roas, previous: previousTotal.roas, formatter: formatRatio }),
  ];
  const signals = [];

  if (!previousRange || !previousHasData) {
    return {
      currentRange,
      previousRange,
      previousHasData,
      summary,
      signals: [
        insight({
          severity: 'info',
          title: 'Předchozí období nemá Ads data',
          finding: 'Pro stejné předchozí období zatím nejsou v Supabase campaign Ads řádky, takže trendové srovnání není použitelné.',
          evidence: previousRange
            ? `Předchozí období ${previousRange.from} až ${previousRange.to}: spend ${formatCurrency(previousTotal.spend)}, řádky se spendem nejsou k dispozici.`
            : 'Datumový filtr nejde převést na předchozí stejně dlouhé období.',
          recommendation: 'Použít kratší filtr s pokrytými daty, nebo počkat na historický backfill pro dané období.',
          confidence: 'vysoká',
        }),
      ],
    };
  }

  const spendChange = relativeChange(currentTotal.spend, previousTotal.spend);
  const valueChange = relativeChange(currentTotal.conversionValue, previousTotal.conversionValue);
  const aovChange = relativeChange(currentTotal.aov, previousTotal.aov);
  const roasChange = relativeChange(currentTotal.roas, previousTotal.roas);

  if (aovChange !== null && aovChange < -15 && currentTotal.conversions >= 5) {
    signals.push(insight({
      severity: 'warning',
      title: 'Platform AOV proti předchozímu období klesá',
      finding: 'Reklamní konverze mají nižší průměrnou hodnotu než ve stejně dlouhém předchozím období.',
      evidence: `AOV ${formatCurrency(previousTotal.aov)} → ${formatCurrency(currentTotal.aov)} (${formatSignedPercent(aovChange)}), konverze ${formatNumber(previousTotal.conversions)} → ${formatNumber(currentTotal.conversions)}.`,
      recommendation: 'Hledat posun v kampaních, search terms, produktech a zemích, které začaly nosit levnější objednávky.',
      confidence: 'střední',
    }));
  }

  if (spendChange !== null && valueChange !== null && spendChange > 20 && valueChange < spendChange * 0.4) {
    signals.push(insight({
      severity: 'warning',
      title: 'Spend roste rychleji než hodnota konverzí',
      finding: 'Náklady proti předchozímu období rostou, ale platformní hodnota konverzí neroste stejným tempem.',
      evidence: `Spend ${formatCurrency(previousTotal.spend)} → ${formatCurrency(currentTotal.spend)} (${formatSignedPercent(spendChange)}), konv. hodnota ${formatCurrency(previousTotal.conversionValue)} → ${formatCurrency(currentTotal.conversionValue)} (${formatSignedPercent(valueChange)}).`,
      recommendation: 'Nejprve projít kampaně s největším nárůstem spendu a zkontrolovat, jestli nepřinášejí nízký AOV nebo horší ROAS.',
      confidence: 'střední',
    }));
  }

  if (roasChange !== null && roasChange < -20 && currentTotal.spend >= previousTotal.spend * 0.7) {
    signals.push(insight({
      severity: 'warning',
      title: 'ROAS se proti předchozímu období zhoršil',
      finding: 'Při podobném nebo vyšším spendu vychází platformní návratnost výrazně slabší.',
      evidence: `ROAS ${formatRatio(previousTotal.roas)} → ${formatRatio(currentTotal.roas)} (${formatSignedPercent(roasChange)}), spend ${formatCurrency(currentTotal.spend)}.`,
      recommendation: 'Porovnat mix zemí a kampaní, zejména ty s největším nárůstem podílu na spendu.',
      confidence: 'střední',
    }));
  }

  const previousMarketMap = new Map(previousMarkets.map((row) => [row.key, row]));
  const marketShift = currentMarkets
    .map((row) => {
      const previous = previousMarketMap.get(row.key);
      const currentShare = currentTotal.spend ? (row.spend / currentTotal.spend) * 100 : 0;
      const previousShare = previousTotal.spend ? (toNumber(previous?.spend) / previousTotal.spend) * 100 : 0;
      return { row, previous, currentShare, previousShare, shareDelta: currentShare - previousShare };
    })
    .filter((item) => item.row.spend >= Math.max(currentTotal.spend * 0.08, 500))
    .sort((a, b) => b.shareDelta - a.shareDelta)[0];

  if (marketShift && marketShift.shareDelta > 8) {
    signals.push(insight({
      severity: 'info',
      title: `Spend mix se přesunul do ${marketLabel(marketShift.row.market)}`,
      finding: 'Jedna země má výrazně vyšší podíl na spendu než v předchozím období.',
      evidence: `${providerLabel(marketShift.row.provider)} / ${marketLabel(marketShift.row.market)}: podíl spendu ${formatPercent(marketShift.previousShare)} → ${formatPercent(marketShift.currentShare)} (${formatSignedPercentagePoints(marketShift.shareDelta)}), spend ${formatCurrency(marketShift.row.spend)}.`,
      recommendation: 'Porovnat AOV a ROAS této země proti zbytku. Pokud má nižší hodnotu objednávky, může vysvětlovat pokles průměrné objednávky bez nutnosti změny cílení.',
      confidence: 'střední',
    }));
  }

  const previousCampaignMap = new Map(previousCampaigns.map((row) => [row.key, row]));
  const campaignMover = currentCampaigns
    .map((row) => {
      const previous = previousCampaignMap.get(row.key);
      return {
        row,
        previous,
        spendDelta: row.spend - toNumber(previous?.spend),
        spendChange: relativeChange(row.spend, previous?.spend),
        aovChange: relativeChange(row.aov, previous?.aov),
      };
    })
    .filter((item) => item.row.spend >= Math.max(currentTotal.spend * 0.08, 500) && item.spendDelta > 0)
    .sort((a, b) => b.spendDelta - a.spendDelta)[0];

  if (campaignMover) {
    const previousAov = toNumber(campaignMover.previous?.aov);
    const lowAovNow = currentTotal.aov > 0 && campaignMover.row.aov > 0 && campaignMover.row.aov < currentTotal.aov * 0.75;
    const aovFell = campaignMover.aovChange !== null && campaignMover.aovChange < -15;
    if (lowAovNow || aovFell) {
      signals.push(insight({
        severity: 'warning',
        title: 'Kampaň s rostoucím spendem a slabším AOV',
        finding: 'Jedna kampaň dostala proti předchozímu období více rozpočtu a zároveň má nízkou nebo klesající průměrnou hodnotu konverze.',
        evidence: `${campaignMover.row.campaignName}: spend ${formatCurrency(toNumber(campaignMover.previous?.spend))} → ${formatCurrency(campaignMover.row.spend)} (${formatRelativeChange(campaignMover.row.spend, campaignMover.previous?.spend)}), AOV ${previousAov ? formatCurrency(previousAov) : 'bez předchozí hodnoty'} → ${formatCurrency(campaignMover.row.aov)}.`,
        recommendation: 'Tohle je první kandidát na kontrolu search terms a produktového mixu. Pokud nosí levnější položky, oddělit cíle/rozpočet od kampaní, které nosí vysokou hodnotu objednávky.',
        confidence: 'střední',
      }));
    }
  }

  if (!signals.length) {
    signals.push(insight({
      severity: 'good',
      title: 'Proti předchozímu období bez ostrého varování',
      finding: 'Na úrovni campaign spendu nevidím dramatický posun v AOV, ROAS ani mixu zemí.',
      evidence: `Spend ${formatCurrency(previousTotal.spend)} → ${formatCurrency(currentTotal.spend)}, AOV ${formatCurrency(previousTotal.aov)} → ${formatCurrency(currentTotal.aov)}, ROAS ${formatRatio(previousTotal.roas)} → ${formatRatio(currentTotal.roas)}.`,
      recommendation: 'Další vrstva je produkt/search term detail a reálná marže podle objednávek, jakmile budou business views v Supabase.',
      confidence: 'střední',
    }));
  }

  return { currentRange, previousRange, previousHasData, summary, signals: signals.slice(0, 4) };
}

function buildPpcInsights({
  total,
  businessTotal,
  orderTotal,
  markets,
  campaigns,
  topSearchTerms,
  topProducts,
  topDevices,
  topKeywords,
  topAssetGroups,
  topHours,
  topAudiences,
  topGeo,
  topPlacements,
  daily,
  providerCoverage,
}) {
  const insights = [];
  const minSpend = Math.max(total.spend * 0.03, 250);
  const meaningfulCampaignSpend = Math.max(total.spend * 0.08, 500);
  const highSpend = Math.max(total.spend * 0.12, 800);
  const realAov = orderTotal.orders ? businessTotal.realRevenue / orderTotal.orders : 0;
  const referenceAov = realAov || total.aov;
  const lowAovThreshold = referenceAov ? referenceAov * 0.7 : 0;

  if (total.spend <= 0) {
    return [
      insight({
        severity: 'warning',
        title: 'Bez Ads spendu ve filtru',
        finding: 'Pro vybrané období nevidím žádné náklady z reklam.',
        evidence: `Filtr obsahuje ${formatCurrency(businessTotal.realRevenue)} tržeb a ${formatNumber(orderTotal.orders)} objednávek, ale Ads spend je ${formatCurrency(total.spend)}.`,
        recommendation: 'Ověřit rozsah data/země a poslední sync. Pokud je filtr správně, toto období není použitelné pro PPC vyhodnocení.',
        confidence: 'vysoká',
      }),
    ];
  }

  const partialMarketCoverage = markets
    .filter((row) => row.spend > 0 && row.expectedDays > 1 && row.coveragePct > 0 && row.coveragePct < 95)
    .sort((a, b) => a.coveragePct - b.coveragePct || b.spend - a.spend);
  if (partialMarketCoverage.length) {
    insights.push(insight({
      severity: 'warning',
      title: 'Historické Ads pokrytí je částečné',
      finding: 'Některé země mají ve vybraném období reklamní spend jen pro část dní, takže PNO/ROAS je potřeba číst jako pokrytý výsek, ne jako kompletní historii trhu.',
      evidence: partialMarketCoverage
        .slice(0, 3)
        .map((row) => {
          const range = row.firstDate && row.lastDate ? `, data ${row.firstDate} až ${row.lastDate}` : '';
          return `${providerLabel(row.provider)} / ${marketLabel(row.market)}: ${formatNumber(row.days)}/${formatNumber(row.expectedDays)} dnů (${formatPercent(row.coveragePct)}${range})`;
        })
        .join('; '),
      recommendation: 'Pro férové srovnání trendu porovnávat období, kde je Ads pokrytí podobné. U YTD filtrů brát částečné trhy odděleně nebo filtrovat jen období od prvního kompletního syncu.',
      confidence: 'vysoká',
    }));
  }

  const metaCoverage = providerCoverage.find((row) => row.provider === 'meta_ads');
  const googleCoverage = providerCoverage.find((row) => row.provider === 'google_ads');
  if (googleCoverage?.hasData && metaCoverage && !metaCoverage.hasData) {
    insights.push(insight({
      severity: 'info',
      title: 'Meta Ads zatím nejsou v datech',
      finding: 'Aktuální marketingový přehled počítá placená média z Google Ads; Meta Ads ve vybraném filtru zatím nemají campaign řádky.',
      evidence: `Google Ads: ${formatCurrency(googleCoverage.spend)} spendu a ${formatNumber(googleCoverage.campaignRows)} campaign řádků. Meta Ads: ${formatNumber(metaCoverage.campaignRows)} campaign řádků.`,
      recommendation: 'Po doplnění Meta přístupu spustit campaign sync a denní detailní sync; teprve potom bude celkové PNO zahrnovat i Facebook/Instagram.',
      confidence: 'vysoká',
    }));
  }

  if (businessTotal.grossProfitAfterAds < 0) {
    insights.push(insight({
      severity: 'critical',
      title: 'Reklama snědla celý přesný hrubý zisk',
      finding: 'Po odečtení Ads spendu je vybrané období v záporném hrubém výsledku.',
      evidence: `Přesný hrubý zisk ${formatCurrency(businessTotal.exactGrossProfit)}, spend ${formatCurrency(total.spend)}, zisk po Ads ${formatCurrency(businessTotal.grossProfitAfterAds)}.`,
      recommendation: 'Nejdřív škrtat nebo omezit části s nulovou konverzí a nízkou hodnotou objednávek; škálování řešit až po návratu nad nulu.',
      confidence: 'vysoká',
    }));
  } else if (businessTotal.spendToGrossProfit > 45) {
    insights.push(insight({
      severity: 'warning',
      title: 'Ads berou velkou část hrubého zisku',
      finding: 'Období je ziskové, ale reklama spotřebuje významnou část přesného hrubého zisku.',
      evidence: `Ads vs zisk ${formatPercent(businessTotal.spendToGrossProfit)}, PNO ${formatPercent(businessTotal.pno)}, zisk po Ads ${formatCurrency(businessTotal.grossProfitAfterAds)}.`,
      recommendation: 'Řídit optimalizaci podle zisku po Ads, ne podle platformního ROAS. Při navyšování rozpočtu hlídat PNO a mix produktů.',
      confidence: 'vysoká',
    }));
  } else {
    insights.push(insight({
      severity: 'good',
      title: 'Business výsledek po reklamě drží',
      finding: 'Vybrané období má po odečtení Ads spendu kladný přesný hrubý výsledek.',
      evidence: `Zisk po Ads ${formatCurrency(businessTotal.grossProfitAfterAds)}, Real ROAS ${formatRatio(businessTotal.realRoas)}, PNO ${formatPercent(businessTotal.pno)}.`,
      recommendation: 'Hledat škálovatelná místa podle zemí a kampaní, kde zůstává kladný zisk po Ads a zároveň je dostatečný objem.',
      confidence: 'střední',
    }));
  }

  const platformDelta = businessTotal.realRevenue
    ? ((total.conversionValue - businessTotal.realRevenue) / businessTotal.realRevenue) * 100
    : 0;
  if (Math.abs(platformDelta) > 20) {
    insights.push(insight({
      severity: 'warning',
      title: 'Platformní hodnota se rozchází s realitou objednávek',
      finding: platformDelta > 0
        ? 'Google/Meta reportuje výrazně vyšší konverzní hodnotu než reálné objednávky ve filtru.'
        : 'Google/Meta reportuje výrazně nižší konverzní hodnotu než reálné objednávky ve filtru.',
      evidence: `Platformní hodnota ${formatCurrency(total.conversionValue)}, real tržby ${formatCurrency(businessTotal.realRevenue)}, rozdíl ${formatSignedPercent(platformDelta)}.`,
      recommendation: 'Brát platform ROAS jen jako signál pro optimalizaci v účtu; pro řízení firmy používat Real ROAS, PNO a zisk po Ads.',
      confidence: 'střední',
    }));
  }

  const worstMarket = markets
    .filter((row) => row.spend >= highSpend || row.realRevenue > 0)
    .sort((a, b) => a.grossProfitAfterAds - b.grossProfitAfterAds)[0];
  if (worstMarket && worstMarket.grossProfitAfterAds < 0) {
    insights.push(insight({
      severity: 'critical',
      title: `Nejslabší trh po Ads: ${marketLabel(worstMarket.market)}`,
      finding: 'Jeden trh vychází po započtení reklam záporně.',
      evidence: `${providerLabel(worstMarket.provider)} / ${marketLabel(worstMarket.market)}: spend ${formatCurrency(worstMarket.spend)}, real tržby ${formatCurrency(worstMarket.realRevenue)}, zisk po Ads ${formatCurrency(worstMarket.grossProfitAfterAds)}, PNO ${formatPercent(worstMarket.pno)}.`,
      recommendation: 'V tomto trhu projít kampaně a produktový mix; nepřidávat rozpočet, dokud není jasné, které kampaně nesou nízkou hodnotu objednávky.',
      confidence: 'vysoká',
    }));
  }

  const bestMarket = markets
    .filter((row) => row.spend >= minSpend && row.grossProfitAfterAds > 0)
    .sort((a, b) => b.grossProfitAfterAds - a.grossProfitAfterAds)[0];
  if (bestMarket) {
    insights.push(insight({
      severity: 'good',
      title: `Nejlepší trh po Ads: ${marketLabel(bestMarket.market)}`,
      finding: 'Tady vychází kombinace spendu, tržeb a hrubého zisku nejlépe.',
      evidence: `${providerLabel(bestMarket.provider)} / ${marketLabel(bestMarket.market)}: zisk po Ads ${formatCurrency(bestMarket.grossProfitAfterAds)}, Real ROAS ${formatRatio(bestMarket.realRoas)}, PNO ${formatPercent(bestMarket.pno)}.`,
      recommendation: 'Prověřit, jestli je zde prostor škálovat bez poklesu AOV a marže; ideálně porovnat top produkty a search terms proti slabším trhům.',
      confidence: 'střední',
    }));
  }

  const wasteCampaign = campaigns
    .filter((row) => row.spend >= meaningfulCampaignSpend && row.conversions <= 0)
    .sort((a, b) => b.spend - a.spend)[0];
  if (wasteCampaign) {
    insights.push(insight({
      severity: 'critical',
      title: 'Kampaň utrácí bez konverzí',
      finding: 'Ve vybraném období je vidět kampaň s významným spendem a nulovými konverzemi.',
      evidence: `${wasteCampaign.campaignName}: spend ${formatCurrency(wasteCampaign.spend)}, kliky ${formatNumber(wasteCampaign.clicks)}, konverze ${formatNumber(wasteCampaign.conversions)}.`,
      recommendation: 'Zkontrolovat search terms, produkty a bidding této kampaně. Pokud nejde o krátké učení nebo brand/upper funnel, dát ji do priority pro omezení.',
      confidence: 'vysoká',
    }));
  }

  const lowRoasCampaign = campaigns
    .filter((row) => row.spend >= meaningfulCampaignSpend && row.conversions > 0 && row.roas > 0)
    .sort((a, b) => a.roas - b.roas)[0];
  if (lowRoasCampaign && lowRoasCampaign.roas < Math.max(businessTotal.realRoas * 0.55, 1.2)) {
    insights.push(insight({
      severity: 'warning',
      title: 'Kampaň táhne efektivitu dolů',
      finding: 'Jedna z utrácejících kampaní má výrazně horší ROAS než celek.',
      evidence: `${lowRoasCampaign.campaignName}: ROAS ${formatRatio(lowRoasCampaign.roas)}, spend ${formatCurrency(lowRoasCampaign.spend)}, AOV ${formatCurrency(lowRoasCampaign.aov)}; celek Real ROAS ${formatRatio(businessTotal.realRoas)}.`,
      recommendation: 'Rozpadnout ji podle produktů/search terms. Pokud nosí levné objednávky, držet ji na cílech podle zisku, ne podle samotného objemu.',
      confidence: 'střední',
    }));
  }

  const lowAovCampaign = campaigns
    .filter((row) => (
      referenceAov > 0 &&
      row.spend >= meaningfulCampaignSpend &&
      row.conversions >= 2 &&
      row.aov > 0 &&
      row.aov < lowAovThreshold
    ))
    .sort((a, b) => b.spend - a.spend || a.aov - b.aov)[0];
  if (lowAovCampaign) {
    insights.push(insight({
      severity: 'warning',
      title: 'Kampaň nosí nízkou hodnotu objednávky',
      finding: 'Jedna z významně utrácejících kampaní má platformní AOV výrazně pod reálným průměrem objednávek ve filtru.',
      evidence: `${lowAovCampaign.campaignName}: AOV ${formatCurrency(lowAovCampaign.aov)}, spend ${formatCurrency(lowAovCampaign.spend)}, konverze ${formatNumber(lowAovCampaign.conversions)}; referenční AOV ${formatCurrency(referenceAov)}.`,
      recommendation: 'Rozpadnout kampaň podle produktů, search terms a zařízení. Pokud nese hlavně levné položky, oddělit ji do samostatného rozpočtu nebo upravit produktový/bidding mix.',
      confidence: 'střední',
    }));
  }

  const bestCampaign = campaigns
    .filter((row) => row.spend >= meaningfulCampaignSpend && row.roas >= Math.max(total.roas, 1))
    .sort((a, b) => b.conversionValue - a.conversionValue)[0];
  if (bestCampaign) {
    insights.push(insight({
      severity: 'good',
      title: 'Kandidát na škálování',
      finding: 'Kampaň kombinuje rozumný spend s nadprůměrnou konverzní hodnotou.',
      evidence: `${bestCampaign.campaignName}: ROAS ${formatRatio(bestCampaign.roas)}, konv. hodnota ${formatCurrency(bestCampaign.conversionValue)}, spend ${formatCurrency(bestCampaign.spend)}.`,
      recommendation: 'Před navýšením rozpočtu ověřit, že netahá jen levné položky s nízkou marží. Pokud sedí produktový mix, testovat opatrné navýšení.',
      confidence: 'střední',
    }));
  }

  const wastedSearchTerm = topSearchTerms
    .filter((row) => row.spend >= minSpend && row.conversions <= 0)
    .sort((a, b) => b.spend - a.spend)[0];
  if (wastedSearchTerm) {
    insights.push(insight({
      severity: 'warning',
      title: 'Search term bez návratnosti',
      finding: 'Dotaz utrácí, ale ve vybraném období nepřinesl konverzi.',
      evidence: `"${wastedSearchTerm.label}": spend ${formatCurrency(wastedSearchTerm.spend)}, kliky ${formatNumber(wastedSearchTerm.clicks)}, kampaň ${wastedSearchTerm.campaignName || 'neuvedeno'}.`,
      recommendation: 'Prověřit relevanci dotazu, landing page a negativní klíčová slova. Pokud je mimo nákupní intent, vyloučit nebo oddělit.',
      confidence: 'střední',
    }));
  }

  const lowAovSearchTerm = topSearchTerms
    .filter((row) => (
      referenceAov > 0 &&
      row.spend >= minSpend &&
      row.conversions > 0 &&
      row.aov > 0 &&
      row.aov < lowAovThreshold
    ))
    .sort((a, b) => b.spend - a.spend || a.aov - b.aov)[0];
  if (lowAovSearchTerm) {
    insights.push(insight({
      severity: 'warning',
      title: 'Search term nosí levné objednávky',
      finding: 'Dotaz konvertuje, ale průměrná hodnota konverze je výrazně pod průměrem období.',
      evidence: `"${lowAovSearchTerm.label}": AOV ${formatCurrency(lowAovSearchTerm.aov)}, spend ${formatCurrency(lowAovSearchTerm.spend)}, konverze ${formatNumber(lowAovSearchTerm.conversions)}; reference ${formatCurrency(referenceAov)}.`,
      recommendation: 'Prověřit, jestli dotaz nevede na levný sortiment nebo nevytlačuje hodnotnější query. Podle intentu ho oddělit, zlevnit bidding, nebo doplnit negativy.',
      confidence: 'střední',
    }));
  }

  const weakProduct = topProducts
    .filter((row) => row.spend >= minSpend && row.roas < 1.2)
    .sort((a, b) => b.spend - a.spend)[0];
  if (weakProduct) {
    insights.push(insight({
      severity: 'warning',
      title: 'Produkt se slabou návratností',
      finding: 'Shopping produkt nebo položka feedu má spend, ale nízkou platformní návratnost.',
      evidence: `${weakProduct.label}: spend ${formatCurrency(weakProduct.spend)}, ROAS ${formatRatio(weakProduct.roas)}, konverze ${formatNumber(weakProduct.conversions)}.`,
      recommendation: 'Zkontrolovat cenu po zlevnění, nákupku, feed title a produktovou konkurenceschopnost. Produkt může být zdrojem nízkého AOV.',
      confidence: 'střední',
    }));
  }

  const lowAovProduct = topProducts
    .filter((row) => (
      referenceAov > 0 &&
      row.spend >= minSpend &&
      row.conversions > 0 &&
      row.aov > 0 &&
      row.aov < lowAovThreshold
    ))
    .sort((a, b) => b.spend - a.spend || a.aov - b.aov)[0];
  if (lowAovProduct) {
    insights.push(insight({
      severity: 'warning',
      title: 'Produkt táhne AOV dolů',
      finding: 'Produkt z feedu přináší konverze, ale s výrazně nižší hodnotou než průměr období.',
      evidence: `${lowAovProduct.label}: AOV ${formatCurrency(lowAovProduct.aov)}, spend ${formatCurrency(lowAovProduct.spend)}, ROAS ${formatRatio(lowAovProduct.roas)}, konverze ${formatNumber(lowAovProduct.conversions)}.`,
      recommendation: 'Porovnat cenu po slevách, nákupku a bundlování. Pokud produkt vydělává, držet ho odděleně; pokud jen zvyšuje objem levných objednávek, omezit jeho reklamní tlak.',
      confidence: 'střední',
    }));
  }

  const lowAovDevice = topDevices
    .filter((row) => (
      referenceAov > 0 &&
      row.spend >= minSpend &&
      row.conversions > 0 &&
      row.aov > 0 &&
      row.aov < lowAovThreshold
    ))
    .sort((a, b) => b.spend - a.spend || a.aov - b.aov)[0];
  if (lowAovDevice) {
    insights.push(insight({
      severity: 'info',
      title: 'Zařízení s nízkým AOV',
      finding: 'Jedno zařízení má znatelně nižší platformní hodnotu objednávky než průměr období.',
      evidence: `${lowAovDevice.label}: AOV ${formatCurrency(lowAovDevice.aov)}, spend ${formatCurrency(lowAovDevice.spend)}, ROAS ${formatRatio(lowAovDevice.roas)}, konverze ${formatNumber(lowAovDevice.conversions)}.`,
      recommendation: 'Nedělat okamžitou bid úpravu podle jedné periody; nejdřív porovnat device mix po zemích a kampaních. Pokud se vzor opakuje, řešit oddělené vyhodnocení mobil/desktop.',
      confidence: 'nižší',
    }));
  }

  const weakKeyword = topKeywords
    .filter((row) => row.spend >= minSpend && row.conversions <= 0)
    .sort((a, b) => b.spend - a.spend)[0];
  if (weakKeyword) {
    insights.push(insight({
      severity: 'info',
      title: 'Keyword ke kontrole',
      finding: 'Klíčové slovo má spend bez konverzí ve vybraném období.',
      evidence: `${weakKeyword.label}: spend ${formatCurrency(weakKeyword.spend)}, match ${weakKeyword.subLabel || 'neuvedeno'}, kampaň ${weakKeyword.campaignName || 'neuvedeno'}.`,
      recommendation: 'Porovnat s reálnými search terms. Pokud query driftuje, zpřísnit match nebo přidat negativy.',
      confidence: 'nižší',
    }));
  }

  const pmaxSignal = topAssetGroups
    .filter((row) => row.spend >= minSpend)
    .sort((a, b) => b.spend - a.spend)[0];
  if (pmaxSignal && pmaxSignal.roas < Math.max(total.roas * 0.6, 1)) {
    insights.push(insight({
      severity: 'warning',
      title: 'PMax asset group potřebuje kontrolu',
      finding: 'Asset group s významným spendem má slabší návratnost než celek.',
      evidence: `${pmaxSignal.label}: spend ${formatCurrency(pmaxSignal.spend)}, ROAS ${formatRatio(pmaxSignal.roas)}, konverze ${formatNumber(pmaxSignal.conversions)}.`,
      recommendation: 'Projít produkty a assety v této asset group; u PMax hlídat, jestli netlačí levné/nízkomaržové položky.',
      confidence: 'střední',
    }));
  }

  const bestHour = topHours
    .filter((row) => row.spend >= minSpend && row.roas > 0)
    .sort((a, b) => b.roas - a.roas)[0];
  if (bestHour) {
    insights.push(insight({
      severity: 'info',
      title: 'Hodinový signál',
      finding: 'V hodinovém rozpadu je okno s výrazně lepší návratností.',
      evidence: `${bestHour.label}: ROAS ${formatRatio(bestHour.roas)}, spend ${formatCurrency(bestHour.spend)}, konverze ${formatNumber(bestHour.conversions)}.`,
      recommendation: 'Nepřepínat hned bidding podle jedné periody, ale sledovat opakování vzoru po dnech. Pokud se opakuje, může pomoct dayparting nebo rozpočtová priorita.',
      confidence: 'nižší',
    }));
  }

  const weakAudience = topAudiences
    .filter((row) => row.spend >= minSpend && row.roas < 1.2)
    .sort((a, b) => b.spend - a.spend)[0];
  if (weakAudience) {
    insights.push(insight({
      severity: 'warning',
      title: 'Meta audience se slabou návratností',
      finding: 'Audience segment má spend, ale nízkou platformní návratnost.',
      evidence: `${weakAudience.label}: spend ${formatCurrency(weakAudience.spend)}, ROAS ${formatRatio(weakAudience.roas)}, konverze ${formatNumber(weakAudience.conversions)}.`,
      recommendation: 'Porovnat věk/pohlaví proti produktovému mixu a AOV. Pokud nosí levné objednávky, oddělit cílení nebo upravit rozpočet.',
      confidence: 'střední',
    }));
  }

  const weakPlacement = topPlacements
    .filter((row) => row.spend >= minSpend && row.roas < 1.2)
    .sort((a, b) => b.spend - a.spend)[0];
  if (weakPlacement) {
    insights.push(insight({
      severity: 'warning',
      title: 'Placement ke kontrole',
      finding: 'Meta placement utrácí s nízkou návratností.',
      evidence: `${weakPlacement.label}: spend ${formatCurrency(weakPlacement.spend)}, ROAS ${formatRatio(weakPlacement.roas)}, konverze ${formatNumber(weakPlacement.conversions)}.`,
      recommendation: 'Prověřit, jestli placement nepřivádí levný provoz bez nákupního intentu. U opakovaného vzoru zvážit rozpad nebo omezení.',
      confidence: 'nižší',
    }));
  }

  const weakGeo = topGeo
    .filter((row) => row.spend >= minSpend && row.roas < Math.max(total.roas * 0.5, 1.1))
    .sort((a, b) => b.spend - a.spend)[0];
  if (weakGeo) {
    insights.push(insight({
      severity: 'warning',
      title: 'Geo segment ke kontrole',
      finding: 'Geo segment utrácí s podprůměrnou návratností vůči celku.',
      evidence: `${weakGeo.label}: spend ${formatCurrency(weakGeo.spend)}, ROAS ${formatRatio(weakGeo.roas)}, konverze ${formatNumber(weakGeo.conversions)}.`,
      recommendation: 'Prověřit, jestli sem nejde nízkohodnotný provoz nebo špatný produktový mix. Pokud se vzor opakuje, řešit oddělené vyhodnocení lokace před úpravou rozpočtu.',
      confidence: 'nižší',
    }));
  }

  const strongGeo = topGeo
    .filter((row) => row.spend >= minSpend && row.roas > Math.max(total.roas, 1.5))
    .sort((a, b) => b.conversionValue - a.conversionValue)[0];
  if (strongGeo) {
    insights.push(insight({
      severity: 'info',
      title: 'Geo signál',
      finding: 'V geo rozpadu je segment s nadprůměrnou návratností.',
      evidence: `${strongGeo.label}: ROAS ${formatRatio(strongGeo.roas)}, konv. hodnota ${formatCurrency(strongGeo.conversionValue)}, spend ${formatCurrency(strongGeo.spend)}.`,
      recommendation: 'Sledovat, jestli se geo signál opakuje i v real tržbách a marži. Pak dává smysl řešit rozpočtovou prioritu daného trhu/segmentu.',
      confidence: 'nižší',
    }));
  }

  if (orderTotal.missingCostOrders > 0) {
    insights.push(insight({
      severity: 'info',
      title: 'Část objednávek nemá přesnou nákupku',
      finding: 'Zisk po Ads počítá přesný hrubý zisk jen z objednávek, kde máme nákupní ceny u všech produktů.',
      evidence: `${formatNumber(orderTotal.missingCostOrders)} objednávek ve filtru nemá kompletní nákupku; přesných je ${formatNumber(orderTotal.exactOrders)}.`,
      recommendation: 'Doplnit nákupky u chybějících produktů, jinak může být vyhodnocení zisku po reklamě konzervativní nebo zkreslené.',
      confidence: 'vysoká',
    }));
  }

  const worstDay = daily
    .filter((row) => row.spend >= minSpend)
    .sort((a, b) => a.grossProfitAfterAds - b.grossProfitAfterAds)[0];
  if (worstDay && worstDay.grossProfitAfterAds < 0) {
    insights.push(insight({
      severity: 'warning',
      title: 'Den s negativním výsledkem po Ads',
      finding: 'V časové řadě je den, kdy spend převýšil přesný hrubý zisk.',
      evidence: `${worstDay.label}: spend ${formatCurrency(worstDay.spend)}, real tržby ${formatCurrency(worstDay.realRevenue)}, zisk po Ads ${formatCurrency(worstDay.grossProfitAfterAds)}.`,
      recommendation: 'Pro tento den porovnat kampaně, produkty a search terms proti okolním dnům; často odhalí změnu v mixu nebo krátkodobý výkyv.',
      confidence: 'střední',
    }));
  }

  return insights
    .sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2, good: 3 };
      return order[a.severity] - order[b.severity];
    })
    .slice(0, 8);
}

function Kpi({ label, value, sub, tone = 'slate' }) {
  const toneClass = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    slate: 'border-slate-200 bg-slate-50 text-slate-800',
  }[tone];

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="text-xs font-medium opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-xs opacity-75">{sub}</div>}
    </div>
  );
}

function InsightCard({ item }) {
  const classes = {
    critical: 'border-red-200 bg-red-50 text-red-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[item.severity] || 'border-slate-200 bg-slate-50 text-slate-800';

  const label = {
    critical: 'Priorita',
    warning: 'Pozor',
    info: 'Signál',
    good: 'Příležitost',
  }[item.severity] || 'Insight';

  return (
    <div className={`rounded-lg border p-4 ${classes}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div>
        <div className="text-[11px] opacity-70">Jistota: {item.confidence}</div>
      </div>
      <div className="text-sm font-bold">{item.title}</div>
      <div className="mt-2 text-sm leading-relaxed">{item.finding}</div>
      <div className="mt-3 rounded-md bg-white/55 p-2 text-xs leading-relaxed">
        <span className="font-semibold">Důkaz: </span>{item.evidence}
      </div>
      <div className="mt-2 text-xs leading-relaxed">
        <span className="font-semibold">Další krok: </span>{item.recommendation}
      </div>
    </div>
  );
}

function TrendValue({ row }) {
  const change = row.changePct;
  const tone = change === null
    ? 'text-slate-400'
    : change > 0
      ? 'text-emerald-700'
      : change < 0
        ? 'text-red-700'
        : 'text-slate-500';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{row.label}</div>
      <div className="mt-1 text-xl font-bold text-slate-800">{row.currentLabel}</div>
      <div className={`mt-1 text-xs font-semibold ${tone}`}>{change === null ? 'bez předchozí hodnoty' : formatSignedPercent(change)}</div>
      <div className="text-xs text-slate-400">předtím {row.previousLabel}</div>
    </div>
  );
}

function PeriodComparisonPanel({ comparison }) {
  if (!comparison) return null;
  const rangeLabel = comparison.previousRange
    ? `${comparison.previousRange.from} až ${comparison.previousRange.to}`
    : 'bez předchozího období';

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Změna proti předchozímu období</h3>
          <div className="text-xs text-slate-500">Srovnání se stejně dlouhým obdobím: {rangeLabel}</div>
        </div>
        <StatusBadge value={comparison.previousHasData ? 'trend OK' : 'bez trendu'} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {comparison.summary.map((row) => (
          <TrendValue key={row.label} row={row} />
        ))}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {comparison.signals.map((item, index) => (
          <InsightCard key={`${item.title}:${index}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function ProviderCoverageCard({ row }) {
  const completeEnough = row.coveragePct >= 95;
  const campaignRun = row.latestCampaignRun;
  const detailRun = row.latestDeepDetailRun;
  const campaignAge = syncAgeMinutes(campaignRun);
  const campaignFresh = Boolean(campaignRun && campaignRun.status === 'success' && campaignAge <= MAX_CAMPAIGN_SYNC_AGE_MINUTES);
  const campaignFreshnessLabel = campaignRun
    ? (campaignFresh ? 'fresh' : 'opožděné')
    : row.provider === 'meta_ads'
      ? 'čeká'
      : 'bez syncu';
  const tone = row.hasData && completeEnough
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : row.hasData
      ? 'border-blue-200 bg-blue-50 text-blue-900'
    : 'border-amber-200 bg-amber-50 text-amber-900';
  const statusLabel = row.hasData
    ? (completeEnough ? 'DATA OK' : 'ČÁSTEČNÉ')
    : row.provider === 'meta_ads'
      ? 'ČEKÁ'
      : 'BEZ DAT';

  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold">{providerLabel(row.provider)}</div>
        <StatusBadge value={statusLabel} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="opacity-70">Spend ve filtru</div>
          <div className="font-semibold">{formatCurrency(row.spend)}</div>
        </div>
        <div>
          <div className="opacity-70">Pokrytí filtru</div>
          <div className="font-semibold">{formatNumber(row.days)}/{formatNumber(row.expectedDays)} dnů ({formatPercent(row.coveragePct)})</div>
        </div>
        <div>
          <div className="opacity-70">Kampaňové řádky</div>
          <div className="font-semibold">{formatNumber(row.campaignRows)}</div>
        </div>
        <div>
          <div className="opacity-70">Detailní řádky</div>
          <div className="font-semibold">{formatNumber(row.detailRows)}</div>
          {row.hasExactDetailCount && row.detailRowsLoaded !== row.detailRows && (
            <div className="opacity-70">top načteno {formatNumber(row.detailRowsLoaded)}</div>
          )}
        </div>
        <div>
          <div className="opacity-70">Čerstvost spendu</div>
          <div className={`font-semibold ${campaignFresh ? 'text-emerald-700' : row.provider === 'meta_ads' && !campaignRun ? '' : 'text-amber-700'}`}>
            {campaignFreshnessLabel}
          </div>
          <div className="opacity-70">{campaignRun ? `${formatAgeMinutes(campaignAge)} / limit ${formatNumber(MAX_CAMPAIGN_SYNC_AGE_MINUTES)} min` : 'čeká na první běh'}</div>
        </div>
      </div>
      <div className="mt-2 space-y-1 text-xs leading-relaxed opacity-80">
        <div>
          {campaignRun
            ? `Spend sync ${campaignRun.status}: ${campaignRun.range_from} až ${campaignRun.range_to}, ${formatNumber(campaignRun.rows_upserted)} řádků, ${formatDateTime(syncRunTimestamp(campaignRun))}`
            : row.provider === 'meta_ads'
              ? 'Spend sync čeká na Meta přístup.'
              : 'Spend sync zatím nemá uložený běh.'}
        </div>
        <div>
          {detailRun
            ? `Deep detail ${detailRun.status}: ${detailRun.range_from} až ${detailRun.range_to}, ${formatNumber(detailRun.rows_upserted)} řádků, ${formatDateTime(syncRunTimestamp(detailRun))}`
            : row.provider === 'meta_ads'
              ? 'Deep detail čeká na Meta přístup.'
              : 'Deep detail zatím nemá uložený běh.'}
        </div>
      </div>
    </div>
  );
}

function BusinessSourceCard({ state }) {
  const status = state?.status || 'fallback';
  const tone = status === 'loaded'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : status === 'error'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-blue-200 bg-blue-50 text-blue-900';
  const label = status === 'loaded' ? 'VIEWS OK' : status === 'error' ? 'FALLBACK' : 'FALLBACK';

  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold">Business metriky</div>
        <StatusBadge value={label} />
      </div>
      <div className="mt-2 text-2xl font-bold">{status === 'loaded' ? 'Supabase' : 'React'}</div>
      <div className="mt-1 text-xs leading-relaxed opacity-80">
        {status === 'loaded'
          ? `${formatNumber(state.totalRows)} denních a ${formatNumber(state.providerRows)} provider řádků z business views.`
          : state?.message || 'Počítá se z objednávek načtených pro aktuální filtr; po aplikaci SQL views se přepne na Supabase.'}
      </div>
    </div>
  );
}

function ReadinessBlockers({ providerCoverage, businessViewState, exactShare }) {
  const blockers = [];
  const meta = providerCoverage.find((row) => row.provider === 'meta_ads');
  const google = providerCoverage.find((row) => row.provider === 'google_ads');

  if (!meta?.hasData) {
    blockers.push({
      title: 'Meta Ads nejsou v datech',
      detail: 'Ve vybraném filtru zatím nejsou Meta campaign řádky. Pokud už jsou přístupy doplněné, spustit readiness check, sync a historický backfill.',
    });
  }
  if (businessViewState.status !== 'loaded') {
    blockers.push({
      title: 'Business views nejsou aplikované v Supabase',
      detail: 'Dashboard počítá tržby, PNO a zisk po Ads fallbackem v prohlížeči; po doplnění SUPABASE_DB_URL se přepne na Supabase views.',
    });
  }
  if (google?.hasData && !google?.hasDeepDetail) {
    blockers.push({
      title: 'Google deep detail není kompletní',
      detail: 'Spend běží, ale chybí hlubší vrstvy pro kampaně, search terms, produkty, zařízení nebo geo.',
    });
  }
  if (!google?.latestCampaignRun || google.latestCampaignRun.status !== 'success' || syncAgeMinutes(google.latestCampaignRun) > MAX_CAMPAIGN_SYNC_AGE_MINUTES) {
    blockers.push({
      title: 'Google spend sync není čerstvý',
      detail: `Poslední campaign spend sync musí být mladší než ${formatNumber(MAX_CAMPAIGN_SYNC_AGE_MINUTES)} minut; jinak mohou být dnešní náklady a PNO opožděné.`,
    });
  }
  if (exactShare < 95) {
    blockers.push({
      title: 'Část objednávek nemá přesnou nákupku',
      detail: 'Zisk po Ads je nejpřesnější až ve chvíli, kdy mají všechny produkty nákupní cenu.',
    });
  }

  if (!blockers.length) {
    return (
      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <div className="font-semibold">Marketing analytics je pro vybraný filtr datově připravený.</div>
        <div className="mt-1 text-xs opacity-80">Google/Meta, business metriky i maržová přesnost mají data v očekávaném stavu.</div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Co chybí do plného stavu</div>
        <StatusBadge value={`${formatNumber(blockers.length)} blokery`} />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {blockers.map((item) => (
          <div key={item.title} className="rounded-md bg-white/65 p-2 text-xs leading-relaxed">
            <div className="font-semibold">{item.title}</div>
            <div className="mt-1 opacity-80">{item.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DataReadinessPanel({ providerCoverage, detailCoverage, orderTotal, businessViewState }) {
  const exactShare = orderTotal.orders ? (orderTotal.exactOrders / orderTotal.orders) * 100 : 0;
  const activeDetails = detailCoverage.filter((row) => row.rows > 0);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">Datová připravenost</h3>
        <div className="text-xs text-slate-500">{formatNumber(activeDetails.length)} detailních vrstev</div>
      </div>
      <div className="grid gap-3 lg:grid-cols-4">
        {providerCoverage.map((row) => (
          <ProviderCoverageCard key={row.provider} row={row} />
        ))}
        <BusinessSourceCard state={businessViewState} />
        <div className={`rounded-lg border p-3 ${exactShare >= 95 ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-bold">Maržová přesnost</div>
            <StatusBadge value={exactShare >= 95 ? 'OK' : 'DOPLNIT'} />
          </div>
          <div className="mt-2 text-2xl font-bold">{formatPercent(exactShare)}</div>
          <div className="mt-1 text-xs opacity-80">
            {formatNumber(orderTotal.exactOrders)} přesných objednávek z {formatNumber(orderTotal.orders)}.
            {orderTotal.missingCostOrders > 0 ? ` ${formatNumber(orderTotal.missingCostOrders)} objednávek má chybějící nákupku.` : ''}
          </div>
        </div>
      </div>
      <ReadinessBlockers
        providerCoverage={providerCoverage}
        businessViewState={businessViewState}
        exactShare={exactShare}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {detailCoverage.map((row) => (
          <span
            key={row.level}
            className={`inline-flex rounded-md border px-2 py-1 text-xs ${
              row.rows > 0
                ? 'border-blue-200 bg-blue-50 text-blue-800'
                : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}
          >
            {LEVEL_LABELS[row.level] || row.level}: {formatNumber(row.rows)}
            {row.hasExactCount && row.loadedRows !== row.rows ? ` · top ${formatNumber(row.loadedRows)}` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ value }) {
  const active = ['ENABLED', 'SERVING', 'OK', 'DATA OK', 'VIEWS OK', 'SUCCESS'].includes(String(value || '').toUpperCase());
  const paused = ['PAUSED', 'REMOVED'].includes(String(value || '').toUpperCase());
  const classes = active
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : paused
      ? 'bg-slate-50 text-slate-500 border-slate-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';

  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${classes}`}>
      {value || 'bez statusu'}
    </span>
  );
}

function CampaignTable({ rows }) {
  if (!rows.length) {
    return <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Pro zvolené období tu zatím nejsou kampaně.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Kampaň</th>
            <th className="px-3 py-2 text-left">Trh</th>
            <th className="px-3 py-2 text-left">Typ</th>
            <th className="px-3 py-2 text-right">Spend</th>
            <th className="px-3 py-2 text-right">Konv. hodnota</th>
            <th className="px-3 py-2 text-right">ROAS</th>
            <th className="px-3 py-2 text-right">Konverze</th>
            <th className="px-3 py-2 text-right">AOV</th>
            <th className="px-3 py-2 text-right">Kliky</th>
            <th className="px-3 py-2 text-right">CPC</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.slice(0, 30).map((row) => (
            <tr key={row.key} className="hover:bg-slate-50">
              <td className="px-3 py-2">
                <div className="font-semibold text-slate-800">{row.campaignName}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <StatusBadge value={row.status} />
                  {row.servingStatus && <StatusBadge value={row.servingStatus} />}
                </div>
              </td>
              <td className="px-3 py-2 text-slate-600">{providerLabel(row.provider)} / {marketLabel(row.market)}</td>
              <td className="px-3 py-2 text-slate-600">
                <div>{row.channelType || '—'}</div>
                <div className="text-xs text-slate-400">{row.biddingStrategyType || ''}</div>
              </td>
              <td className="px-3 py-2 text-right font-semibold text-red-700">{formatCurrency(row.spend)}</td>
              <td className="px-3 py-2 text-right font-semibold text-emerald-700">{formatCurrency(row.conversionValue)}</td>
              <td className="px-3 py-2 text-right font-bold text-slate-800">{formatRatio(row.roas)}</td>
              <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.conversions)}</td>
              <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.aov)}</td>
              <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.clicks)}</td>
              <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.cpc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailTable({ title, rows }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-800">{title}</h3>
      {!rows.length ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Bez dat.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Položka</th>
                <th className="px-3 py-2 text-left">Kampaň</th>
                <th className="px-3 py-2 text-right">Spend</th>
                <th className="px-3 py-2 text-right">Kliky</th>
                <th className="px-3 py-2 text-right">Konv.</th>
                <th className="px-3 py-2 text-right">AOV</th>
                <th className="px-3 py-2 text-right">ROAS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.key} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <div className="max-w-[360px] truncate font-medium text-slate-800">{row.label}</div>
                    <div className="text-xs text-slate-400">{marketLabel(row.market)} {row.subLabel ? `· ${row.subLabel}` : ''}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{row.campaignName || '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-red-700">{formatCurrency(row.spend)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.clicks)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.conversions)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.aov)}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800">{formatRatio(row.roas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdsTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-slate-800">{item.label}</div>
      <div className="text-red-700">Spend: {formatCurrency(item.spend)}</div>
      <div className="text-emerald-700">Konv. hodnota: {formatCurrency(item.conversionValue)}</div>
      <div className="text-slate-700">ROAS: {formatRatio(item.roas)}</div>
      <div className="text-slate-500">Kliky: {formatNumber(item.clicks)} · Konverze: {formatNumber(item.conversions)}</div>
    </div>
  );
}

export default function AdsModule({ supabaseClient, dateFrom, dateTo, country, orders = [] }) {
  const [dailyRows, setDailyRows] = useState([]);
  const [campaignRows, setCampaignRows] = useState([]);
  const [previousCampaignRows, setPreviousCampaignRows] = useState([]);
  const [campaignMetaRows, setCampaignMetaRows] = useState([]);
  const [detailRows, setDetailRows] = useState([]);
  const [detailCounts, setDetailCounts] = useState({ byLevel: {}, byProvider: {} });
  const [syncRuns, setSyncRuns] = useState([]);
  const [businessDailyRows, setBusinessDailyRows] = useState([]);
  const [businessProviderRows, setBusinessProviderRows] = useState([]);
  const [businessViewState, setBusinessViewState] = useState({
    status: 'fallback',
    totalRows: 0,
    providerRows: 0,
    message: 'Počítá se z objednávek načtených pro aktuální filtr.',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadAds() {
      if (!supabaseClient) return;
      setLoading(true);
      setError('');

      const applyMarket = (query) => {
        if (country && country !== 'all') return query.eq('market', country);
        return query;
      };
      const previousRange = previousDateRange(dateFrom, dateTo);

      const campaignMetricQuery = applyMarket(
        supabaseClient
          .from('ad_metrics_daily')
          .select('date,provider,market,account_id,account_name,level,campaign_id,campaign_name,currency,spend_czk,impressions,clicks,interactions,conversions,conversion_value_czk')
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .eq('level', 'campaign')
          .order('date', { ascending: true })
          .range(0, 9999)
      );

      const previousCampaignMetricQuery = previousRange
        ? applyMarket(
            supabaseClient
              .from('ad_metrics_daily')
              .select('date,provider,market,account_id,account_name,level,campaign_id,campaign_name,currency,spend_czk,impressions,clicks,interactions,conversions,conversion_value_czk')
              .gte('date', previousRange.from)
              .lte('date', previousRange.to)
              .eq('level', 'campaign')
              .order('date', { ascending: true })
              .range(0, 9999)
          )
        : Promise.resolve({ data: [], error: null });

      const detailQueries = DETAIL_COVERAGE_LEVELS.map((level) => applyMarket(
        supabaseClient
          .from('ad_metrics_daily')
          .select('date,provider,market,level,campaign_name,ad_group_name,spend_czk,impressions,clicks,interactions,conversions,conversion_value_czk,dimensions')
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .eq('level', level)
          .order('spend_czk', { ascending: false })
          .range(0, DETAIL_LEVEL_ROW_LIMIT - 1)
      ));

      const detailCountQueries = DETAIL_COVERAGE_LEVELS.map((level) => applyMarket(
        supabaseClient
          .from('ad_metrics_daily')
          .select('id', { count: 'exact', head: true })
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .eq('level', level)
      ));

      const providerDetailCountQueries = EXPECTED_PROVIDERS.map((provider) => applyMarket(
        supabaseClient
          .from('ad_metrics_daily')
          .select('id', { count: 'exact', head: true })
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .eq('provider', provider)
          .in('level', DETAIL_COVERAGE_LEVELS)
      ));

      const metaQuery = country && country !== 'all'
        ? supabaseClient.from('ad_campaigns').select('*').eq('market', country).range(0, 999)
        : supabaseClient.from('ad_campaigns').select('*').range(0, 999);

      const runsQuery = supabaseClient
        .from('ad_sync_runs')
        .select('provider,sync_type,range_from,range_to,status,rows_upserted,warnings,error_message,started_at,finished_at')
        .order('started_at', { ascending: false })
        .limit(80);

      const businessDailyQuery = applyMarket(
        supabaseClient
          .from('marketing_business_daily_total')
          .select('date,market,spend_czk,impressions,clicks,interactions,conversions,conversion_value_czk,orders,exact_orders,missing_cost_orders,real_revenue_czk,exact_revenue_czk,exact_cost_czk,exact_gross_profit_czk,gross_profit_after_ads_czk,pno,real_roas,spend_to_gross_profit_pct')
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .order('date', { ascending: true })
          .range(0, 9999)
      );

      const businessProviderQuery = applyMarket(
        supabaseClient
          .from('marketing_business_provider_daily_summary')
          .select('date,market,provider,spend_czk,impressions,clicks,interactions,conversions,conversion_value_czk,orders,exact_orders,missing_cost_orders,real_revenue_czk,exact_revenue_czk,exact_cost_czk,exact_gross_profit_czk,gross_profit_after_ads_czk,pno,real_roas,spend_to_gross_profit_pct')
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .order('date', { ascending: true })
          .range(0, 9999)
      );

      const [campaignMetricResult, previousCampaignMetricResult, metaResult, runsResult, businessDailyResult, businessProviderResult, ...detailAndCountResults] = await Promise.all([
        campaignMetricQuery,
        previousCampaignMetricQuery,
        metaQuery,
        runsQuery,
        businessDailyQuery,
        businessProviderQuery,
        ...detailQueries,
        ...detailCountQueries,
        ...providerDetailCountQueries,
      ]);

      const detailResults = detailAndCountResults.slice(0, DETAIL_COVERAGE_LEVELS.length);
      const detailCountResults = detailAndCountResults.slice(DETAIL_COVERAGE_LEVELS.length, DETAIL_COVERAGE_LEVELS.length * 2);
      const providerDetailCountResults = detailAndCountResults.slice(DETAIL_COVERAGE_LEVELS.length * 2);
      const firstError = [campaignMetricResult, previousCampaignMetricResult, metaResult, runsResult, ...detailResults].find((result) => result.error)?.error;
      if (firstError) throw firstError;

      if (!cancelled) {
        const businessError = [businessDailyResult, businessProviderResult].find((result) => result.error)?.error;
        const businessMissing = businessError && isMissingViewError(businessError);
        const businessAvailable = !businessError;

        setDailyRows(campaignMetricResult.data || []);
        setCampaignRows(campaignMetricResult.data || []);
        setPreviousCampaignRows(previousCampaignMetricResult.data || []);
        setDetailRows(detailResults.flatMap((result) => result.data || []));
        setDetailCounts({
          byLevel: Object.fromEntries(DETAIL_COVERAGE_LEVELS.map((level, index) => [
            level,
            detailCountResults[index]?.error ? null : detailCountResults[index]?.count,
          ])),
          byProvider: Object.fromEntries(EXPECTED_PROVIDERS.map((provider, index) => [
            provider,
            providerDetailCountResults[index]?.error ? null : providerDetailCountResults[index]?.count,
          ])),
        });
        setCampaignMetaRows(metaResult.data || []);
        setSyncRuns(runsResult.data || []);
        setBusinessDailyRows(businessAvailable ? (businessDailyResult.data || []) : []);
        setBusinessProviderRows(businessAvailable ? (businessProviderResult.data || []) : []);
        setBusinessViewState(businessAvailable
          ? {
              status: 'loaded',
              totalRows: (businessDailyResult.data || []).length,
              providerRows: (businessProviderResult.data || []).length,
              message: '',
            }
          : businessMissing
            ? {
                status: 'fallback',
                totalRows: 0,
                providerRows: 0,
                message: 'Business views zatím nejsou v Supabase aplikované; počítá se fallbackem z objednávek ve filtru.',
              }
            : {
                status: 'error',
                totalRows: 0,
                providerRows: 0,
                message: `Business views se nepodařilo načíst: ${businessError.message || 'neznámá chyba'}.`,
              });
      }
    }

    loadAds()
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Ads data se nepodařilo načíst.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [supabaseClient, dateFrom, dateTo, country]);

  const campaignMeta = useMemo(() => {
    const map = new Map();
    for (const row of campaignMetaRows) {
      map.set(`${row.provider}:${row.account_id}:${row.campaign_id}`, row);
    }
    return map;
  }, [campaignMetaRows]);

  const businessViewsLoaded = businessViewState.status === 'loaded';
  const businessViewsHaveRows = businessViewsLoaded && businessDailyRows.length > 0;
  const localOrderTotal = useMemo(() => aggregateOrders(orders), [orders]);
  const businessOrderTotal = useMemo(() => orderMetricsFromBusinessRows(businessDailyRows), [businessDailyRows]);
  const orderTotal = businessViewsHaveRows ? businessOrderTotal : localOrderTotal;
  const orderByDate = useMemo(() => aggregateOrdersByDate(orders), [orders]);
  const orderByMarket = useMemo(() => aggregateOrdersByMarket(orders), [orders]);
  const total = useMemo(() => metricSummary(dailyRows), [dailyRows]);
  const businessTotal = useMemo(() => ({
    realRevenue: orderTotal.revenue,
    exactGrossProfit: orderTotal.exactGrossProfit,
    grossProfitAfterAds: orderTotal.exactGrossProfit - total.spend,
    realRoas: total.spend ? orderTotal.revenue / total.spend : 0,
    pno: orderTotal.revenue ? (total.spend / orderTotal.revenue) * 100 : 0,
    spendToGrossProfit: orderTotal.exactGrossProfit ? (total.spend / orderTotal.exactGrossProfit) * 100 : 0,
  }), [orderTotal, total]);
  const daily = useMemo(
    () => (businessViewsHaveRows ? aggregateDailyFromBusinessRows(businessDailyRows) : aggregateDaily(dailyRows, orderByDate)),
    [businessViewsHaveRows, businessDailyRows, dailyRows, orderByDate]
  );
  const markets = useMemo(
    () => (businessViewsLoaded && businessProviderRows.length
      ? aggregateMarketsFromBusinessRows(businessProviderRows, dateFrom, dateTo)
      : aggregateMarkets(dailyRows, orderByMarket, dateFrom, dateTo)),
    [businessViewsLoaded, businessProviderRows, dailyRows, orderByMarket, dateFrom, dateTo]
  );
  const campaigns = useMemo(() => aggregateCampaigns(campaignRows, campaignMeta), [campaignRows, campaignMeta]);
  const comparisonRange = useMemo(() => previousDateRange(dateFrom, dateTo), [dateFrom, dateTo]);
  const previousTotal = useMemo(() => metricSummary(previousCampaignRows), [previousCampaignRows]);
  const previousMarkets = useMemo(
    () => comparisonRange ? aggregateAdMarkets(previousCampaignRows, comparisonRange.from, comparisonRange.to) : [],
    [previousCampaignRows, comparisonRange]
  );
  const previousCampaigns = useMemo(() => aggregateCampaigns(previousCampaignRows, campaignMeta), [previousCampaignRows, campaignMeta]);
  const periodComparison = useMemo(() => buildPeriodComparison({
    currentRange: { from: dateFrom, to: dateTo },
    previousRange: comparisonRange,
    currentTotal: total,
    previousTotal,
    currentMarkets: aggregateAdMarkets(campaignRows, dateFrom, dateTo),
    previousMarkets,
    currentCampaigns: campaigns,
    previousCampaigns,
  }), [dateFrom, dateTo, comparisonRange, total, previousTotal, campaignRows, previousMarkets, campaigns, previousCampaigns]);
  const topDevices = useMemo(() => aggregateDetails(detailRows, 'device'), [detailRows]);
  const topAdGroups = useMemo(() => aggregateDetails(detailRows, 'ad_group'), [detailRows]);
  const topAds = useMemo(() => aggregateDetails(detailRows, 'ad'), [detailRows]);
  const topKeywords = useMemo(() => aggregateDetails(detailRows, 'keyword'), [detailRows]);
  const topSearchTerms = useMemo(() => aggregateDetails(detailRows, 'search_term'), [detailRows]);
  const topProducts = useMemo(() => aggregateDetails(detailRows, 'shopping_product'), [detailRows]);
  const topAssetGroups = useMemo(() => aggregateDetails(detailRows, 'asset_group'), [detailRows]);
  const topHours = useMemo(() => aggregateDetails(detailRows, 'hour'), [detailRows]);
  const topConversionActions = useMemo(() => aggregateDetails(detailRows, 'conversion_action'), [detailRows]);
  const topAudiences = useMemo(() => aggregateDetails(detailRows, 'audience'), [detailRows]);
  const topGeo = useMemo(() => aggregateDetails(detailRows, 'geo'), [detailRows]);
  const topPlacements = useMemo(() => aggregateDetails(detailRows, 'placement'), [detailRows]);
  const providerCoverage = useMemo(
    () => aggregateProviderCoverage(campaignRows, detailRows, syncRuns, dateFrom, dateTo, detailCounts.byProvider),
    [campaignRows, detailRows, syncRuns, dateFrom, dateTo, detailCounts]
  );
  const detailCoverage = useMemo(
    () => aggregateDetailCoverage(detailRows, detailCounts.byLevel),
    [detailRows, detailCounts]
  );
  const ppcInsights = useMemo(() => buildPpcInsights({
    total,
    businessTotal,
    orderTotal,
    markets,
    campaigns,
    topSearchTerms,
    topProducts,
    topDevices,
    topKeywords,
    topAssetGroups,
    topHours,
    topAudiences,
    topGeo,
    topPlacements,
    daily,
    providerCoverage,
    periodComparison,
  }), [
    total,
    businessTotal,
    orderTotal,
    markets,
    campaigns,
    topSearchTerms,
    topProducts,
    topDevices,
    topKeywords,
    topAssetGroups,
    topHours,
    topAudiences,
    topGeo,
    topPlacements,
    daily,
    providerCoverage,
    periodComparison,
  ]);
  const latestRun = syncRuns[0];

  if (loading) {
    return <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Načítám Ads data…</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Ads data se nepodařilo načíst: {error}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Ads přehled</h2>
          <div className="text-sm text-slate-500">{dateFrom} až {dateTo} · {country === 'all' ? 'všechny země' : marketLabel(country)}</div>
        </div>
        {latestRun && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <div className="font-semibold text-slate-800">Poslední sync: {providerLabel(latestRun.provider)} · {latestRun.status}</div>
            <div>{latestRun.range_from} až {latestRun.range_to} · {formatNumber(latestRun.rows_upserted)} řádků</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="Spend" value={formatCurrency(total.spend)} sub={`${formatNumber(total.clicks)} kliků`} tone="amber" />
        <Kpi label="Konv. hodnota" value={formatCurrency(total.conversionValue)} sub={`${formatNumber(total.conversions)} konverzí`} tone="emerald" />
        <Kpi label="ROAS" value={formatRatio(total.roas)} sub={`AOV ${formatCurrency(total.aov)}`} tone="blue" />
        <Kpi label="CPC" value={formatCurrency(total.cpc)} sub={`CTR ${formatPercent(total.ctr)}`} />
        <Kpi label="CPA" value={formatCurrency(total.costPerConversion)} sub={`CPM ${formatCurrency(total.cpm)}`} />
        <Kpi label="Imprese" value={formatNumber(total.impressions)} sub={`${formatNumber(total.interactions)} interakcí`} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="Real tržby" value={formatCurrency(businessTotal.realRevenue)} sub={`${formatNumber(orderTotal.orders)} obj.`} tone="blue" />
        <Kpi label="Přesný hrubý zisk" value={formatCurrency(businessTotal.exactGrossProfit)} sub={`${formatNumber(orderTotal.exactOrders)} přesných obj.`} tone="emerald" />
        <Kpi label="Zisk po Ads" value={formatCurrency(businessTotal.grossProfitAfterAds)} sub="hrubý zisk - spend" tone={businessTotal.grossProfitAfterAds >= 0 ? 'emerald' : 'amber'} />
        <Kpi label="Real ROAS" value={formatRatio(businessTotal.realRoas)} sub="tržby / spend" tone="blue" />
        <Kpi label="PNO" value={formatPercent(businessTotal.pno)} sub="spend / tržby" />
        <Kpi label="Ads vs zisk" value={formatPercent(businessTotal.spendToGrossProfit)} sub={`${formatNumber(orderTotal.missingCostOrders)} obj. bez přesné nákupky`} />
      </div>

      <DataReadinessPanel
        providerCoverage={providerCoverage}
        detailCoverage={detailCoverage}
        orderTotal={orderTotal}
        businessViewState={businessViewState}
      />

      <PeriodComparisonPanel comparison={periodComparison} />

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-800">Senior PPC interpretace</h3>
          <div className="text-xs text-slate-500">{formatNumber(ppcInsights.length)} signálů</div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {ppcInsights.map((item, index) => (
            <InsightCard key={`${item.severity}:${item.title}:${index}`} item={item} />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 p-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Denní vývoj</h3>
          <div className="text-xs text-slate-500">{daily.length} dnů</div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily} margin={{ top: 12, right: 18, left: 8, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis yAxisId="money" tickFormatter={(value) => `${Math.round(value / 1000)}k`} tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis yAxisId="roas" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} />
              <RechartsTooltip content={<AdsTooltip />} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar yAxisId="money" dataKey="spend" name="Spend" fill="#f59e0b" radius={[5, 5, 0, 0]} />
              <Bar yAxisId="money" dataKey="conversionValue" name="Konv. hodnota" fill="#10b981" radius={[5, 5, 0, 0]} />
              <Line yAxisId="money" type="monotone" dataKey="realRevenue" name="Real tržby" stroke="#0f766e" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
              <Line yAxisId="money" type="monotone" dataKey="grossProfitAfterAds" name="Zisk po Ads" stroke="#7c3aed" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
              <Line yAxisId="roas" type="monotone" dataKey="roas" name="ROAS" stroke="#2563eb" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Rozpad podle trhu</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Zdroj / trh</th>
                <th className="px-3 py-2 text-left">Pokrytí</th>
                <th className="px-3 py-2 text-right">Spend</th>
                <th className="px-3 py-2 text-right">Konv. hodnota</th>
                <th className="px-3 py-2 text-right">ROAS</th>
                <th className="px-3 py-2 text-right">Real tržby</th>
                <th className="px-3 py-2 text-right">Zisk po Ads</th>
                <th className="px-3 py-2 text-right">PNO</th>
                <th className="px-3 py-2 text-right">Konverze</th>
                <th className="px-3 py-2 text-right">AOV</th>
                <th className="px-3 py-2 text-right">CPC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {markets.map((row) => (
                <tr key={row.key} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-semibold text-slate-800">{providerLabel(row.provider)} / {marketLabel(row.market)}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    <div className={`font-semibold ${row.coveragePct >= 95 ? 'text-emerald-700' : row.coveragePct > 0 ? 'text-blue-700' : 'text-amber-700'}`}>
                      {formatNumber(row.days)}/{formatNumber(row.expectedDays)} dnů · {formatPercent(row.coveragePct)}
                    </div>
                    <div className="text-slate-400">{row.firstDate || 'bez dat'} až {row.lastDate || 'bez dat'}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-red-700 font-semibold">{formatCurrency(row.spend)}</td>
                  <td className="px-3 py-2 text-right text-emerald-700 font-semibold">{formatCurrency(row.conversionValue)}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800">{formatRatio(row.roas)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.realRevenue)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${row.grossProfitAfterAds >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(row.grossProfitAfterAds)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatPercent(row.pno)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.conversions)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.aov)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.cpc)}</td>
                </tr>
              ))}
              {!markets.length && (
                <tr>
                  <td colSpan={11} className="px-3 py-4 text-center text-slate-500">Pro zvolené období nejsou Ads data.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Kampaně</h3>
        <CampaignTable rows={campaigns} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <DetailTable title={LEVEL_LABELS.ad_group} rows={topAdGroups} />
        <DetailTable title={LEVEL_LABELS.device} rows={topDevices} />
        <DetailTable title={LEVEL_LABELS.ad} rows={topAds} />
        <DetailTable title={LEVEL_LABELS.keyword} rows={topKeywords} />
        <DetailTable title={LEVEL_LABELS.search_term} rows={topSearchTerms} />
        <DetailTable title={LEVEL_LABELS.shopping_product} rows={topProducts} />
        <DetailTable title={LEVEL_LABELS.asset_group} rows={topAssetGroups} />
        <DetailTable title={LEVEL_LABELS.hour} rows={topHours} />
        <DetailTable title={LEVEL_LABELS.conversion_action} rows={topConversionActions} />
        <DetailTable title={LEVEL_LABELS.audience} rows={topAudiences} />
        <DetailTable title={LEVEL_LABELS.geo} rows={topGeo} />
        <DetailTable title={LEVEL_LABELS.placement} rows={topPlacements} />
      </div>

      {!!syncRuns.length && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Sync běhy</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Provider</th>
                  <th className="px-3 py-2 text-left">Typ</th>
                  <th className="px-3 py-2 text-left">Období</th>
                  <th className="px-3 py-2 text-right">Řádky</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {syncRuns.map((run) => (
                  <tr key={`${run.provider}:${run.started_at}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-semibold text-slate-800">{providerLabel(run.provider)}</td>
                    <td className="px-3 py-2 text-slate-600">{run.sync_type}</td>
                    <td className="px-3 py-2 text-slate-600">{run.range_from} až {run.range_to}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{formatNumber(run.rows_upserted)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge value={run.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
