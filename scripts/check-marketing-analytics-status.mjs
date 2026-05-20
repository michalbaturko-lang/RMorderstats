#!/usr/bin/env node

/**
 * Read-only operational status for the marketing analytics stack.
 *
 * This does not call Google Ads or Meta APIs and it never writes to Supabase.
 * It checks which tables/views are available, whether credentials are present
 * in the runtime, and whether Supabase already contains current and historical
 * marketing rows for the expected providers and markets.
 */

import { appendFile } from 'node:fs/promises';

import {
  requireEnv,
  supabaseRequest,
  toDateString,
} from './lib/ads-sync-utils.mjs';

const DEFAULT_PROVIDERS = ['google_ads', 'meta_ads'];
const DEFAULT_MARKETS = ['cz', 'sk', 'hu', 'ro'];
const DEFAULT_DETAIL_LEVELS = [
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
const DEFAULT_GOOGLE_DETAIL_LEVELS = [
  'campaign',
  'device',
  'hour',
  'ad_group',
  'ad',
  'keyword',
  'search_term',
  'shopping_product',
  'asset_group',
  'geo',
  'conversion_action',
];
const CORE_RELATIONS = [
  'ad_accounts',
  'ad_campaigns',
  'ad_groups',
  'ad_ads',
  'ad_metrics_daily',
  'ad_raw_insights',
  'ad_sync_runs',
  'marketing_daily_summary',
  'marketing_campaign_daily_summary',
];
const BUSINESS_VIEWS = [
  'order_business_daily_summary',
  'marketing_business_provider_daily_summary',
  'marketing_business_daily_total',
];

function parseCsv(value, fallback) {
  const values = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : fallback;
}

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[marketing-status] ${name}: invalid JSON (${error.message})`);
    return fallback;
  }
}

function parseBooleanEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no'].includes(String(value).toLowerCase());
}

function parseNumberEnv(name, fallback) {
  const number = Number(process.env[name] || fallback);
  return Number.isFinite(number) && number > 0 ? number : fallback;
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

function formatAgeMinutes(value) {
  return Number.isFinite(value) ? value.toFixed(1) : 'n/a';
}

function todayUtc() {
  return toDateString(new Date());
}

function defaultHealthDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return toDateString(date);
}

function defaultYearStart() {
  const today = new Date();
  return `${today.getUTCFullYear()}-01-01`;
}

function ageMinutes(value, now = new Date()) {
  const timestamp = new Date(value || 0).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return Number.POSITIVE_INFINITY;
  return (now.getTime() - timestamp) / 60000;
}

function isMissingRelationError(error) {
  return /PGRST205|could not find the table|relation .* does not exist|schema cache/i.test(String(error?.message || ''));
}

function secretNamesStatus(names) {
  const missing = names.filter((name) => !process.env[name]);
  return {
    ok: missing.length === 0,
    missing,
  };
}

function googleAuthStatus() {
  const base = secretNamesStatus([
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_ACCOUNTS_JSON',
  ]);
  const directOauth = secretNamesStatus([
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN',
  ]);
  const base44Broker = secretNamesStatus([
    'GOOGLE_ADS_BASE44_APP_ID',
    'GOOGLE_ADS_BASE44_ACCESS_TOKEN',
    'GOOGLE_ADS_BASE44_TOKEN_ACCOUNT_ID',
  ]);

  return {
    ok: base.ok && (directOauth.ok || base44Broker.ok),
    missing: [
      ...base.missing,
      ...(directOauth.ok || base44Broker.ok ? [] : ['GOOGLE_ADS OAuth or Base44 token broker secrets']),
    ],
  };
}

function metaAuthStatus() {
  return secretNamesStatus([
    'META_ACCESS_TOKEN',
    'META_ADS_ACCOUNTS_JSON',
  ]);
}

async function relationStatus({ supabaseUrl, serviceRoleKey, relation }) {
  try {
    await supabaseRequest({
      supabaseUrl,
      serviceRoleKey,
      path: `/rest/v1/${relation}`,
      searchParams: { select: '*', limit: 1 },
    });
    return { relation, status: 'ok' };
  } catch (error) {
    return {
      relation,
      status: isMissingRelationError(error) ? 'missing' : 'error',
      error: error.message,
    };
  }
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

async function fetchAllRowsWithRange({ supabaseUrl, serviceRoleKey, table, select, filters = {}, orderBy }) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const searchParams = { select, ...filters };
    if (orderBy) searchParams.order = orderBy;

    const chunk = await supabaseRequest({
      supabaseUrl,
      serviceRoleKey,
      path: `/rest/v1/${table}`,
      searchParams,
      headers: { Range: `${from}-${from + pageSize - 1}` },
      prefer: 'count=exact',
    });

    const pageRows = Array.isArray(chunk) ? chunk : [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }

  return rows;
}

function summarizeCampaignRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.provider}:${row.market}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        provider: row.provider,
        market: row.market,
        rows: 0,
        days: new Set(),
        firstDate: null,
        lastDate: null,
        spend: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
        conversionValue: 0,
      });
    }
    const target = byKey.get(key);
    target.rows += 1;
    target.spend += toNumber(row.spend_czk);
    target.clicks += toNumber(row.clicks);
    target.impressions += toNumber(row.impressions);
    target.conversions += toNumber(row.conversions);
    target.conversionValue += toNumber(row.conversion_value_czk);
    if (row.date) {
      target.days.add(row.date);
      target.firstDate = !target.firstDate || row.date < target.firstDate ? row.date : target.firstDate;
      target.lastDate = !target.lastDate || row.date > target.lastDate ? row.date : target.lastDate;
    }
  }

  return Array.from(byKey.values()).map((row) => ({
    ...row,
    days: row.days.size,
  }));
}

function summarizeDetailRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.provider}:${row.market}:${row.level}`;
    byKey.set(key, toNumber(byKey.get(key)) + 1);
  }
  return byKey;
}

