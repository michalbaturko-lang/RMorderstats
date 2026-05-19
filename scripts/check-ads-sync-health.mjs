#!/usr/bin/env node

/**
 * Read-only health check for scheduled Ads syncs.
 *
 * It verifies that expected providers have a recent campaign-level sync run and
 * campaign rows for the monitored date/markets. It reads only Supabase
 * ad_sync_runs and ad_metrics_daily; it never calls ad platforms and never
 * writes data.
 */

import {
  requireEnv,
  supabaseRequest,
  toDateString,
} from './lib/ads-sync-utils.mjs';

const CAMPAIGN_LEVEL = 'campaign';
const SUCCESS_STATUSES = new Set(['success', 'partial_success']);

function parseCsv(value, fallback) {
  const values = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : fallback;
}

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

function parseBooleanEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parsePositiveNumberEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number. Received: ${process.env[name]}`);
  }
  return value;
}

function monitoredDate() {
  if (process.env.ADS_HEALTH_DATE) return process.env.ADS_HEALTH_DATE;
  const fallbackHour = Number(process.env.ADS_HEALTH_EARLY_UTC_FALLBACK_HOUR || 4);
  if (!Number.isFinite(fallbackHour) || fallbackHour < 0 || fallbackHour > 23) {
    throw new Error(`ADS_HEALTH_EARLY_UTC_FALLBACK_HOUR must be 0-23. Received: ${process.env.ADS_HEALTH_EARLY_UTC_FALLBACK_HOUR}`);
  }
  const defaultOffset = new Date().getUTCHours() < fallbackHour ? 1 : 0;
  const offsetDays = Number(process.env.ADS_HEALTH_DATE_OFFSET_DAYS ?? defaultOffset);
  if (!Number.isFinite(offsetDays)) {
    throw new Error(`ADS_HEALTH_DATE_OFFSET_DAYS must be a number. Received: ${process.env.ADS_HEALTH_DATE_OFFSET_DAYS}`);
  }
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - offsetDays);
  return toDateString(date);
}

async function fetchRows({ supabaseUrl, serviceRoleKey, table, select, filters = {}, orderBy, limit = 1000 }) {
  return supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path: `/rest/v1/${table}`,
    searchParams: {
      select,
      ...filters,
      ...(orderBy ? { order: orderBy } : {}),
      limit,
    },
  });
}

function runTimestamp(run) {
  return run?.finished_at || run?.started_at || null;
}

function ageMinutes(value, now) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - timestamp) / 60_000;
}

function summarizeMetricRows(rows) {
  const byProviderMarket = new Map();
  for (const row of rows) {
    const key = `${row.provider}:${row.market}`;
    if (!byProviderMarket.has(key)) {
      byProviderMarket.set(key, {
        provider: row.provider,
        market: row.market,
        rows: 0,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
      });
    }
    const target = byProviderMarket.get(key);
    target.rows += 1;
    target.spend += toNumber(row.spend_czk);
    target.impressions += toNumber(row.impressions);
    target.clicks += toNumber(row.clicks);
    target.conversions += toNumber(row.conversions);
    target.conversionValue += toNumber(row.conversion_value_czk);
  }
  return byProviderMarket;
}

function printMetricSummary(summary, providers, markets) {
  for (const provider of providers) {
    for (const market of markets) {
      const row = summary.get(`${provider}:${market}`);
      console.log([
        `[check-ads-sync-health] ${provider}/${market.toUpperCase()}`,
        `rows=${formatNumber(row?.rows || 0)}`,
        `spend=${formatCurrency(row?.spend || 0)}`,
        `clicks=${formatNumber(row?.clicks || 0)}`,
        `impressions=${formatNumber(row?.impressions || 0)}`,
        `conversions=${formatNumber(row?.conversions || 0)}`,
      ].join(' | '));
    }
  }
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const expectedProviders = parseCsv(process.env.ADS_HEALTH_EXPECTED_PROVIDERS, ['google_ads']);
  const expectedMarkets = parseCsv(process.env.ADS_HEALTH_EXPECTED_MARKETS || process.env.SYNC_MARKETS, ['cz', 'sk', 'hu', 'ro']);
  const date = monitoredDate();
  const maxSyncAgeMinutes = parsePositiveNumberEnv('ADS_HEALTH_MAX_SYNC_AGE_MINUTES', 75);
  const requireCurrentRows = parseBooleanEnv('ADS_HEALTH_REQUIRE_CURRENT_ROWS', true);
  const requireMarketRows = parseBooleanEnv('ADS_HEALTH_REQUIRE_MARKET_ROWS', true);
  const requireRowsUpserted = parseBooleanEnv('ADS_HEALTH_REQUIRE_ROWS_UPSERTED', true);
  const now = new Date();
  const failures = [];

  console.log(`[check-ads-sync-health] Date: ${date}`);
  console.log(`[check-ads-sync-health] Expected providers: ${expectedProviders.join(', ')}`);
  console.log(`[check-ads-sync-health] Expected markets: ${expectedMarkets.join(', ')}`);

  const runs = await fetchRows({
    supabaseUrl,
    serviceRoleKey,
    table: 'ad_sync_runs',
    select: 'provider,sync_type,range_from,range_to,status,rows_upserted,warnings,error_message,started_at,finished_at',
    filters: {
      provider: `in.(${expectedProviders.join(',')})`,
    },
    orderBy: 'started_at.desc',
    limit: 100,
  });

  for (const provider of expectedProviders) {
    const latestCampaignRun = (runs || []).find((run) => (
      run.provider === provider &&
      String(run.sync_type || '').includes(CAMPAIGN_LEVEL)
    ));

    if (!latestCampaignRun) {
      failures.push(`${provider}: no campaign sync run found in ad_sync_runs`);
      continue;
    }

    const timestamp = runTimestamp(latestCampaignRun);
    const age = ageMinutes(timestamp, now);
    console.log([
      `[check-ads-sync-health] latest ${provider}`,
      `status=${latestCampaignRun.status}`,
      `sync_type=${latestCampaignRun.sync_type}`,
      `range=${latestCampaignRun.range_from}..${latestCampaignRun.range_to}`,
      `rows_upserted=${formatNumber(latestCampaignRun.rows_upserted)}`,
      `age_minutes=${Number.isFinite(age) ? age.toFixed(1) : 'n/a'}`,
    ].join(' | '));

    if (!SUCCESS_STATUSES.has(String(latestCampaignRun.status || '').toLowerCase())) {
      failures.push(`${provider}: latest campaign sync status is ${latestCampaignRun.status}`);
    }
    if (age > maxSyncAgeMinutes) {
      failures.push(`${provider}: latest campaign sync is stale (${age.toFixed(1)} min > ${maxSyncAgeMinutes} min)`);
    }
    if (latestCampaignRun.range_to && latestCampaignRun.range_to < date) {
      failures.push(`${provider}: latest campaign sync range_to ${latestCampaignRun.range_to} is before monitored date ${date}`);
    }
    if (requireRowsUpserted && toNumber(latestCampaignRun.rows_upserted) <= 0) {
      failures.push(`${provider}: latest campaign sync upserted no rows`);
    }
  }

  const metricRows = await fetchRows({
    supabaseUrl,
    serviceRoleKey,
    table: 'ad_metrics_daily',
    select: 'date,provider,market,level,spend_czk,impressions,clicks,conversions,conversion_value_czk',
    filters: {
      date: `eq.${date}`,
      level: `eq.${CAMPAIGN_LEVEL}`,
      provider: `in.(${expectedProviders.join(',')})`,
      market: `in.(${expectedMarkets.join(',')})`,
    },
    orderBy: 'provider.asc,market.asc',
    limit: 5000,
  });

  const metricSummary = summarizeMetricRows(metricRows || []);
  printMetricSummary(metricSummary, expectedProviders, expectedMarkets);

  for (const provider of expectedProviders) {
    const providerRows = (metricRows || []).filter((row) => row.provider === provider);
    if (requireCurrentRows && providerRows.length === 0) {
      failures.push(`${provider}: no campaign metric rows for ${date}`);
    }

    if (requireMarketRows) {
      for (const market of expectedMarkets) {
        if (!metricSummary.has(`${provider}:${market}`)) {
          failures.push(`${provider}/${market}: no campaign metric rows for ${date}`);
        }
      }
    }
  }

  if (failures.length) {
    console.error('[check-ads-sync-health] Failures:');
    for (const failure of failures) console.error(`- ${failure}`);
    throw new Error(`Ads sync health check failed with ${failures.length} issue(s).`);
  }

  console.log('[check-ads-sync-health] Ads sync health OK.');
}

main().catch((error) => {
  console.error('[check-ads-sync-health] FAILED:', error.message);
  process.exit(1);
});
