#!/usr/bin/env node

/**
 * Read-only health check for deep Ads detail imports.
 *
 * This checks Supabase only. It does not call Google Ads or Meta APIs and it
 * never writes data. Use it after the daily detail sync to make sure the
 * analytical layers are populated for every expected market, not just campaign
 * spend.
 */

import {
  requireEnv,
  supabaseRequest,
} from './lib/ads-sync-utils.mjs';

const SUCCESS_STATUSES = new Set(['success', 'partial_success']);
const DEFAULT_PROVIDERS = ['google_ads'];
const DEFAULT_MARKETS = ['cz', 'sk', 'hu', 'ro'];
const DEFAULT_SYNC_LEVELS = [
  'campaign',
  'device',
  'hour',
  'ad_group',
  'ad',
  'keyword',
  'search_term',
  'shopping_product',
  'geo',
  'conversion_action',
];
const DEFAULT_ROW_LEVELS = [
  'device',
  'hour',
  'ad_group',
  'ad',
  'keyword',
  'search_term',
  'shopping_product',
  'geo',
  'conversion_action',
];

function parseCsv(value, fallback) {
  const values = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : fallback;
}

function parseBooleanEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no'].includes(String(value).toLowerCase());
}

function parsePositiveNumberEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number. Received: ${process.env[name]}`);
  }
  return value;
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function toDateString(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monitoredDate() {
  if (process.env.ADS_DETAIL_HEALTH_DATE) return process.env.ADS_DETAIL_HEALTH_DATE;
  const daysBack = parsePositiveNumberEnv('ADS_DETAIL_HEALTH_DAYS_BACK', 1);
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysBack);
  return toDateString(date);
}

function runTimestamp(run) {
  return new Date(run.finished_at || run.started_at || 0);
}

function ageMinutes(timestamp, now = new Date()) {
  const time = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  if (!Number.isFinite(time) || time <= 0) return Number.POSITIVE_INFINITY;
  return (now.getTime() - time) / 60000;
}

function formatNumber(value) {
  return Math.round(toNumber(value)).toLocaleString('cs-CZ');
}

function syncTypeLevels(syncType) {
  const [, rawLevels = ''] = String(syncType || '').split(':');
  return new Set(rawLevels.split(',').map((level) => level.trim()).filter(Boolean));
}

function runHasRequiredLevels(run, requiredLevels) {
  if (!String(run.sync_type || '').startsWith('detail:')) return false;
  const levels = syncTypeLevels(run.sync_type);
  return requiredLevels.every((level) => levels.has(level));
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
      headers: { Range: `${from}-${from + pageSize - 1}` },
      prefer: 'count=exact',
    });

    const chunk = Array.isArray(page) ? page : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  return rows;
}

function summarizeMetricRows(rows) {
  const byKey = new Map();

  for (const row of rows) {
    const key = `${row.provider}:${row.market}:${row.level}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        provider: row.provider,
        market: row.market,
        level: row.level,
        rows: 0,
        spend: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
      });
    }
    const target = byKey.get(key);
    target.rows += 1;
    target.spend += toNumber(row.spend_czk);
    target.clicks += toNumber(row.clicks);
    target.impressions += toNumber(row.impressions);
    target.conversions += toNumber(row.conversions);
  }

  return byKey;
}