function syncTypeLevels(syncType) {
  const [, rawLevels = ''] = String(syncType || '').split(':');
  return rawLevels.split(',').map((level) => level.trim()).filter(Boolean);
}

function isActiveForRange(account, from, to) {
  const activeFrom = account.activeFrom || account.active_from || null;
  const activeTo = account.activeTo || account.active_to || null;
  if (activeFrom && activeFrom > to) return false;
  if (activeTo && activeTo < from) return false;
  return true;
}

function googleAccountsForEstimate(markets, from, to) {
  const marketFilter = new Set(markets.map((market) => String(market).toLowerCase()));
  const accounts = parseJsonEnv('GOOGLE_ADS_ACCOUNTS_JSON', []);
  if (!Array.isArray(accounts)) return [];

  return accounts
    .map((account) => ({
      ...account,
      market: String(account.market || 'unknown').toLowerCase(),
      customerId: account.customerId || account.accountId || '',
    }))
    .filter((account) => (
      account.enabled !== false &&
      account.customerId &&
      marketFilter.has(account.market) &&
      isActiveForRange(account, from, to)
    ));
}

function estimateGoogleAdsApiOperations({ markets, from, to }) {
  const accounts = googleAccountsForEstimate(markets, from, to);
  const spendLevels = parseCsv(process.env.MARKETING_STATUS_GOOGLE_SPEND_LEVELS, ['campaign']);
  const detailLevels = parseCsv(process.env.GOOGLE_ADS_DETAIL_LEVELS, DEFAULT_GOOGLE_DETAIL_LEVELS);
  const spendRunsPerDay = parseNumberEnv('MARKETING_STATUS_GOOGLE_SPEND_RUNS_PER_DAY', 96);
  const detailRunsPerDay = parseNumberEnv('MARKETING_STATUS_GOOGLE_DETAIL_RUNS_PER_DAY', 1);
  const dailyLimit = parseNumberEnv('MARKETING_STATUS_GOOGLE_DAILY_OPERATION_LIMIT', 2880);
  const spendOpsPerRun = accounts.length * spendLevels.length;
  const detailOpsPerRun = accounts.length * detailLevels.length;
  const spendOpsPerDay = spendOpsPerRun * spendRunsPerDay;
  const detailOpsPerDay = detailOpsPerRun * detailRunsPerDay;
  const totalOpsPerDay = spendOpsPerDay + detailOpsPerDay;
  const utilizationPct = dailyLimit ? (totalOpsPerDay / dailyLimit) * 100 : 0;

  return {
    accounts,
    spendLevels,
    detailLevels,
    spendRunsPerDay,
    detailRunsPerDay,
    dailyLimit,
    spendOpsPerRun,
    detailOpsPerRun,
    spendOpsPerDay,
    detailOpsPerDay,
    totalOpsPerDay,
    utilizationPct,
  };
}

