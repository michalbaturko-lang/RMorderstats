#!/usr/bin/env node

/**
 * Synchronizes detailed Meta Ads reporting into Supabase marketing tables.
 *
 * Required env vars:
 * - META_ACCESS_TOKEN
 * - META_ADS_ACCOUNTS_JSON (example: [{"market":"cz","accountId":"act_123"}])
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env vars:
 * - META_GRAPH_API_VERSION (default: v24.0)
 * - META_ADS_DETAIL_LEVELS (default: campaign,adset,ad,audience,geo,placement)
 * - SYNC_DAYS_BACK / SYNC_FROM_DATE / SYNC_TO_DATE / SYNC_MARKETS
 * - FX_RATES_JSON
 */

import {
  DEFAULT_FX_RATES,
  assertSupportedMarket,
  currencyToCzk,
  extractMetaActionStats,
  finishSyncRun,
  hashObject,
  insertRawInsights,
  isAccountActiveForRange,
  metricKey,
  nativeToMicros,
  normalizeActionStats,
  normalizeMetaAccountId,
  numberOrNull,
  parseJsonEnv,
  parseMarketFilter,
  requireEnv,
  resolveDateRange,
  roundMetric,
  roundMoney,
  startSyncRun,
  upsertSupabaseRows,
} from './lib/ads-sync-utils.mjs';

const PROVIDER = 'meta_ads';
const REQUIRED_ENV_VARS = ['META_ACCESS_TOKEN', 'META_ADS_ACCOUNTS_JSON', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const DEFAULT_LEVELS = ['campaign', 'adset', 'ad', 'audience', 'geo', 'placement'];
const PURCHASE_ACTIONS = [
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_conversion.purchase',
  'web_in_store_purchase',
];

function parseLevels() {
  const raw = process.env.META_ADS_DETAIL_LEVELS || DEFAULT_LEVELS.join(',');
  return new Set(
    raw
      .split(',')
      .map((level) => level.trim())
      .filter(Boolean),
  );
}

async function fetchGraph({ apiVersion, path, params }) {
  const endpoint = new URL(`https://graph.facebook.com/${apiVersion}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    endpoint.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  endpoint.searchParams.set('access_token', requireEnv('META_ACCESS_TOKEN'));

  const response = await fetch(endpoint);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meta API request failed (${response.status}) ${endpoint.pathname}: ${text}`);
  }
  return response.json();
}

