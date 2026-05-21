#!/usr/bin/env node

/**
 * Synchronizes Google Ads landing-page reports into Supabase.
 *
 * Required env vars:
 * - GOOGLE_ADS_DEVELOPER_TOKEN
 * - GOOGLE_ADS_ACCOUNTS_JSON
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env vars:
 * - GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_REFRESH_TOKEN
 * - GOOGLE_ADS_BASE44_APP_ID / GOOGLE_ADS_BASE44_ACCESS_TOKEN / GOOGLE_ADS_BASE44_TOKEN_ACCOUNT_ID
 * - GOOGLE_ADS_LOGIN_CUSTOMER_ID
 * - GOOGLE_ADS_API_VERSION (default: v23)
 * - GOOGLE_ADS_LANDING_PAGE_RESOURCES (default: expanded,unexpanded)
 * - GOOGLE_ADS_LANDING_PAGE_PREFLIGHT (default: 1)
 * - SYNC_DAYS_BACK / SYNC_FROM_DATE / SYNC_TO_DATE / SYNC_MARKETS
 * - FX_RATES_JSON
 */

import {
  DEFAULT_FX_RATES,
  assertSupportedMarket,
  currencyToCzk,
  finishSyncRun,
  isAccountActiveForRange,
  metricKey,
  microsToNative,
  normalizeCustomerId,
  numberOrNull,
  parseJsonEnv,
  parseMarketFilter,
  requireEnv,
  resolveDateRange,
  roundMetric,
  startSyncRun,
  upsertSupabaseRows,
} from './lib/ads-sync-utils.mjs';

const PROVIDER = 'google_ads';
const TABLE = 'ad_landing_pages_daily';
const DEFAULT_RESOURCES = ['expanded', 'unexpanded'];

const RESOURCE_CONFIGS = {
  expanded: {
    label: 'expanded',
    resource: 'expanded_landing_page_view',
    urlField: 'expanded_landing_page_view.expanded_final_url',
    rowObject: 'expandedLandingPageView',
    rowUrlKey: 'expandedFinalUrl',
  },
  expanded_landing_page_view: {
    label: 'expanded',
    resource: 'expanded_landing_page_view',
    urlField: 'expanded_landing_page_view.expanded_final_url',
    rowObject: 'expandedLandingPageView',
    rowUrlKey: 'expandedFinalUrl',
  },
  unexpanded: {
    label: 'unexpanded',
    resource: 'landing_page_view',
    urlField: 'landing_page_view.unexpanded_final_url',
    rowObject: 'landingPageView',
    rowUrlKey: 'unexpandedFinalUrl',
  },
  landing_page_view: {
    label: 'unexpanded',
    resource: 'landing_page_view',
    urlField: 'landing_page_view.unexpanded_final_url',
    rowObject: 'landingPageView',
    rowUrlKey: 'unexpandedFinalUrl',
  },
};

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    validateOnly: args.has('--validate-only'),
    noPreflight: args.has('--no-preflight'),
  };
}

function parseResources() {
  const raw = process.env.GOOGLE_ADS_LANDING_PAGE_RESOURCES || DEFAULT_RESOURCES.join(',');
  const requested = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const invalid = requested.filter((value) => !RESOURCE_CONFIGS[value]);
  if (invalid.length) {
    throw new Error(`Unsupported GOOGLE_ADS_LANDING_PAGE_RESOURCES value(s): ${invalid.join(', ')}`);
  }

  const resources = requested.map((value) => RESOURCE_CONFIGS[value]);

  if (!resources.length) {
    throw new Error('GOOGLE_ADS_LANDING_PAGE_RESOURCES did not resolve to any supported resource');
  }

  const seen = new Set();
  return resources.filter((resource) => {
    if (seen.has(resource.resource)) return false;
    seen.add(resource.resource);
    return true;
  });
}