function isDeepDetailRun(run) {
  if (!String(run.sync_type || '').startsWith('detail:')) return false;
  return syncTypeLevels(run.sync_type).some((level) => level !== 'campaign');
}

function latestProviderRun(runs, provider, level) {
  return (runs || []).find((run) => (
    run.provider === provider &&
    String(run.sync_type || '').includes(level)
  ));
}

function latestProviderDeepDetailRun(runs, provider) {
  return (runs || []).find((run) => run.provider === provider && isDeepDetailRun(run));
}

function runTimestamp(run) {
  return run?.finished_at || run?.started_at || '';
}

function printSecretStatus(label, status, blockers) {
  if (status.ok) {
    console.log(`[marketing-status] ${label}: OK`);
    return;
  }

  console.log(`[marketing-status] ${label}: MISSING ${status.missing.join(', ')}`);
  blockers.push(`${label}: missing ${status.missing.join(', ')}`);
}

function printRelationStatuses(label, statuses, blockers) {
  console.log(`[marketing-status] ${label}:`);
  for (const row of statuses) {
    console.log(`[marketing-status] - ${row.relation}: ${row.status}`);
    if (row.status !== 'ok') blockers.push(`${row.relation}: ${row.status}`);
  }
}

function printLatestRuns(runs, providers) {
  const now = new Date();
  for (const provider of providers) {
    const campaignRun = latestProviderRun(runs, provider, 'campaign');
    const detailRun = latestProviderDeepDetailRun(runs, provider);

    if (campaignRun) {
      const age = ageMinutes(campaignRun.finished_at || campaignRun.started_at, now);
      console.log([
        `[marketing-status] latest ${provider} campaign`,
        `status=${campaignRun.status}`,
        `sync_type=${campaignRun.sync_type}`,
        `range=${campaignRun.range_from}..${campaignRun.range_to}`,
        `rows=${formatNumber(campaignRun.rows_upserted)}`,
        `age_minutes=${Number.isFinite(age) ? age.toFixed(1) : 'n/a'}`,
      ].join(' | '));
    } else {
      console.log(`[marketing-status] latest ${provider} campaign: missing`);
    }

    if (detailRun) {
      const age = ageMinutes(detailRun.finished_at || detailRun.started_at, now);
      console.log([
        `[marketing-status] latest ${provider} deep detail`,
        `status=${detailRun.status}`,
        `sync_type=${detailRun.sync_type}`,
        `range=${detailRun.range_from}..${detailRun.range_to}`,
        `rows=${formatNumber(detailRun.rows_upserted)}`,
        `age_minutes=${Number.isFinite(age) ? age.toFixed(1) : 'n/a'}`,
      ].join(' | '));
    } else {
      console.log(`[marketing-status] latest ${provider} deep detail: missing`);
    }
  }
}

