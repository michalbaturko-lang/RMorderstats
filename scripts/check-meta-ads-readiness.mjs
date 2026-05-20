#!/usr/bin/env node

/**
 * Read-only readiness check for Meta Ads access.
 *
 * This verifies the token/account configuration before the first Meta import:
 * token identity, configured account metadata and a tiny Insights request for
 * each requested level. It never writes to Supabase and never mutates Meta Ads.
 */

import {
  DEFAULT_FX_RATES,
  assertSupportedMarket,
  isAccountActiveForRange,
  normalizeMetaAccountId,
  parseJsonEnv,
  parseMarketFilter,
  resolveDateRange,
} from './lib/ads-sync-utils.mjs';

const DEFAULT_LEVELS = ['campaign', 'adset', 'ad', 'device', 'audience', 'geo', 'placement'];
const REQUIRED_FIELDS = ['market', 'accountId'];

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
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function requireMetaEnv(name, { required }) {
  const value = process.env[name];
  if (value) return value;
  if (!required) return '';
  throw new Error(`Missing required environment variable: ${name}`);
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return Math.round(toNumber(value)).toLocaleString('cs-CZ');
}

function formatMoney(value, currency) {
  return `${formatNumber(value)} ${currency || ''}`.trim();
}

async function fetchGraph({ apiVersion, path, params, accessToken }) {
  const endpoint = new URL(`https://graph.facebook.com/${apiVersion}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    endpoint.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  endpoint.searchParams.set('access_token', accessToken);

  const response = await fetch(endpoint);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meta API request failed (${response.status}) ${endpoint.pathname}: ${text}`);
  }
  return response.json();
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
    'spend',
    'impressions',
    'clicks',
    'actions',
    'action_values',
  ];

  const params = {
    fields: fields.join(','),
    level,
    time_range: { since: from, until: to },
    time_increment: 1,
    limit: 5,
    use_unified_attribution_setting: true,
  };

  if (breakdowns?.length) params.breakdowns = breakdowns.join(',');
  return params;
}

const LEVEL_QUERIES = {
  campaign: { required: true, level: 'campaign', breakdowns: [] },
  adset: { required: true, level: 'adset', breakdowns: [] },
  ad: { required: true, level: 'ad', breakdowns: [] },
  device: { required: true, level: 'campaign', breakdowns: ['impression_device'] },
  audience: { required: true, level: 'adset', breakdowns: ['age', 'gender'] },
  geo: { required: true, level: 'campaign', breakdowns: ['country'] },
  placement: { required: true, level: 'adset', breakdowns: ['publisher_platform', 'platform_position', 'impression_device'] },
};

function validateRawAccounts(rawAccounts) {
  if (!Array.isArray(rawAccounts) || !rawAccounts.length) {
    throw new Error('META_ADS_ACCOUNTS_JSON must be a non-empty JSON array.');
  }

  return rawAccounts.map((account, index) => {
    const missing = REQUIRED_FIELDS.filter((field) => !account[field] && !(field === 'accountId' && account.customerId));
    if (missing.length) {
      throw new Error(`META_ADS_ACCOUNTS_JSON[${index}] missing field(s): ${missing.join(', ')}`);
    }

    const normalized = {
      ...account,
      market: String(account.market || 'unknown').toLowerCase(),
      name: account.name || account.accountName || null,
      accountId: normalizeMetaAccountId(account.accountId || account.customerId),
    };
    assertSupportedMarket(normalized.market);
    if (!normalized.accountId) {
      throw new Error(`Invalid accountId in META_ADS_ACCOUNTS_JSON for market "${normalized.market}"`);
    }
    return normalized;
  });
}

function summarizeInsightRows(rows) {
  return rows.reduce((acc, row) => {
    acc.rows += 1;
    acc.spend += toNumber(row.spend);
    acc.impressions += toNumber(row.impressions);
    acc.clicks += toNumber(row.clicks);
    return acc;
  }, { rows: 0, spend: 0, impressions: 0, clicks: 0 });
}