async function fetchPagedGraph({ apiVersion, path, params }) {
  const first = await fetchGraph({ apiVersion, path, params });
  const rows = Array.isArray(first.data) ? [...first.data] : [];
  let next = first.paging?.next || null;

  while (next) {
    const response = await fetch(next);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Meta API paging request failed (${response.status}): ${text}`);
    }
    const json = await response.json();
    if (Array.isArray(json.data)) rows.push(...json.data);
    next = json.paging?.next || null;
  }

  return rows;
}

function insightParams({ from, to, level, breakdowns }) {
  const fields = [
    'account_id',
    'account_name',
    'campaign_id',
    'campaign_name',
    'adset_id',
    'adset_name',
    'ad_id',
    'ad_name',
    'objective',
    'buying_type',
    'spend',
    'impressions',
    'clicks',
    'inline_link_clicks',
    'reach',
    'frequency',
    'ctr',
    'cpc',
    'cpm',
    'actions',
    'action_values',
    'video_play_actions',
  ];

  const params = {
    fields: fields.join(','),
    level,
    time_range: { since: from, until: to },
    time_increment: 1,
    limit: 500,
    use_unified_attribution_setting: true,
  };

  if (breakdowns?.length) params.breakdowns = breakdowns.join(',');
  return params;
}

const LEVEL_QUERIES = {
  campaign: { required: true, level: 'campaign', breakdowns: [] },
  adset: { required: false, level: 'adset', breakdowns: [] },
  ad: { required: false, level: 'ad', breakdowns: [] },
  audience: { required: false, level: 'adset', breakdowns: ['age', 'gender'] },
  geo: { required: false, level: 'campaign', breakdowns: ['country'] },
  placement: { required: false, level: 'adset', breakdowns: ['publisher_platform', 'platform_position', 'impression_device'] },
};

function accountIdFromRow(row, account) {
  return normalizeMetaAccountId(row.account_id || account.accountId);
}

function dimensionsForLevel(level, row) {
  if (level === 'audience') {
    return {
      age: row.age || null,
      gender: row.gender || null,
    };
  }
  if (level === 'geo') {
    return {
      country: row.country || null,
    };
  }
  if (level === 'placement') {
    return {
      publisher_platform: row.publisher_platform || null,
      platform_position: row.platform_position || null,
      impression_device: row.impression_device || null,
    };
  }
  return {};
}

function metricLevel(level) {
  if (level === 'adset') return 'ad_group';
  if (level === 'audience') return 'audience';
  if (level === 'geo') return 'geo';
  if (level === 'placement') return 'placement';
  return level;
}

function buildMetricRow({ row, account, level, dimensions, fxRates, fetchedAt }) {
  const currency = account.currency || row.account_currency || 'CZK';
  const spendNative = numberOrNull(row.spend) ?? 0;
  const spendCzk = currencyToCzk(spendNative, currency, fxRates);
  const purchaseCount = extractMetaActionStats(row.actions, PURCHASE_ACTIONS) ?? 0;
  const purchaseValueNative = extractMetaActionStats(row.action_values, PURCHASE_ACTIONS) ?? 0;
  const averageOrderValueNative = purchaseCount > 0 ? purchaseValueNative / purchaseCount : null;
  const clicks = numberOrNull(row.clicks) ?? 0;
  const dimensionHash = hashObject(dimensions);
  const accountId = accountIdFromRow(row, account);

  return {
    metric_key: metricKey({
      provider: PROVIDER,
      accountId,
      market: account.market,
      date: row.date_start,
      level,
      campaignId: row.campaign_id || null,
      adGroupId: row.adset_id || null,
      adId: row.ad_id || null,
      dimensionHash,
    }),
    date: row.date_start,
    provider: PROVIDER,
    market: account.market,
    account_id: accountId,
    account_name: row.account_name || account.name || null,
    level: metricLevel(level),
    campaign_id: row.campaign_id || null,
    campaign_name: row.campaign_name || null,
    ad_group_id: row.adset_id || null,
    ad_group_name: row.adset_name || null,
    ad_id: row.ad_id || null,
    ad_name: row.ad_name || null,
    currency,
    spend_micros: nativeToMicros(spendNative),
    spend_native: roundMetric(spendNative),
    spend_czk: spendCzk,
    impressions: numberOrNull(row.impressions) ?? 0,
    clicks,
    interactions: numberOrNull(row.inline_link_clicks),
    reach: numberOrNull(row.reach),
    frequency: roundMetric(row.frequency),
    video_views: extractMetaActionStats(row.video_play_actions, ['video_view']),
    conversions: purchaseCount,
    conversion_value_native: roundMetric(purchaseValueNative),
    conversion_value_czk: currencyToCzk(purchaseValueNative, currency, fxRates),
    average_order_value_native: roundMetric(averageOrderValueNative),
    average_order_value_czk: averageOrderValueNative === null ? null : currencyToCzk(averageOrderValueNative, currency, fxRates),
    ctr: roundMetric(row.ctr, 8),
    cpc_czk: row.cpc ? currencyToCzk(row.cpc, currency, fxRates) : (clicks > 0 ? roundMoney(spendCzk / clicks) : null),
    cpm_czk: row.cpm ? currencyToCzk(row.cpm, currency, fxRates) : null,
    roas_platform: spendCzk > 0 ? roundMetric((currencyToCzk(purchaseValueNative, currency, fxRates) || 0) / spendCzk) : null,
    cost_per_conversion_czk: purchaseCount > 0 ? roundMoney(spendCzk / purchaseCount) : null,
    dimension_hash: dimensionHash,
    dimensions,
    actions: {
      actions: normalizeActionStats(row.actions),
      action_values: normalizeActionStats(row.action_values),
      video_play_actions: normalizeActionStats(row.video_play_actions),
    },
    raw_data: row,
    fetched_at: fetchedAt,
  };
}

function accountRow({ account, metaAccount, fetchedAt }) {
  return {
    provider: PROVIDER,
    market: account.market,
    account_id: account.accountId,
    account_name: metaAccount?.name || account.name || null,
    currency: metaAccount?.currency || account.currency || null,
    timezone: metaAccount?.timezone_name || account.timezone || null,
    enabled: account.enabled !== false,
    active_from: account.activeFrom || account.active_from || null,
    active_to: account.activeTo || account.active_to || null,
    raw_data: { config: account, meta: metaAccount || null },
    fetched_at: fetchedAt,
  };
}

function campaignEntityRow({ row, account, fetchedAt }) {
  if (!row.campaign_id) return null;
  return {
    provider: PROVIDER,
    market: account.market,
    account_id: accountIdFromRow(row, account),
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name || null,
    objective: row.objective || null,
    raw_data: row,
    fetched_at: fetchedAt,
  };
}

function adGroupEntityRow({ row, account, fetchedAt }) {
  if (!row.adset_id) return null;
  return {
    provider: PROVIDER,
    market: account.market,
    account_id: accountIdFromRow(row, account),
    campaign_id: row.campaign_id || null,
    ad_group_id: row.adset_id,
    ad_group_name: row.adset_name || null,
    group_type: 'adset',
    raw_data: row,
    fetched_at: fetchedAt,
  };
}

function adEntityRow({ row, account, fetchedAt }) {
  if (!row.ad_id) return null;
  return {
    provider: PROVIDER,
    market: account.market,
    account_id: accountIdFromRow(row, account),
    campaign_id: row.campaign_id || null,
    ad_group_id: row.adset_id || null,
    ad_id: row.ad_id,
    ad_name: row.ad_name || null,
    raw_data: row,
    fetched_at: fetchedAt,
  };
}

function rawInsightRow({ row, account, level, fetchedAt }) {
  const dimensions = dimensionsForLevel(level, row);
  return {
    raw_key: metricKey({
      provider: PROVIDER,
      accountId: accountIdFromRow(row, account),
      market: account.market,
      resource: level,
      dateStart: row.date_start,
      dateStop: row.date_stop,
      campaignId: row.campaign_id || null,
      adGroupId: row.adset_id || null,
      adId: row.ad_id || null,
      dimensionHash: hashObject(dimensions),
    }),
    provider: PROVIDER,
    market: account.market,
    account_id: accountIdFromRow(row, account),
    resource: level,
    date_start: row.date_start || null,
    date_stop: row.date_stop || null,
    raw_data: row,
    fetched_at: fetchedAt,
  };
}

async function main() {
  for (const name of REQUIRED_ENV_VARS) requireEnv(name);

  const apiVersion = process.env.META_GRAPH_API_VERSION || 'v24.0';
  const rawAccounts = parseJsonEnv('META_ADS_ACCOUNTS_JSON', []);
  const fxRates = parseJsonEnv('FX_RATES_JSON', DEFAULT_FX_RATES);
  const marketFilter = parseMarketFilter();
  const levels = parseLevels();
  const { from, to } = resolveDateRange();
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const syncRunId = await startSyncRun({
    provider: PROVIDER,
    syncType: `detail:${Array.from(levels).join(',')}`,
    from,
    to,
    supabaseUrl,
    serviceRoleKey,
  });

  let rowsUpserted = 0;
  const warnings = [];

  try {
    if (!Array.isArray(rawAccounts) || !rawAccounts.length) {
      throw new Error('META_ADS_ACCOUNTS_JSON must be a non-empty JSON array');
    }

    const accounts = rawAccounts
      .map((account) => ({
        ...account,
        market: String(account.market || 'unknown').toLowerCase(),
        name: account.name || account.accountName || null,
        accountId: normalizeMetaAccountId(account.accountId || account.customerId),
      }))
      .filter((account) => {
        if (!account.accountId) {
          throw new Error(`Invalid accountId in META_ADS_ACCOUNTS_JSON for market "${account.market}"`);
        }
        assertSupportedMarket(account.market);
        if (marketFilter && !marketFilter.has(account.market)) return false;
        return isAccountActiveForRange(account, from, to);
      });

    if (!accounts.length) {
      console.log('[sync-meta-ads-detail] No active accounts for selected date range. Nothing to sync.');
      await finishSyncRun({ id: syncRunId, status: 'success', rowsUpserted, warnings, supabaseUrl, serviceRoleKey });
      return;
    }

    console.log(`[sync-meta-ads-detail] Start sync ${from} -> ${to} (${accounts.length} account(s))`);
    const fetchedAt = new Date().toISOString();

    const accountRows = [];
    const campaignRowsByKey = new Map();
    const adGroupRowsByKey = new Map();
    const adRowsByKey = new Map();
    const metricRows = [];
    const rawRows = [];

    for (const account of accounts) {
      let metaAccount = null;
      try {
        metaAccount = await fetchGraph({
          apiVersion,
          path: account.accountId,
          params: { fields: 'id,name,currency,timezone_name,account_status' },
        });
      } catch (error) {
        warnings.push(`${account.market.toUpperCase()} account metadata: ${error.message}`);
      }
      accountRows.push(accountRow({ account, metaAccount, fetchedAt }));

      for (const [level, config] of Object.entries(LEVEL_QUERIES)) {
        if (!levels.has(level)) continue;

        try {
          const rows = await fetchPagedGraph({
            apiVersion,
            path: `${account.accountId}/insights`,
            params: insightParams({ from, to, level: config.level, breakdowns: config.breakdowns }),
          });

          for (const row of rows) {
            if (!row.date_start) continue;
            const dimensions = dimensionsForLevel(level, row);
            metricRows.push(buildMetricRow({ row, account: { ...account, currency: metaAccount?.currency || account.currency }, level, dimensions, fxRates, fetchedAt }));
            rawRows.push(rawInsightRow({ row, account, level, fetchedAt }));

            const campaign = campaignEntityRow({ row, account, fetchedAt });
            if (campaign) campaignRowsByKey.set(`${campaign.provider}:${campaign.account_id}:${campaign.campaign_id}`, campaign);

            const adGroup = adGroupEntityRow({ row, account, fetchedAt });
            if (adGroup) adGroupRowsByKey.set(`${adGroup.provider}:${adGroup.account_id}:${adGroup.ad_group_id}`, adGroup);

            const ad = adEntityRow({ row, account, fetchedAt });
            if (ad) adRowsByKey.set(`${ad.provider}:${ad.account_id}:${ad.ad_id}`, ad);
          }

          console.log(`[sync-meta-ads-detail] ${account.market.toUpperCase()} ${level}: ${rows.length} rows`);
        } catch (error) {
          const message = `${account.market.toUpperCase()} ${level}: ${error.message}`;
          if (config.required) throw new Error(message);
          warnings.push(message);
          console.warn(`[sync-meta-ads-detail] Optional level failed: ${message}`);
        }
      }
    }

    rowsUpserted += await upsertSupabaseRows({
      rows: accountRows,
      supabaseUrl,
      serviceRoleKey,
      table: 'ad_accounts',
      onConflict: 'provider,account_id',
    });
    rowsUpserted += await upsertSupabaseRows({
      rows: Array.from(campaignRowsByKey.values()),
      supabaseUrl,
      serviceRoleKey,
      table: 'ad_campaigns',
      onConflict: 'provider,account_id,campaign_id',
    });
    rowsUpserted += await upsertSupabaseRows({
      rows: Array.from(adGroupRowsByKey.values()),
      supabaseUrl,
      serviceRoleKey,
      table: 'ad_groups',
      onConflict: 'provider,account_id,ad_group_id',
    });
    rowsUpserted += await upsertSupabaseRows({
      rows: Array.from(adRowsByKey.values()),
      supabaseUrl,
      serviceRoleKey,
      table: 'ad_ads',
      onConflict: 'provider,account_id,ad_id',
    });
    rowsUpserted += await upsertSupabaseRows({
      rows: metricRows,
      supabaseUrl,
      serviceRoleKey,
      table: 'ad_metrics_daily',
      onConflict: 'metric_key',
    });
    rowsUpserted += await insertRawInsights({ rows: rawRows, supabaseUrl, serviceRoleKey });

    const status = warnings.length ? 'partial_success' : 'success';
    await finishSyncRun({ id: syncRunId, status, rowsUpserted, warnings, supabaseUrl, serviceRoleKey });
    console.log(`[sync-meta-ads-detail] Upserted rows: ${rowsUpserted}`);
    console.log('[sync-meta-ads-detail] Done');
  } catch (error) {
    await finishSyncRun({
      id: syncRunId,
      status: 'failed',
      rowsUpserted,
      warnings,
      errorMessage: error.message,
      supabaseUrl,
      serviceRoleKey,
    });
    throw error;
  }
}

main().catch((error) => {
  console.error('[sync-meta-ads-detail] FAILED:', error.message);
  process.exit(1);
});