function printCampaignSyncFreshness(runs, providers, blockers, { maxAgeMinutes, enforceProviders }) {
  const now = new Date();
  const enforced = new Set(enforceProviders);
  const rows = [];

  console.log(`[marketing-status] Campaign sync freshness threshold: ${formatNumber(maxAgeMinutes)} minutes`);

  for (const provider of providers) {
    const run = latestProviderRun(runs, provider, 'campaign');
    const age = run ? ageMinutes(runTimestamp(run), now) : Number.POSITIVE_INFINITY;
    const shouldEnforce = enforced.has(provider);
    const statusOk = run?.status === 'success';
    const fresh = Boolean(run && statusOk && age <= maxAgeMinutes);
    const row = {
      provider,
      status: run?.status || 'missing',
      syncType: run?.sync_type || 'missing',
      range: run ? `${run.range_from}..${run.range_to}` : 'n/a',
      rowsUpserted: toNumber(run?.rows_upserted),
      ageMinutes: Number.isFinite(age) ? age : null,
      thresholdMinutes: maxAgeMinutes,
      fresh,
      enforced: shouldEnforce,
    };
    rows.push(row);

    console.log([
      `[marketing-status] campaign freshness ${provider}`,
      `status=${row.status}`,
      `sync_type=${row.syncType}`,
      `range=${row.range}`,
      `rows=${formatNumber(row.rowsUpserted)}`,
      `age_minutes=${formatAgeMinutes(age)}`,
      `threshold_minutes=${formatNumber(maxAgeMinutes)}`,
      `fresh=${fresh ? 'yes' : 'no'}`,
      `enforced=${shouldEnforce ? 'yes' : 'no'}`,
    ].join(' | '));

    if (!shouldEnforce) continue;
    if (!run) {
      blockers.push(`${provider}: no campaign spend sync run`);
    } else if (!statusOk) {
      blockers.push(`${provider}: latest campaign spend sync status is ${run.status}`);
    } else if (age > maxAgeMinutes) {
      blockers.push(`${provider}: campaign spend sync stale (${formatAgeMinutes(age)} min > ${formatNumber(maxAgeMinutes)} min)`);
    }
  }

  return rows;
}

function printCampaignCoverage(summary, providers, markets, blockers, { label, requireRows }) {
  console.log(`[marketing-status] Campaign coverage: ${label}`);
  for (const provider of providers) {
    for (const market of markets) {
      const row = summary.find((item) => item.provider === provider && item.market === market);
      console.log([
        `[marketing-status] ${provider}/${market.toUpperCase()}`,
        `rows=${formatNumber(row?.rows || 0)}`,
        `days=${formatNumber(row?.days || 0)}`,
        `data=${row?.firstDate || 'n/a'}..${row?.lastDate || 'n/a'}`,
        `spend=${formatCurrency(row?.spend || 0)}`,
        `clicks=${formatNumber(row?.clicks || 0)}`,
        `conversions=${formatNumber(row?.conversions || 0)}`,
      ].join(' | '));

      if (requireRows && provider === 'google_ads' && !row) {
        blockers.push(`${provider}/${market}: no current campaign rows`);
      }
    }
  }
}

function printDetailCoverage(summary, providers, markets, levels) {
  console.log(`[marketing-status] Detail rows by level:`);
  for (const provider of providers) {
    for (const market of markets) {
      const populated = levels
        .map((level) => `${level}:${formatNumber(summary.get(`${provider}:${market}:${level}`) || 0)}`)
        .join(', ');
      console.log(`[marketing-status] ${provider}/${market.toUpperCase()} | ${populated}`);
    }
  }
}

function printGoogleApiBudgetEstimate(estimate, blockers) {
  console.log([
    '[marketing-status] Google Ads API budget estimate',
    `accounts=${formatNumber(estimate.accounts.length)}`,
    `spend_levels=${estimate.spendLevels.join(',')}`,
    `detail_levels=${estimate.detailLevels.join(',')}`,
    `spend_runs_per_day=${formatNumber(estimate.spendRunsPerDay)}`,
    `detail_runs_per_day=${formatNumber(estimate.detailRunsPerDay)}`,
    `spend_ops_per_day=${formatNumber(estimate.spendOpsPerDay)}`,
    `detail_ops_per_day=${formatNumber(estimate.detailOpsPerDay)}`,
    `total_ops_per_day=${formatNumber(estimate.totalOpsPerDay)}`,
    `daily_limit=${formatNumber(estimate.dailyLimit)}`,
    `utilization=${estimate.utilizationPct.toFixed(1)}%`,
  ].join(' | '));

  if (!estimate.accounts.length) {
    console.log('[marketing-status] Google Ads API budget estimate: no active accounts in GOOGLE_ADS_ACCOUNTS_JSON for selected markets/range');
    return;
  }

  if (estimate.utilizationPct > 85) {
    blockers.push(`Google Ads API budget: estimated ${estimate.totalOpsPerDay} ops/day is ${estimate.utilizationPct.toFixed(1)}% of limit ${estimate.dailyLimit}`);
  }
}

function escapeMarkdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.map(escapeMarkdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`),
  ].join('\n');
}

function findCampaignSummary(summary, provider, market) {
  return summary.find((item) => item.provider === provider && item.market === market);
}

function relationMarkdownRows(statuses) {
  return statuses.map((row) => [
    row.relation,
    row.status === 'ok' ? 'OK' : row.status,
  ]);
}

function campaignCoverageMarkdownRows(summary, providers, markets) {
  const rows = [];
  for (const provider of providers) {
    for (const market of markets) {
      const row = findCampaignSummary(summary, provider, market);
      rows.push([
        `${provider}/${market.toUpperCase()}`,
        formatNumber(row?.rows || 0),
        formatNumber(row?.days || 0),
        `${row?.firstDate || 'n/a'}..${row?.lastDate || 'n/a'}`,
        formatCurrency(row?.spend || 0),
        formatNumber(row?.clicks || 0),
        formatNumber(row?.conversions || 0),
      ]);
    }
  }
  return rows;
}

function googleApiBudgetMarkdownRows(estimate) {
  return [
    ['Active accounts', formatNumber(estimate.accounts.length)],
    ['Spend sync ops / run', formatNumber(estimate.spendOpsPerRun)],
    ['Spend sync runs / day', formatNumber(estimate.spendRunsPerDay)],
    ['Spend ops / day', formatNumber(estimate.spendOpsPerDay)],
    ['Detail sync ops / run', formatNumber(estimate.detailOpsPerRun)],
    ['Detail sync runs / day', formatNumber(estimate.detailRunsPerDay)],
    ['Detail ops / day', formatNumber(estimate.detailOpsPerDay)],
    ['Estimated total ops / day', formatNumber(estimate.totalOpsPerDay)],
    ['Configured daily limit', formatNumber(estimate.dailyLimit)],
    ['Estimated utilization', `${estimate.utilizationPct.toFixed(1)} %`],
  ];
}

async function writeGithubSummary({
  from,
  to,
  healthDate,
  providers,
  markets,
  maxCampaignAgeMinutes,
  freshnessRows,
  coreStatuses,
  businessStatuses,
  currentCampaignSummary,
  historicalCampaignSummary,
  googleApiBudget,
  blockers,
}) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;

  const lines = [
    '## Marketing Analytics Status',
    '',
    `Range: \`${from}\` -> \`${to}\`  `,
    `Health date: \`${healthDate}\`  `,
    `Providers: \`${providers.join(', ')}\`  `,
    `Markets: \`${markets.join(', ')}\``,
    '',
    '### Campaign Spend Sync Freshness',
    '',
    markdownTable(
      ['Provider', 'Status', 'Fresh', 'Age min', 'Threshold min', 'Range', 'Rows', 'Enforced'],
      freshnessRows.map((row) => [
        row.provider,
        row.status,
        row.fresh ? 'yes' : 'no',
        row.ageMinutes == null ? 'n/a' : row.ageMinutes.toFixed(1),
        maxCampaignAgeMinutes,
        row.range,
        formatNumber(row.rowsUpserted),
        row.enforced ? 'yes' : 'no',
      ]),
    ),
    '',
    '### Current Campaign Spend',
    '',
    markdownTable(
      ['Provider / Market', 'Rows', 'Days', 'Data range', 'Spend', 'Clicks', 'Conversions'],
      campaignCoverageMarkdownRows(currentCampaignSummary, providers, markets),
    ),
    '',
    '### Historical Campaign Spend',
    '',
    markdownTable(
      ['Provider / Market', 'Rows', 'Days', 'Data range', 'Spend', 'Clicks', 'Conversions'],
      campaignCoverageMarkdownRows(historicalCampaignSummary, providers, markets),
    ),
    '',
    '### Google Ads API Operation Budget',
    '',
    markdownTable(['Metric', 'Value'], googleApiBudgetMarkdownRows(googleApiBudget)),
    '',
    '### Supabase Relations',
    '',
    markdownTable(['Relation', 'Status'], relationMarkdownRows(coreStatuses)),
    '',
    '### Business Views',
    '',
    markdownTable(['View', 'Status'], relationMarkdownRows(businessStatuses)),
    '',
    '### Blockers',
    '',
    blockers.length
      ? blockers.map((blocker) => `- ${blocker}`).join('\n')
      : '- none',
    '',
  ];

  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

