#!/usr/bin/env node

/**
 * Synchronizes detailed Google Ads reporting into Supabase marketing tables.
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
 * - GOOGLE_ADS_DETAIL_LEVELS (default: campaign,device,hour,ad_group,ad,keyword,search_term,shopping_product,asset_group,geo,conversion_action)
 * - SYNC_DAYS_BACK / SYNC_FROM_DATE / SYNC_TO_DATE / SYNC_MARKETS
 * - FX_RATES_JSON
 */

import {
  DEFAULT_FX_RATES,
  assertSupportedMarket,
  currencyToCzk,
  finishSyncRun,
  hashObject,
  insertRawInsights,
  isAccountActiveForRange,
  metricKey,
  microsToNative,
  nativeToMicros,
  normalizeCustomerId,
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

const PROVIDER = 'google_ads';
const REQUIRED_ENV_VARS = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_ACCOUNTS_JSON',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const DEFAULT_LEVELS = [
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

function parseLevels() {
  const raw = process.env.GOOGLE_ADS_DETAIL_LEVELS || DEFAULT_LEVELS.join(',');
  const levels = raw
    .split(',')
    .map((level) => level.trim())
    .filter(Boolean);
  return new Set(levels);
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

function campaignQuery(from, to) {
  return [
    'SELECT',
    '  segments.date,',
    '  customer.id,',
    '  customer.descriptive_name,',
    '  customer.currency_code,',
    '  campaign.id,',
    '  campaign.name,',
    '  campaign.status,',
    '  campaign.serving_status,',
    '  campaign.advertising_channel_type,',
    '  campaign.advertising_channel_sub_type,',
    '  campaign.bidding_strategy_type,',
    '  campaign_budget.amount_micros,',
    '  metrics.cost_micros,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.interactions,',
    '  metrics.ctr,',
    '  metrics.average_cpc,',
    '  metrics.average_cpm,',
    '  metrics.conversions,',
    '  metrics.conversions_value,',
    '  metrics.all_conversions,',
    '  metrics.all_conversions_value,',
    '  metrics.view_through_conversions',
    'FROM campaign',
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    'ORDER BY segments.date, campaign.id',
  ].join('\n');
}

function deviceQuery(from, to) {
  return [
    'SELECT',
    '  segments.date,',
    '  segments.device,',
    '  customer.id,',
    '  customer.descriptive_name,',
    '  customer.currency_code,',
    '  campaign.id,',
    '  campaign.name,',
    '  metrics.cost_micros,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.interactions,',
    '  metrics.ctr,',
    '  metrics.average_cpc,',
    '  metrics.average_cpm,',
    '  metrics.conversions,',
    '  metrics.conversions_value,',
    '  metrics.all_conversions,',
    '  metrics.all_conversions_value,',
    '  metrics.view_through_conversions',
    'FROM campaign',
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    'ORDER BY segments.date, campaign.id, segments.device',
  ].join('\n');
}

function hourQuery(from, to) {
  return [
    'SELECT',
    '  segments.date,',
    '  segments.hour,',
    '  customer.id,',
    '  customer.descriptive_name,',
    '  customer.currency_code,',
    '  campaign.id,',
    '  campaign.name,',
    '  metrics.cost_micros,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.interactions,',
    '  metrics.ctr,',
    '  metrics.average_cpc,',
    '  metrics.average_cpm,',
    '  metrics.conversions,',
    '  metrics.conversions_value,',
    '  metrics.all_conversions,',
    '  metrics.all_conversions_value,',
    '  metrics.view_through_conversions',
    'FROM campaign',
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    'ORDER BY segments.date, campaign.id, segments.hour',
  ].join('\n');
}

function adGroupQuery(from, to) {
  return [
    'SELECT',
    '  segments.date,',
    '  customer.id,',
    '  customer.descriptive_name,',
    '  customer.currency_code,',
    '  campaign.id,',
    '  campaign.name,',
    '  ad_group.id,',
    '  ad_group.name,',
    '  ad_group.status,',
    '  ad_group.type,',
    '  metrics.cost_micros,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.interactions,',
    '  metrics.ctr,',
    '  metrics.average_cpc,',
    '  metrics.average_cpm,',
    '  metrics.conversions,',
    '  metrics.conversions_value,',
    '  metrics.all_conversions,',
    '  metrics.all_conversions_value,',
    '  metrics.view_through_conversions',
    'FROM ad_group',
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    'ORDER BY segments.date, campaign.id, ad_group.id',
  ].join('\n');
}

function adQuery(from, to) {
  return [
    'SELECT',
    '  segments.date,',
    '  customer.id,',
    '  customer.descriptive_name,',
    '  customer.currency_code,',
    '  campaign.id,',
    '  campaign.name,',
    '  ad_group.id,',
    '  ad_group.name,',
    '  ad_group_ad.ad.id,',
    '  ad_group_ad.ad.name,',
    '  ad_group_ad.ad.type,',
    '  ad_group_ad.status,',
    '  metrics.cost_micros,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.interactions,',
    '  metrics.ctr,',
    '  metrics.average_cpc,',
    '  metrics.average_cpm,',
    '  metrics.conversions,',
    '  metrics.conversions_value,',
    '  metrics.all_conversions,',
    '  metrics.all_conversions_value,',
    '  metrics.view_through_conversions',
    'FROM ad_group_ad',
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    'ORDER BY segments.date, campaign.id, ad_group.id, ad_group_ad.ad.id',
  ].join('\n');
}

function keywordQuery(from, to) {
  return [
    'SELECT',
    '  segments.date,',
    '  customer.id,',
    '  customer.descriptive_name,',
    '  customer.currency_code,',
    '  campaign.id,',
    '  campaign.name,',
    '  ad_group.id,',
    '  ad_group.name,',
    '  ad_group_criterion.criterion_id,',
    '  ad_group_criterion.status,',
    '  ad_group_criterion.keyword.text,',
    '  ad_group_criterion.keyword.match_type,',
    '  metrics.cost_micros,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.interactions,',
    '  metrics.ctr,',
    '  metrics.average_cpc,',
    '  metrics.average_cpm,',
    '  metrics.conversions,',
    '  metrics.conversions_value,',
    '  metrics.all_conversions,',
    '  metrics.all_conversions_value',
    'FROM keyword_view',
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    'ORDER BY segments.date, metrics.cost_micros DESC',
  ].join('\n');
}

function searchTermQuery(from, to) {
  return [
    'SELECT',
    '  segments.date,',
    '  segments.search_term_match_type,',
    '  customer.id,',
    '  customer.descriptive_name,',
    '  customer.currency_code,',
    '  campaign.id,',
    '  campaign.name,',
    '  ad_group.id,',
    '  ad_group.name,',
    '  search_term_view.search_term,',
    '  search_term_view.status,',
    '  metrics.cost_micros,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.interactions,',
    '  metrics.ctr,',
    '  metrics.average_cpc,',
    '  metrics.average_cpm,',
    '  metrics.conversions,',
    '  metrics.conversions_value,',
    '  metrics.all_conversions,',
    '  metrics.all_conversions_value',
    'FROM search_term_view',
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    'ORDER BY segments.date, metrics.cost_micros DESC',
  ].join('\n');
}

function shoppingProductQuery(from, to) {
  return [
    'SELECT',
    '  segments.date,',
    '  segments.product_item_id,',
    '  segments.product_title,',
    '  segments.product_brand,',
    '  segments.product_type_l1,',
    '  segments.product_type_l2,',
    '  segments.product_custom_attribute0,',
    '  segments.product_custom_attribute1,',
    '  customer.id,',
    '  customer.descriptive_name,',
    '  customer.currency_code,',
    '  campaign.id,',
    '  campaign.name,',
    '  ad_group.id,',
    '  ad_group.name,',
    '  metrics.cost_micros,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.conversions,',
    '  metrics.conversions_value,',
    '  metrics.all_conversions,',
    '  metrics.all_conversions_value',
    'FROM shopping_performance_view',
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    'ORDER BY segments.date, metrics.cost_micros DESC',
  ].join('\n');
}

function assetGroupQuery(from, to) {
  return [
    'SELECT',
    '  segments.date,',
    '  customer.id,',
    '  customer.descriptive_name,',
    '  customer.currency_code,',
    '  campaign.id,',
    '  campaign.name,',
    '  asset_group.id,',
    '  asset_group.name,',
    '  asset_group.status,',
    '  metrics.cost_micros,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.interactions,',
    '  metrics.ctr,',
    '  metrics.average_cpc,',
    '  metrics.conversions,',
    '  metrics.conversions_value,',
    '  metrics.all_conversions,',
    '  metrics.all_conversions_value',
    'FROM asset_group',
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    'ORDER BY segments.date, campaign.id, asset_group.id',
  ].join('\n');
}

function geoQuery(from, to) {
  return [
    'SELECT',
    '  segments.date,',
    '  segments.geo_target_region,',
    '  segments.geo_target_city,',
    '  segments.geo_target_most_specific_location,',
    '  customer.id,',
    '  customer.descriptive_name,',
    '  customer.currency_code,',
    '  campaign.id,',
    '  campaign.name,',
    '  user_location_view.country_criterion_id,',
    '  user_location_view.targeting_location,',
    '  metrics.cost_micros,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.interactions,',
    '  metrics.ctr,',
    '  metrics.average_cpc,',
    '  metrics.average_cpm,',
    '  metrics.conversions,',
    '  metrics.conversions_value,',
    '  metrics.all_conversions,',
    '  metrics.all_conversions_value',
    'FROM user_location_view',
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    'ORDER BY segments.date, campaign.id, metrics.cost_micros DESC',
  ].join('\n');
}

function conversionActionQuery(from, to) {
  return [
    'SELECT',
    '  segments.date,',
    '  segments.conversion_action,',
    '  segments.conversion_action_name,',
    '  customer.id,',
    '  customer.descriptive_name,',
    '  customer.currency_code,',
    '  campaign.id,',
    '  campaign.name,',
    '  metrics.conversions,',
    '  metrics.conversions_value,',
    '  metrics.all_conversions,',
    '  metrics.all_conversions_value',
    'FROM campaign',
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    'ORDER BY segments.date, campaign.id, segments.conversion_action',
  ].join('\n');
}

const LEVEL_QUERIES = {
  campaign: { required: true, buildQuery: campaignQuery },
  device: { required: false, buildQuery: deviceQuery },
  hour: { required: false, buildQuery: hourQuery },
  ad_group: { required: false, buildQuery: adGroupQuery },
  ad: { required: false, buildQuery: adQuery },
  keyword: { required: false, buildQuery: keywordQuery },
  search_term: { required: false, buildQuery: searchTermQuery },
  shopping_product: { required: false, buildQuery: shoppingProductQuery },
  asset_group: { required: false, buildQuery: assetGroupQuery },
  geo: { required: false, buildQuery: geoQuery },
  conversion_action: { required: false, buildQuery: conversionActionQuery },
};

function customerIdFromRow(row, fallback) {
  return normalizeCustomerId(row.customer?.id || fallback);
}

function rowCurrency(row, account) {
  return row.customer?.currencyCode || account.currency || 'CZK';
}

function buildMetricRow({ row, account, level, dimensions, fxRates, fetchedAt }) {
  const currency = rowCurrency(row, account);
  const spendNative = microsToNative(row.metrics?.costMicros) ?? 0;
  const spendCzk = currencyToCzk(spendNative, currency, fxRates);
  const conversionValueNative = numberOrNull(row.metrics?.conversionsValue) ?? 0;
  const allConversionValueNative = numberOrNull(row.metrics?.allConversionsValue) ?? 0;
  const conversions = numberOrNull(row.metrics?.conversions) ?? 0;
  const clicks = numberOrNull(row.metrics?.clicks) ?? 0;
  const impressions = numberOrNull(row.metrics?.impressions) ?? 0;
  const averageCpcNative = microsToNative(row.metrics?.averageCpc);
  const averageCpmNative = microsToNative(row.metrics?.averageCpm);
  const averageOrderValueNative = conversions > 0 ? conversionValueNative / conversions : null;
  const dimensionHash = hashObject(dimensions);
  const accountId = customerIdFromRow(row, account.customerId);

  return {
    metric_key: metricKey({
      provider: PROVIDER,
      accountId,
      market: account.market,
      date: row.segments?.date,
      level,
      campaignId: row.campaign?.id || null,
      adGroupId: row.adGroup?.id || null,
      adId: row.adGroupAd?.ad?.id || null,
      dimensionHash,
    }),
    date: row.segments?.date,
    provider: PROVIDER,
    market: account.market,
    account_id: accountId,
    account_name: row.customer?.descriptiveName || account.name || null,
    level,
    campaign_id: row.campaign?.id ? String(row.campaign.id) : null,
    campaign_name: row.campaign?.name || null,
    ad_group_id: row.adGroup?.id ? String(row.adGroup.id) : null,
    ad_group_name: row.adGroup?.name || null,
    ad_id: row.adGroupAd?.ad?.id ? String(row.adGroupAd.ad.id) : null,
    ad_name: row.adGroupAd?.ad?.name || null,
    currency,
    spend_micros: numberOrNull(row.metrics?.costMicros) ?? 0,
    spend_native: roundMetric(spendNative),
    spend_czk: spendCzk,
    impressions,
    clicks,
    interactions: numberOrNull(row.metrics?.interactions),
    conversions,
    conversion_value_native: roundMetric(conversionValueNative),
    conversion_value_czk: currencyToCzk(conversionValueNative, currency, fxRates),
    average_order_value_native: roundMetric(averageOrderValueNative),
    average_order_value_czk: averageOrderValueNative === null ? null : currencyToCzk(averageOrderValueNative, currency, fxRates),
    all_conversions: numberOrNull(row.metrics?.allConversions),
    all_conversion_value_native: roundMetric(allConversionValueNative),
    all_conversion_value_czk: currencyToCzk(allConversionValueNative, currency, fxRates),
    view_through_conversions: numberOrNull(row.metrics?.viewThroughConversions),
    ctr: roundMetric(row.metrics?.ctr, 8),
    cpc_czk: averageCpcNative === null ? (clicks > 0 ? roundMoney(spendCzk / clicks) : null) : currencyToCzk(averageCpcNative, currency, fxRates),
    cpm_czk: averageCpmNative === null
      ? (impressions > 0 ? roundMoney((spendCzk / impressions) * 1000) : null)
      : currencyToCzk(averageCpmNative, currency, fxRates),
    roas_platform: spendCzk > 0 ? roundMetric((currencyToCzk(conversionValueNative, currency, fxRates) || 0) / spendCzk) : null,
    cost_per_conversion_czk: conversions > 0 ? roundMoney(spendCzk / conversions) : null,
    dimension_hash: dimensionHash,
    dimensions,
    raw_data: row,
    fetched_at: fetchedAt,
  };
}

function campaignEntityRow({ row, account, fetchedAt }) {
  const currency = rowCurrency(row, account);
  const budgetNative = microsToNative(row.campaignBudget?.amountMicros);
  return {
    provider: PROVIDER,
    market: account.market,
    account_id: customerIdFromRow(row, account.customerId),
    campaign_id: String(row.campaign?.id || ''),
    campaign_name: row.campaign?.name || null,
    status: row.campaign?.status || null,
    serving_status: row.campaign?.servingStatus || null,
    channel_type: row.campaign?.advertisingChannelType || null,
    channel_sub_type: row.campaign?.advertisingChannelSubType || null,
    bidding_strategy_type: row.campaign?.biddingStrategyType || null,
    budget_amount_micros: numberOrNull(row.campaignBudget?.amountMicros),
    budget_amount_native: budgetNative,
    currency,
    raw_data: row.campaign || {},
    fetched_at: fetchedAt,
  };
}

function adGroupEntityRow({ row, account, fetchedAt }) {
  if (!row.adGroup?.id) return null;
  return {
    provider: PROVIDER,
    market: account.market,
    account_id: customerIdFromRow(row, account.customerId),
    campaign_id: row.campaign?.id ? String(row.campaign.id) : null,
    ad_group_id: String(row.adGroup.id),
    ad_group_name: row.adGroup?.name || null,
    group_type: row.adGroup?.type || null,
    raw_data: row.adGroup || {},
    fetched_at: fetchedAt,
  };
}

function adEntityRow({ row, account, fetchedAt }) {
  if (!row.adGroupAd?.ad?.id) return null;
  return {
    provider: PROVIDER,
    market: account.market,
    account_id: customerIdFromRow(row, account.customerId),
    campaign_id: row.campaign?.id ? String(row.campaign.id) : null,
    ad_group_id: row.adGroup?.id ? String(row.adGroup.id) : null,
    ad_id: String(row.adGroupAd.ad.id),
    ad_name: row.adGroupAd.ad.name || null,
    raw_data: row.adGroupAd || {},
    fetched_at: fetchedAt,
  };
}

function dimensionsForLevel(level, row) {
  if (level === 'device') {
    return { device: row.segments?.device || null };
  }
  if (level === 'hour') {
    return { hour: row.segments?.hour ?? null };
  }
  if (level === 'ad_group') {
    return {
      ad_group_id: row.adGroup?.id ? String(row.adGroup.id) : null,
      ad_group_name: row.adGroup?.name || null,
      ad_group_status: row.adGroup?.status || null,
      ad_group_type: row.adGroup?.type || null,
    };
  }
  if (level === 'ad') {
    return {
      ad_id: row.adGroupAd?.ad?.id ? String(row.adGroupAd.ad.id) : null,
      ad_name: row.adGroupAd?.ad?.name || null,
      ad_type: row.adGroupAd?.ad?.type || null,
      ad_status: row.adGroupAd?.status || null,
    };
  }
  if (level === 'keyword') {
    return {
      criterion_id: row.adGroupCriterion?.criterionId ? String(row.adGroupCriterion.criterionId) : null,
      keyword_text: row.adGroupCriterion?.keyword?.text || null,
      match_type: row.adGroupCriterion?.keyword?.matchType || null,
      keyword_status: row.adGroupCriterion?.status || null,
    };
  }
  if (level === 'search_term') {
    return {
      search_term: row.searchTermView?.searchTerm || null,
      search_term_status: row.searchTermView?.status || null,
      match_type: row.segments?.searchTermMatchType || null,
    };
  }
  if (level === 'shopping_product') {
    return {
      product_item_id: row.segments?.productItemId || null,
      product_title: row.segments?.productTitle || null,
      product_brand: row.segments?.productBrand || null,
      product_type_l1: row.segments?.productTypeL1 || null,
      product_type_l2: row.segments?.productTypeL2 || null,
      product_custom_attribute0: row.segments?.productCustomAttribute0 || null,
      product_custom_attribute1: row.segments?.productCustomAttribute1 || null,
    };
  }
  if (level === 'asset_group') {
    return {
      asset_group_id: row.assetGroup?.id ? String(row.assetGroup.id) : null,
      asset_group_name: row.assetGroup?.name || null,
      asset_group_status: row.assetGroup?.status || null,
    };
  }
  if (level === 'geo') {
    return {
      country_criterion_id: row.userLocationView?.countryCriterionId ? String(row.userLocationView.countryCriterionId) : null,
      targeting_location: row.userLocationView?.targetingLocation ?? null,
      geo_target_region: row.segments?.geoTargetRegion || null,
      geo_target_city: row.segments?.geoTargetCity || null,
      geo_target_most_specific_location: row.segments?.geoTargetMostSpecificLocation || null,
    };
  }
  if (level === 'conversion_action') {
    return {
      conversion_action: row.segments?.conversionAction || null,
      conversion_action_name: row.segments?.conversionActionName || null,
    };
  }
  return {};
}

function accountRowFromConfig(account, fetchedAt) {
  return {
    provider: PROVIDER,
    market: account.market,
    account_id: account.customerId,
    account_name: account.name || null,
    currency: account.currency || null,
    timezone: account.timezone || null,
    enabled: account.enabled !== false,
    active_from: account.activeFrom || account.active_from || null,
    active_to: account.activeTo || account.active_to || null,
    raw_data: account,
    fetched_at: fetchedAt,
  };
}

function rawInsightRow({ row, account, level, fetchedAt }) {
  const date = row.segments?.date || null;
  const accountId = customerIdFromRow(row, account.customerId);
  const dimensions = dimensionsForLevel(level, row);
  return {
    raw_key: metricKey({
      provider: PROVIDER,
      accountId,
      market: account.market,
      resource: level,
      date,
      campaignId: row.campaign?.id || null,
      adGroupId: row.adGroup?.id || null,
      dimensionHash: hashObject(dimensions),
    }),
    provider: PROVIDER,
    market: account.market,
    account_id: accountId,
    resource: level,
    date_start: date,
    date_stop: date,
    raw_data: row,
    fetched_at: fetchedAt,
  };
}

async function main() {
  for (const name of REQUIRED_ENV_VARS) requireEnv(name);

  const apiVersion = process.env.GOOGLE_ADS_API_VERSION || 'v23';
  const developerToken = requireEnv('GOOGLE_ADS_DEVELOPER_TOKEN');
  const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');
  const fxRates = parseJsonEnv('FX_RATES_JSON', DEFAULT_FX_RATES);
  const rawAccounts = parseJsonEnv('GOOGLE_ADS_ACCOUNTS_JSON', []);
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
      throw new Error('GOOGLE_ADS_ACCOUNTS_JSON must be a non-empty JSON array');
    }

    const accounts = rawAccounts
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

    if (!accounts.length) {
      console.log('[sync-google-ads-detail] No active accounts for selected date range. Nothing to sync.');
      await finishSyncRun({ id: syncRunId, status: 'success', rowsUpserted, warnings, supabaseUrl, serviceRoleKey });
      return;
    }

    console.log(`[sync-google-ads-detail] Start sync ${from} -> ${to} (${accounts.length} account(s))`);
    const accessToken = await fetchAccessToken();
    const fetchedAt = new Date().toISOString();

    const accountRows = accounts.map((account) => accountRowFromConfig(account, fetchedAt));
    rowsUpserted += await upsertSupabaseRows({
      rows: accountRows,
      supabaseUrl,
      serviceRoleKey,
      table: 'ad_accounts',
      onConflict: 'provider,account_id',
    });

    const campaignRowsByKey = new Map();
    const adGroupRowsByKey = new Map();
    const adRowsByKey = new Map();
    const metricRows = [];
    const rawRows = [];

    for (const account of accounts) {
      for (const [level, config] of Object.entries(LEVEL_QUERIES)) {
        if (!levels.has(level)) continue;

        try {
          const rows = await fetchGoogleRows({
            accessToken,
            apiVersion,
            developerToken,
            loginCustomerId,
            customerId: account.customerId,
            query: config.buildQuery(from, to),
          });

          for (const row of rows) {
            if (!row.segments?.date) continue;
            const dimensions = dimensionsForLevel(level, row);
            metricRows.push(buildMetricRow({ row, account, level, dimensions, fxRates, fetchedAt }));
            rawRows.push(rawInsightRow({ row, account, level, fetchedAt }));

            if (row.campaign?.id) {
              const campaign = campaignEntityRow({ row, account, fetchedAt });
              campaignRowsByKey.set(`${campaign.provider}:${campaign.account_id}:${campaign.campaign_id}`, campaign);
            }

            const adGroup = adGroupEntityRow({ row, account, fetchedAt });
            if (adGroup) {
              adGroupRowsByKey.set(`${adGroup.provider}:${adGroup.account_id}:${adGroup.ad_group_id}`, adGroup);
            }

            const ad = adEntityRow({ row, account, fetchedAt });
            if (ad) {
              adRowsByKey.set(`${ad.provider}:${ad.account_id}:${ad.ad_id}`, ad);
            }
          }

          console.log(`[sync-google-ads-detail] ${account.market.toUpperCase()} ${level}: ${rows.length} rows`);
        } catch (error) {
          const message = `${account.market.toUpperCase()} ${level}: ${error.message}`;
          if (config.required) throw new Error(message);
          warnings.push(message);
          console.warn(`[sync-google-ads-detail] Optional level failed: ${message}`);
        }
      }
    }

    rowsUpserted += await upsertSupabaseRows({
      rows: Array.from(campaignRowsByKey.values()).filter((row) => row.campaign_id),
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
    console.log(`[sync-google-ads-detail] Upserted rows: ${rowsUpserted}`);
    console.log('[sync-google-ads-detail] Done');
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
  console.error('[sync-google-ads-detail] FAILED:', error.message);
  process.exit(1);
});