async function main() {
  const requireSecrets = parseBooleanEnv('META_READINESS_REQUIRE_SECRETS', true);
  const accessToken = requireMetaEnv('META_ACCESS_TOKEN', { required: requireSecrets });
  const accountsJson = requireMetaEnv('META_ADS_ACCOUNTS_JSON', { required: requireSecrets });

  if (!accessToken || !accountsJson) {
    console.warn('[check-meta-ads-readiness] Missing Meta secrets. Add META_ACCESS_TOKEN and META_ADS_ACCOUNTS_JSON, then rerun with META_READINESS_REQUIRE_SECRETS=1.');
    return;
  }

  const apiVersion = process.env.META_GRAPH_API_VERSION || 'v24.0';
  const rawAccounts = parseJsonEnv('META_ADS_ACCOUNTS_JSON', []);
  const fxRates = parseJsonEnv('FX_RATES_JSON', DEFAULT_FX_RATES);
  const marketFilter = parseMarketFilter();
  const levels = parseCsv(process.env.META_READINESS_DETAIL_LEVELS || process.env.META_ADS_DETAIL_LEVELS, DEFAULT_LEVELS);
  const requireRows = parseBooleanEnv('META_READINESS_REQUIRE_INSIGHT_ROWS', false);
  const { from, to } = resolveDateRange();
  const warnings = [];
  const failures = [];

  const unsupportedLevels = levels.filter((level) => !LEVEL_QUERIES[level]);
  if (unsupportedLevels.length) {
    throw new Error(`Unsupported META_READINESS_DETAIL_LEVELS: ${unsupportedLevels.join(', ')}`);
  }

  const accounts = validateRawAccounts(rawAccounts).filter((account) => {
    if (marketFilter && !marketFilter.has(account.market)) return false;
    return isAccountActiveForRange(account, from, to);
  });

  if (!accounts.length) {
    throw new Error('No active Meta accounts match the selected date range/markets.');
  }

  console.log(`[check-meta-ads-readiness] Graph API: ${apiVersion}`);
  console.log(`[check-meta-ads-readiness] Range: ${from} -> ${to}`);
  console.log(`[check-meta-ads-readiness] Levels: ${levels.join(', ')}`);
  console.log(`[check-meta-ads-readiness] Accounts: ${accounts.length}`);

  try {
    const identity = await fetchGraph({
      apiVersion,
      path: 'me',
      params: { fields: 'id,name' },
      accessToken,
    });
    console.log(`[check-meta-ads-readiness] Token identity OK: ${identity.id || 'unknown'}${identity.name ? ` / ${identity.name}` : ''}`);
  } catch (error) {
    failures.push(`token identity: ${error.message}`);
  }

  for (const account of accounts) {
    let metaAccount = null;
    try {
      metaAccount = await fetchGraph({
        apiVersion,
        path: account.accountId,
        params: { fields: 'id,name,currency,timezone_name,account_status,disable_reason,business' },
        accessToken,
      });
      const currency = metaAccount.currency || account.currency || 'unknown';
      console.log([
        `[check-meta-ads-readiness] ${account.market.toUpperCase()} metadata OK`,
        `account=${metaAccount.id || account.accountId}`,
        `name=${metaAccount.name || account.name || 'unknown'}`,
        `currency=${currency}`,
        `timezone=${metaAccount.timezone_name || account.timezone || 'unknown'}`,
        `status=${metaAccount.account_status ?? 'unknown'}`,
      ].join(' | '));

      if (account.currency && metaAccount.currency && account.currency !== metaAccount.currency) {
        warnings.push(`${account.market.toUpperCase()} currency mismatch config=${account.currency} meta=${metaAccount.currency}`);
      }
      if (currency !== 'unknown' && fxRates[currency] == null) {
        failures.push(`${account.market.toUpperCase()} missing FX rate for ${currency}`);
      }
    } catch (error) {
      failures.push(`${account.market.toUpperCase()} metadata: ${error.message}`);
      continue;
    }

    for (const level of levels) {
      const config = LEVEL_QUERIES[level];
      try {
        const insight = await fetchGraph({
          apiVersion,
          path: `${account.accountId}/insights`,
          params: insightParams({ from, to, level: config.level, breakdowns: config.breakdowns }),
          accessToken,
        });
        const rows = Array.isArray(insight.data) ? insight.data : [];
        const summary = summarizeInsightRows(rows);
        const currency = metaAccount?.currency || account.currency || '';
        console.log([
          `[check-meta-ads-readiness] ${account.market.toUpperCase()} ${level} insights OK`,
          `rows=${formatNumber(summary.rows)}`,
          `spend=${formatMoney(summary.spend, currency)}`,
          `clicks=${formatNumber(summary.clicks)}`,
          `impressions=${formatNumber(summary.impressions)}`,
        ].join(' | '));
        if (requireRows && summary.rows === 0) {
          failures.push(`${account.market.toUpperCase()} ${level}: insights request returned no rows`);
        }
      } catch (error) {
        failures.push(`${account.market.toUpperCase()} ${level}: ${error.message}`);
      }
    }
  }

  if (warnings.length) {
    console.warn('[check-meta-ads-readiness] Warnings:');
    for (const warning of warnings) console.warn(`- ${warning}`);
  }

  if (failures.length) {
    console.error('[check-meta-ads-readiness] Failures:');
    for (const failure of failures) console.error(`- ${failure}`);
    throw new Error(`Meta readiness failed with ${failures.length} issue(s).`);
  }

  console.log('[check-meta-ads-readiness] Meta Ads readiness OK.');
}

main().catch((error) => {
  console.error('[check-meta-ads-readiness] FAILED:', error.message);
  process.exit(1);
});