function printHelp() {
  console.log(`
Usage:
  node scripts/check-marketing-analytics-status.mjs

Env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  MARKETING_STATUS_PROVIDERS=google_ads,meta_ads
  MARKETING_STATUS_MARKETS=cz,sk,hu,ro
  MARKETING_STATUS_FROM_DATE=YYYY-MM-DD
  MARKETING_STATUS_TO_DATE=YYYY-MM-DD
  MARKETING_STATUS_HEALTH_DATE=YYYY-MM-DD
  MARKETING_STATUS_REQUIRE_COMPLETE=0
  MARKETING_STATUS_MAX_CAMPAIGN_AGE_MINUTES=45
  MARKETING_STATUS_GOOGLE_DAILY_OPERATION_LIMIT=2880
  MARKETING_STATUS_GOOGLE_SPEND_RUNS_PER_DAY=96
  MARKETING_STATUS_GOOGLE_DETAIL_RUNS_PER_DAY=1
`);
}

async function main() {
  if (process.argv.includes('--help')) {
    printHelp();
    return;
  }

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const providers = parseCsv(process.env.MARKETING_STATUS_PROVIDERS, DEFAULT_PROVIDERS);
  const markets = parseCsv(process.env.MARKETING_STATUS_MARKETS || process.env.SYNC_MARKETS, DEFAULT_MARKETS);
  const detailLevels = parseCsv(process.env.MARKETING_STATUS_DETAIL_LEVELS, DEFAULT_DETAIL_LEVELS)
    .filter((level) => level !== 'campaign');
  const from = process.env.MARKETING_STATUS_FROM_DATE || defaultYearStart();
  const to = process.env.MARKETING_STATUS_TO_DATE || todayUtc();
  const healthDate = process.env.MARKETING_STATUS_HEALTH_DATE || defaultHealthDate();
  const requireComplete = parseBooleanEnv('MARKETING_STATUS_REQUIRE_COMPLETE', false);
  const maxCampaignAgeMinutes = parseNumberEnv('MARKETING_STATUS_MAX_CAMPAIGN_AGE_MINUTES', 45);
  const blockers = [];

  console.log(`[marketing-status] Range: ${from} -> ${to}`);
  console.log(`[marketing-status] Health date: ${healthDate}`);
  console.log(`[marketing-status] Providers: ${providers.join(', ')}`);
  console.log(`[marketing-status] Markets: ${markets.join(', ')}`);

  const supabaseSecrets = secretNamesStatus(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  const dbApplySecrets = secretNamesStatus(['SUPABASE_DB_URL']);
  const googleSecrets = googleAuthStatus();
  const metaSecrets = metaAuthStatus();
  printSecretStatus('Supabase service credentials', supabaseSecrets, blockers);
  printSecretStatus('Supabase DB apply secret', dbApplySecrets, blockers);
  printSecretStatus('Google Ads read-only credentials', googleSecrets, blockers);
  printSecretStatus('Meta Ads read-only credentials', metaSecrets, blockers);
  const googleApiBudget = estimateGoogleAdsApiOperations({ markets, from, to });
  printGoogleApiBudgetEstimate(googleApiBudget, blockers);

  const coreStatuses = await Promise.all(CORE_RELATIONS.map((relation) => relationStatus({ supabaseUrl, serviceRoleKey, relation })));
  const businessStatuses = await Promise.all(BUSINESS_VIEWS.map((relation) => relationStatus({ supabaseUrl, serviceRoleKey, relation })));
  printRelationStatuses('Core Supabase relations', coreStatuses, blockers);
  printRelationStatuses('Business Supabase views', businessStatuses, blockers);

  const runs = await fetchRows({
    supabaseUrl,
    serviceRoleKey,
    table: 'ad_sync_runs',
    select: 'provider,sync_type,range_from,range_to,status,rows_upserted,warnings,error_message,started_at,finished_at',
    filters: { provider: `in.(${providers.join(',')})` },
    orderBy: 'started_at.desc',
    limit: 100,
  });
  printLatestRuns(runs || [], providers);
  const freshnessRows = printCampaignSyncFreshness(runs || [], providers, blockers, {
    maxAgeMinutes: maxCampaignAgeMinutes,
    enforceProviders: providers.filter((provider) => provider === 'google_ads' || (provider === 'meta_ads' && metaSecrets.ok)),
  });

  const currentCampaignRows = await fetchAllRowsWithRange({
    supabaseUrl,
    serviceRoleKey,
    table: 'ad_metrics_daily',
    select: 'date,provider,market,level,spend_czk,clicks,impressions,conversions,conversion_value_czk',
    filters: {
      date: `eq.${healthDate}`,
      provider: `in.(${providers.join(',')})`,
      market: `in.(${markets.join(',')})`,
      level: 'eq.campaign',
    },
    orderBy: 'provider.asc,market.asc,date.asc',
  });
  const currentCampaignSummary = summarizeCampaignRows(currentCampaignRows);
  printCampaignCoverage(currentCampaignSummary, providers, markets, blockers, {
    label: healthDate,
    requireRows: true,
  });

  const historicalCampaignRows = await fetchAllRowsWithRange({
    supabaseUrl,
    serviceRoleKey,
    table: 'ad_metrics_daily',
    select: 'date,provider,market,level,spend_czk,clicks,impressions,conversions,conversion_value_czk',
    filters: {
      date: [`gte.${from}`, `lte.${to}`],
      provider: `in.(${providers.join(',')})`,
      market: `in.(${markets.join(',')})`,
      level: 'eq.campaign',
    },
    orderBy: 'provider.asc,market.asc,date.asc',
  });
  const historicalCampaignSummary = summarizeCampaignRows(historicalCampaignRows);
  printCampaignCoverage(historicalCampaignSummary, providers, markets, blockers, {
    label: `${from}..${to}`,
    requireRows: false,
  });

  const detailRows = await fetchAllRowsWithRange({
    supabaseUrl,
    serviceRoleKey,
    table: 'ad_metrics_daily',
    select: 'date,provider,market,level',
    filters: {
      date: `eq.${healthDate}`,
      provider: `in.(${providers.join(',')})`,
      market: `in.(${markets.join(',')})`,
      level: `in.(${detailLevels.join(',')})`,
    },
    orderBy: 'provider.asc,market.asc,level.asc',
  });
  printDetailCoverage(summarizeDetailRows(detailRows), providers, markets, detailLevels);

  const uniqueHistoricalProviders = new Set(historicalCampaignRows.map((row) => row.provider));
  const metaExpected = providers.includes('meta_ads');
  if (metaExpected && !uniqueHistoricalProviders.has('meta_ads')) {
    blockers.push('meta_ads: no historical campaign rows yet');
  }

  await writeGithubSummary({
    from,
    to,
    healthDate,
    providers,
    markets,
    maxCampaignAgeMinutes,
    freshnessRows,
    coreStatuses,
    businessStatuses,
    currentCampaignSummary,
    historicalCampaignSummary,
    googleApiBudget,
    blockers,
  });

  if (blockers.length) {
    console.log('[marketing-status] NOT READY:');
    for (const blocker of blockers) console.log(`[marketing-status] - ${blocker}`);
    if (requireComplete) {
      throw new Error(`Marketing analytics status has ${blockers.length} blocker(s).`);
    }
    return;
  }

  console.log('[marketing-status] READY: all expected marketing analytics checks passed.');
}

main().catch((error) => {
  console.error('[marketing-status] FAILED:', error.message);
  process.exit(1);
});