function printMarketSummary(summary, providers, markets, rowLevels) {
  for (const provider of providers) {
    for (const market of markets) {
      const rows = rowLevels.reduce((sum, level) => sum + toNumber(summary.get(`${provider}:${market}:${level}`)?.rows), 0);
      const spend = rowLevels.reduce((sum, level) => sum + toNumber(summary.get(`${provider}:${market}:${level}`)?.spend), 0);
      console.log([
        `[check-ads-detail-health] ${provider}/${market.toUpperCase()}`,
        `detail_rows=${formatNumber(rows)}`,
        `level_spend_sum=${formatNumber(spend)} Kč`,
      ].join(' | '));
    }
  }
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const providers = parseCsv(process.env.ADS_DETAIL_HEALTH_EXPECTED_PROVIDERS, DEFAULT_PROVIDERS);
  const markets = parseCsv(process.env.ADS_DETAIL_HEALTH_EXPECTED_MARKETS || process.env.SYNC_MARKETS, DEFAULT_MARKETS);
  const requiredSyncLevels = parseCsv(process.env.ADS_DETAIL_HEALTH_REQUIRED_SYNC_LEVELS, DEFAULT_SYNC_LEVELS);
  const requiredRowLevels = parseCsv(process.env.ADS_DETAIL_HEALTH_REQUIRED_ROW_LEVELS, DEFAULT_ROW_LEVELS);
  const date = monitoredDate();
  const maxSyncAgeMinutes = parsePositiveNumberEnv('ADS_DETAIL_HEALTH_MAX_SYNC_AGE_MINUTES', 2160);
  const requireMarketRows = parseBooleanEnv('ADS_DETAIL_HEALTH_REQUIRE_MARKET_ROWS', true);
  const requireLevelRows = parseBooleanEnv('ADS_DETAIL_HEALTH_REQUIRE_LEVEL_ROWS', true);
  const requireRowsUpserted = parseBooleanEnv('ADS_DETAIL_HEALTH_REQUIRE_ROWS_UPSERTED', true);
  const now = new Date();
  const failures = [];

  console.log(`[check-ads-detail-health] Date: ${date}`);
  console.log(`[check-ads-detail-health] Expected providers: ${providers.join(', ')}`);
  console.log(`[check-ads-detail-health] Expected markets: ${markets.join(', ')}`);
  console.log(`[check-ads-detail-health] Required sync levels: ${requiredSyncLevels.join(', ')}`);
  console.log(`[check-ads-detail-health] Required row levels: ${requiredRowLevels.join(', ')}`);

  const runs = await fetchAllRowsWithRange({
    supabaseUrl,
    serviceRoleKey,
    table: 'ad_sync_runs',
    select: 'provider,sync_type,range_from,range_to,status,rows_upserted,warnings,error_message,started_at,finished_at',
    filters: {
      provider: `in.(${providers.join(',')})`,
    },
    orderBy: 'started_at.desc',
  });

  for (const provider of providers) {
    const latestDetailRun = runs.find((run) => run.provider === provider && runHasRequiredLevels(run, requiredSyncLevels));

    if (!latestDetailRun) {
      failures.push(`${provider}: no detail sync run found with required levels`);
      continue;
    }

    const timestamp = runTimestamp(latestDetailRun);
    const age = ageMinutes(timestamp, now);
    console.log([
      `[check-ads-detail-health] latest ${provider}`,
      `status=${latestDetailRun.status}`,
      `sync_type=${latestDetailRun.sync_type}`,
      `range=${latestDetailRun.range_from}..${latestDetailRun.range_to}`,
      `rows_upserted=${formatNumber(latestDetailRun.rows_upserted)}`,
      `age_minutes=${Number.isFinite(age) ? age.toFixed(1) : 'n/a'}`,
    ].join(' | '));

    if (!SUCCESS_STATUSES.has(String(latestDetailRun.status || '').toLowerCase())) {
      failures.push(`${provider}: latest detail sync status is ${latestDetailRun.status}`);
    }
    if (age > maxSyncAgeMinutes) {
      failures.push(`${provider}: latest detail sync is stale (${age.toFixed(1)} min > ${maxSyncAgeMinutes} min)`);
    }
    if (latestDetailRun.range_from && latestDetailRun.range_from > date) {
      failures.push(`${provider}: latest detail sync range_from ${latestDetailRun.range_from} is after monitored date ${date}`);
    }
    if (latestDetailRun.range_to && latestDetailRun.range_to < date) {
      failures.push(`${provider}: latest detail sync range_to ${latestDetailRun.range_to} is before monitored date ${date}`);
    }
    if (requireRowsUpserted && toNumber(latestDetailRun.rows_upserted) <= 0) {
      failures.push(`${provider}: latest detail sync upserted no rows`);
    }
  }

  const metricRows = await fetchAllRowsWithRange({
    supabaseUrl,
    serviceRoleKey,
    table: 'ad_metrics_daily',
    select: 'date,provider,market,level,spend_czk,impressions,clicks,conversions',
    filters: {
      date: `eq.${date}`,
      provider: `in.(${providers.join(',')})`,
      market: `in.(${markets.join(',')})`,
      level: `in.(${requiredRowLevels.join(',')})`,
    },
    orderBy: 'provider.asc,market.asc,level.asc',
  });

  const summary = summarizeMetricRows(metricRows);
  printMarketSummary(summary, providers, markets, requiredRowLevels);

  for (const provider of providers) {
    for (const market of markets) {
      const marketRows = requiredRowLevels.reduce(
        (sum, level) => sum + toNumber(summary.get(`${provider}:${market}:${level}`)?.rows),
        0,
      );
      if (requireMarketRows && marketRows === 0) {
        failures.push(`${provider}/${market}: no non-campaign detail metric rows for ${date}`);
      }

      if (requireLevelRows) {
        for (const level of requiredRowLevels) {
          const rows = toNumber(summary.get(`${provider}:${market}:${level}`)?.rows);
          if (rows === 0) failures.push(`${provider}/${market}/${level}: no metric rows for ${date}`);
        }
      }
    }
  }

  if (failures.length) {
    console.error('[check-ads-detail-health] Failures:');
    for (const failure of failures) console.error(`- ${failure}`);
    throw new Error(`Ads detail health check failed with ${failures.length} issue(s).`);
  }

  console.log('[check-ads-detail-health] Ads detail health OK.');
}

main().catch((error) => {
  console.error('[check-ads-detail-health] FAILED:', error.message);
  process.exit(1);
});