async function fetchAccessToken() {
  if (process.env.GOOGLE_ADS_BASE44_ACCESS_TOKEN) {
    return fetchBase44AccessToken();
  }

  const body = new URLSearchParams({
    client_id: requireEnv('GOOGLE_ADS_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_ADS_CLIENT_SECRET'),
    refresh_token: requireEnv('GOOGLE_ADS_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get OAuth token (${response.status}): ${text}`);
  }

  const json = await response.json();
  if (!json.access_token) throw new Error('OAuth token response did not include access_token');
  return json.access_token;
}

async function fetchBase44AccessToken() {
  const appId = requireEnv('GOOGLE_ADS_BASE44_APP_ID');
  const base44AccessToken = requireEnv('GOOGLE_ADS_BASE44_ACCESS_TOKEN');
  const accountId = requireEnv('GOOGLE_ADS_BASE44_TOKEN_ACCOUNT_ID');

  const response = await fetch(`https://base44.app/api/apps/${appId}/functions/googleAdsRefreshToken`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${base44AccessToken}`,
      'Content-Type': 'application/json',
      'X-App-Id': appId,
    },
    body: JSON.stringify({ accountId }),
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!response.ok || !json.access_token) {
    const detail = json.error || json.details || text;
    throw new Error(`Base44 Google Ads token refresh failed (${response.status}): ${detail}`);
  }

  return json.access_token;
}

async function fetchGoogleRows({
  accessToken,
  apiVersion,
  developerToken,
  loginCustomerId,
  customerId,
  query,
}) {
  const endpoint = `https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/googleAds:searchStream`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Ads API request failed (${response.status}) for customer ${customerId}: ${text}`);
  }

  const chunks = await response.json();
  if (!Array.isArray(chunks)) {
    throw new Error(`Unexpected Google Ads response for customer ${customerId}`);
  }

  return chunks.flatMap((chunk) => chunk.results || []);
}

function landingPageQuery({ from, to, resourceConfig, includeAdGroup, limit = null }) {
  const fields = [
    '  segments.date,',
    '  customer.id,',
    '  customer.descriptive_name,',
    '  customer.currency_code,',
    '  campaign.id,',
    '  campaign.name,',
    '  campaign.status,',
    '  campaign.advertising_channel_type,',
    '  campaign.advertising_channel_sub_type,',
  ];

  if (includeAdGroup) {
    fields.push('  ad_group.id,');
    fields.push('  ad_group.name,');
  }

  fields.push(`  ${resourceConfig.urlField},`);
  fields.push('  metrics.impressions,');
  fields.push('  metrics.clicks,');
  fields.push('  metrics.cost_micros,');
  fields.push('  metrics.conversions,');
  fields.push('  metrics.conversions_value');

  const orderBy = includeAdGroup
    ? 'ORDER BY segments.date, campaign.id, ad_group.id, metrics.cost_micros DESC'
    : 'ORDER BY segments.date, campaign.id, metrics.cost_micros DESC';

  return [
    'SELECT',
    fields.join('\n'),
    `FROM ${resourceConfig.resource}`,
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    orderBy,
    limit ? `LIMIT ${Number(limit)}` : null,
  ].filter(Boolean).join('\n');
}

function isCompatibilityError(error) {
  return /BAD_FIELD_NAME|FIELD_INCOMPATIBLE|PROHIBITED|UNRECOGNIZED_FIELD|cannot be selected|incompatible/i.test(error.message);
}

async function resolveCompatibleQuery({
  accessToken,
  apiVersion,
  developerToken,
  loginCustomerId,
  account,
  resourceConfig,
  from,
  to,
  warnings,
  preflight,
}) {
  if (!preflight) return { includeAdGroup: true };

  const withAdGroup = landingPageQuery({
    from,
    to,
    resourceConfig,
    includeAdGroup: true,
    limit: 1,
  });

  try {
    await fetchGoogleRows({
      accessToken,
      apiVersion,
      developerToken,
      loginCustomerId,
      customerId: account.customerId,
      query: withAdGroup,
    });
    return { includeAdGroup: true };
  } catch (error) {
    if (!isCompatibilityError(error)) throw error;
    const message = `${account.market.toUpperCase()} ${resourceConfig.resource}: ad_group fields are not compatible in this account/query, falling back to campaign-level rows`;
    warnings.push(message);
    console.warn(`[sync-google-ads-landing-pages] ${message}`);
  }

  const withoutAdGroup = landingPageQuery({
    from,
    to,
    resourceConfig,
    includeAdGroup: false,
    limit: 1,
  });

  await fetchGoogleRows({
    accessToken,
    apiVersion,
    developerToken,
    loginCustomerId,
    customerId: account.customerId,
    query: withoutAdGroup,
  });

  return { includeAdGroup: false };
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parseLandingUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { raw, url: null, normalized: '' };

  try {
    const url = new URL(raw);
    return { raw, url, normalized: normalizeText(`${url.hostname}${url.pathname}${url.search}`) };
  } catch {
    try {
      const url = new URL(`https://${raw}`);
      return { raw, url, normalized: normalizeText(`${url.hostname}${url.pathname}${url.search}`) };
    } catch {
      return { raw, url: null, normalized: normalizeText(raw) };
    }
  }
}

function classifyLandingPage(value) {
  const parsed = parseLandingUrl(value);
  const pathname = normalizeText(parsed.url?.pathname || parsed.raw).replace(/\/+/g, '/');
  const segments = pathname.split('/').filter(Boolean);
  const text = parsed.normalized;

  const isHp = segments.length === 0 || pathname === '/' || /(?:^|\/)(index|home)(?:\/)?$/.test(pathname);
  const saleSignal = /(vyprodej|vypredaj|kiarusitas|lichidare|akce|akcia|sleva|zlava|sale|discount|levn|lacn|olcso|ieftin)/.test(text);
  const categorySignal = /(?:^|\/)(c|kategorie|category|categorie|categoria|kategoriak|regaly|regal|polc|polce|raft|rafturi|kovove-regaly|kovove-regale)(?:\/|-|$)/.test(pathname)
    || /(regaly|regale|polc|rafturi|kovove|metalice)/.test(text);
  const productSignal = /(?:^|\/)(p|produkt|product|produs|termek)(?:\/|-|$)/.test(pathname)
    || /(?:^|[-_/])\d{2,4}x\d{2,4}x\d{2,4}(?:[-_/]|$)/.test(text)
    || /(?:sku|kod|code|model)[-_=]/.test(text);

  const flag180x90x30x40 = /(?:^|[^0-9])1800?x900?x(?:300?|400?)(?:[^0-9]|$)/.test(text)
    || /180[-_ ]?x[-_ ]?90[-_ ]?x[-_ ]?(30|40)/.test(text);
  const flag150x70x30 = /(?:^|[^0-9])1500?x700?x300?(?:[^0-9]|$)/.test(text)
    || /150[-_ ]?x[-_ ]?70[-_ ]?x[-_ ]?30/.test(text);
  const tallSignal = /(?:^|[^0-9])(2000|2100|2200|2400|2500|200|210|220|240|250)x\d{2,4}x\d{2,4}(?:[^0-9]|$)/.test(text)
    || /(vysok|tall|inalt|magas)/.test(text);
  const heavySignal = /(nosnost|teherbiras|heavy|extra|industrial|profesional|premium|1500[-_ ]?kg|1000[-_ ]?kg|875[-_ ]?kg|capacitate)/.test(text);
  const tallHeavy = tallSignal || heavySignal;

  let landingPageType = 'other';
  if (isHp) landingPageType = 'hp';
  else if (saleSignal && !productSignal) landingPageType = 'cheap_category';
  else if (productSignal) landingPageType = 'product';
  else if (categorySignal || segments.length === 1) landingPageType = 'category';

  let productSizeFlag = 'other';
  if (flag180x90x30x40) productSizeFlag = '180x90x30_40';
  else if (flag150x70x30) productSizeFlag = '150x70x30';
  else if (tallHeavy) productSizeFlag = 'tall_heavy';

  return {
    landingPageType,
    productSizeFlag,
    flags: {
      hp: isHp,
      category: landingPageType === 'category',
      cheap_category: landingPageType === 'cheap_category',
      product: landingPageType === 'product',
      sale_signal: saleSignal,
      category_signal: categorySignal,
      product_signal: productSignal,
      size_180x90x30_40: flag180x90x30x40,
      size_150x70x30: flag150x70x30,
      tall_signal: tallSignal,
      heavy_signal: heavySignal,
      tall_heavy: tallHeavy,
    },
  };
}

function customerIdFromRow(row, fallback) {
  return normalizeCustomerId(row.customer?.id || fallback);
}

function rowCurrency(row, account) {
  return row.customer?.currencyCode || account.currency || 'CZK';
}

function buildLandingPageRow({ row, account, resourceConfig, fxRates, fetchedAt }) {
  const date = row.segments?.date || null;
  const landingPageUrl = row[resourceConfig.rowObject]?.[resourceConfig.rowUrlKey] || null;
  if (!date || !landingPageUrl) return null;

  const currency = rowCurrency(row, account);
  const costMicros = numberOrNull(row.metrics?.costMicros) ?? 0;
  const costNative = microsToNative(costMicros) ?? 0;
  const costCzk = currencyToCzk(costNative, currency, fxRates) ?? 0;
  const conversions = numberOrNull(row.metrics?.conversions) ?? 0;
  const conversionValueNative = numberOrNull(row.metrics?.conversionsValue) ?? 0;
  const conversionValueCzk = currencyToCzk(conversionValueNative, currency, fxRates) ?? 0;
  const accountId = customerIdFromRow(row, account.customerId);
  const adGroupId = row.adGroup?.id ? String(row.adGroup.id) : null;
  const classification = classifyLandingPage(landingPageUrl);

  return {
    landing_page_key: metricKey({
      provider: PROVIDER,
      resource: resourceConfig.resource,
      accountId,
      market: account.market,
      date,
      campaignId: row.campaign?.id || null,
      adGroupId,
      landingPageUrl,
    }),
    date,
    provider: PROVIDER,
    resource: resourceConfig.resource,
    market: account.market,
    customer_id: accountId,
    customer_name: row.customer?.descriptiveName || account.name || null,
    campaign_id: row.campaign?.id ? String(row.campaign.id) : null,
    campaign_name: row.campaign?.name || null,
    campaign_status: row.campaign?.status || null,
    channel_type: row.campaign?.advertisingChannelType || null,
    channel_sub_type: row.campaign?.advertisingChannelSubType || null,
    ad_group_id: adGroupId,
    ad_group_name: row.adGroup?.name || null,
    landing_page_url: landingPageUrl,
    expanded_final_url: resourceConfig.resource === 'expanded_landing_page_view' ? landingPageUrl : null,
    unexpanded_final_url: resourceConfig.resource === 'landing_page_view' ? landingPageUrl : null,
    landing_page_type: classification.landingPageType,
    landing_page_flags: classification.flags,
    product_size_flag: classification.productSizeFlag,
    is_hp: classification.landingPageType === 'hp',
    is_category: classification.landingPageType === 'category',
    is_cheap_category: classification.landingPageType === 'cheap_category',
    is_product: classification.landingPageType === 'product',
    currency,
    cost_micros: costMicros,
    cost_native: roundMetric(costNative),
    cost_czk: costCzk,
    impressions: numberOrNull(row.metrics?.impressions) ?? 0,
    clicks: numberOrNull(row.metrics?.clicks) ?? 0,
    conversions,
    conversion_value_native: roundMetric(conversionValueNative),
    conversion_value_czk: conversionValueCzk,
    ads_aov_native: conversions > 0 ? roundMetric(conversionValueNative / conversions) : null,
    ads_aov_czk: conversions > 0 ? roundMetric(conversionValueCzk / conversions) : null,
    raw_data: {
      query_resource: resourceConfig.resource,
      row,
    },
    fetched_at: fetchedAt,
    updated_at: fetchedAt,
  };
}

function normalizeAccounts(rawAccounts, { from, to, marketFilter }) {
  if (!Array.isArray(rawAccounts) || !rawAccounts.length) {
    throw new Error('GOOGLE_ADS_ACCOUNTS_JSON must be a non-empty JSON array');
  }

  return rawAccounts
    .map((account) => ({
      ...account,
      market: String(account.market || 'unknown').toLowerCase(),
      name: account.name || account.accountName || null,
      customerId: normalizeCustomerId(account.customerId || account.accountId),
    }))
    .filter((account) => {
      if (!account.customerId) {
        throw new Error(`Invalid customerId in GOOGLE_ADS_ACCOUNTS_JSON for market "${account.market}"`);
      }
      assertSupportedMarket(account.market);
      if (marketFilter && !marketFilter.has(account.market)) return false;
      return isAccountActiveForRange(account, from, to);
    });
}

async function main() {
  const args = parseArgs();
  const preflight = !args.noPreflight && process.env.GOOGLE_ADS_LANDING_PAGE_PREFLIGHT !== '0';

  requireEnv('GOOGLE_ADS_DEVELOPER_TOKEN');
  requireEnv('GOOGLE_ADS_ACCOUNTS_JSON');
  if (!args.validateOnly) {
    requireEnv('SUPABASE_URL');
    requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  }

  const apiVersion = process.env.GOOGLE_ADS_API_VERSION || 'v23';
  const developerToken = requireEnv('GOOGLE_ADS_DEVELOPER_TOKEN');
  const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');
  const fxRates = parseJsonEnv('FX_RATES_JSON', DEFAULT_FX_RATES);
  const rawAccounts = parseJsonEnv('GOOGLE_ADS_ACCOUNTS_JSON', []);
  const marketFilter = parseMarketFilter();
  const resources = parseResources();
  const { from, to } = resolveDateRange();
  const accounts = normalizeAccounts(rawAccounts, { from, to, marketFilter });

  if (!accounts.length) {
    console.log('[sync-google-ads-landing-pages] No active accounts for selected date range. Nothing to sync.');
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const syncRunId = args.validateOnly ? null : await startSyncRun({
    provider: PROVIDER,
    syncType: `landing_pages:${resources.map((resource) => resource.label).join(',')}`,
    from,
    to,
    supabaseUrl,
    serviceRoleKey,
  });

  let rowsUpserted = 0;
  const warnings = [];

  try {
    console.log(`[sync-google-ads-landing-pages] Start ${args.validateOnly ? 'validation' : 'sync'} ${from} -> ${to} (${accounts.length} account(s), ${resources.length} resource(s))`);
    const accessToken = await fetchAccessToken();
    const fetchedAt = new Date().toISOString();
    const landingRows = [];

    for (const account of accounts) {
      for (const resourceConfig of resources) {
        const compatibility = await resolveCompatibleQuery({
          accessToken,
          apiVersion,
          developerToken,
          loginCustomerId,
          account,
          resourceConfig,
          from,
          to,
          warnings,
          preflight,
        });

        if (args.validateOnly) {
          console.log(`[sync-google-ads-landing-pages] ${account.market.toUpperCase()} ${resourceConfig.resource}: query OK (${compatibility.includeAdGroup ? 'ad_group' : 'campaign'} level)`);
          continue;
        }

        const rows = await fetchGoogleRows({
          accessToken,
          apiVersion,
          developerToken,
          loginCustomerId,
          customerId: account.customerId,
          query: landingPageQuery({
            from,
            to,
            resourceConfig,
            includeAdGroup: compatibility.includeAdGroup,
          }),
        });

        let kept = 0;
        for (const row of rows) {
          const landingRow = buildLandingPageRow({ row, account, resourceConfig, fxRates, fetchedAt });
          if (!landingRow) continue;
          landingRows.push(landingRow);
          kept += 1;
        }

        console.log(`[sync-google-ads-landing-pages] ${account.market.toUpperCase()} ${resourceConfig.resource}: ${rows.length} rows (${kept} with URL)`);
      }
    }

    if (!args.validateOnly) {
      rowsUpserted += await upsertSupabaseRows({
        rows: landingRows,
        supabaseUrl,
        serviceRoleKey,
        table: TABLE,
        onConflict: 'landing_page_key',
      });

      const status = warnings.length ? 'partial_success' : 'success';
      await finishSyncRun({ id: syncRunId, status, rowsUpserted, warnings, supabaseUrl, serviceRoleKey });
      console.log(`[sync-google-ads-landing-pages] Upserted rows: ${rowsUpserted}`);
    }

    console.log('[sync-google-ads-landing-pages] Done');
  } catch (error) {
    if (!args.validateOnly) {
      await finishSyncRun({
        id: syncRunId,
        status: 'failed',
        rowsUpserted,
        warnings,
        errorMessage: error.message,
        supabaseUrl,
        serviceRoleKey,
      });
    }
    throw error;
  }
}

main().catch((error) => {
  console.error('[sync-google-ads-landing-pages] FAILED:', error.message);
  process.exit(1);
});
