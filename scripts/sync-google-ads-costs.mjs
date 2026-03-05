#!/usr/bin/env node

/**
 * Synchronizes Google Ads daily costs into Supabase table public.ad_costs_daily.
 *
 * Required env vars:
 * - GOOGLE_ADS_DEVELOPER_TOKEN
 * - GOOGLE_ADS_CLIENT_ID
 * - GOOGLE_ADS_CLIENT_SECRET
 * - GOOGLE_ADS_REFRESH_TOKEN
 * - GOOGLE_ADS_ACCOUNTS_JSON (example: [{"market":"cz","customerId":"1234567890"}])
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env vars:
 * - GOOGLE_ADS_LOGIN_CUSTOMER_ID
 * - GOOGLE_ADS_API_VERSION (default: v23)
 * - SYNC_DAYS_BACK (default: 14)
 * - SYNC_FROM_DATE (YYYY-MM-DD)
 * - SYNC_TO_DATE (YYYY-MM-DD)
 * - FX_RATES_JSON (default: {"CZK":1,"EUR":25.2,"HUF":0.063})
 */

const REQUIRED_ENV_VARS = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_ACCOUNTS_JSON',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const DEFAULT_FX_RATES = { CZK: 1, EUR: 25.2, HUF: 0.063 };

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseJsonEnv(name, fallback = null) {
  const value = process.env[name];
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON in ${name}: ${error.message}`);
  }
}

function toDateString(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function resolveDateRange() {
  const explicitFrom = process.env.SYNC_FROM_DATE;
  const explicitTo = process.env.SYNC_TO_DATE;
  if (explicitFrom && explicitTo) return { from: explicitFrom, to: explicitTo };

  const daysBack = Number(process.env.SYNC_DAYS_BACK || 14);
  if (!Number.isFinite(daysBack) || daysBack < 0) {
    throw new Error(`SYNC_DAYS_BACK must be a non-negative number. Received: ${process.env.SYNC_DAYS_BACK}`);
  }

  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - daysBack);
  return { from: toDateString(fromDate), to: toDateString(toDate) };
}

function normalizeCustomerId(value) {
  return String(value || '').replace(/\D/g, '');
}

async function fetchAccessToken() {
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

async function fetchAccountDailyCosts({
  accessToken,
  apiVersion,
  developerToken,
  loginCustomerId,
  customerId,
  from,
  to,
}) {
  const query = [
    'SELECT',
    '  segments.date,',
    '  customer.currency_code,',
    '  metrics.cost_micros',
    'FROM customer',
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    'ORDER BY segments.date',
  ].join('\n');

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

  const byDate = new Map();
  for (const chunk of chunks) {
    for (const row of chunk.results || []) {
      const date = row.segments?.date;
      if (!date) continue;
      const currency = row.customer?.currencyCode || 'CZK';
      const micros = Number(row.metrics?.costMicros || 0);

      if (!byDate.has(date)) {
        byDate.set(date, { date, currency, costMicros: 0 });
      }
      const bucket = byDate.get(date);
      bucket.costMicros += micros;
      bucket.currency = currency;
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function upsertSupabaseRows({ rows, supabaseUrl, serviceRoleKey }) {
  if (!rows.length) return 0;

  const endpoint = new URL('/rest/v1/ad_costs_daily', supabaseUrl);
  endpoint.searchParams.set('on_conflict', 'date,market,account_customer_id');

  const chunkSize = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase upsert failed (${response.status}): ${text}`);
    }

    total += chunk.length;
  }

  return total;
}

async function main() {
  for (const name of REQUIRED_ENV_VARS) requireEnv(name);

  const apiVersion = process.env.GOOGLE_ADS_API_VERSION || 'v23';
  const developerToken = requireEnv('GOOGLE_ADS_DEVELOPER_TOKEN');
  const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '');
  const accounts = parseJsonEnv('GOOGLE_ADS_ACCOUNTS_JSON', []);
  const fxRates = parseJsonEnv('FX_RATES_JSON', DEFAULT_FX_RATES);

  if (!Array.isArray(accounts) || !accounts.length) {
    throw new Error('GOOGLE_ADS_ACCOUNTS_JSON must be a non-empty JSON array');
  }

  const { from, to } = resolveDateRange();
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  console.log(`[sync-google-ads-costs] Start sync ${from} -> ${to} (${accounts.length} account(s))`);

  const accessToken = await fetchAccessToken();
  const fetchedAt = new Date().toISOString();
  const rows = [];

  for (const account of accounts) {
    const market = account.market || 'unknown';
    const customerId = normalizeCustomerId(account.customerId);
    if (!customerId) {
      throw new Error(`Invalid customerId in GOOGLE_ADS_ACCOUNTS_JSON for market "${market}"`);
    }

    const daily = await fetchAccountDailyCosts({
      accessToken,
      apiVersion,
      developerToken,
      loginCustomerId,
      customerId,
      from,
      to,
    });

    for (const row of daily) {
      const costNative = row.costMicros / 1_000_000;
      const fxRate = fxRates[row.currency] ?? 1;
      rows.push({
        date: row.date,
        market,
        account_customer_id: customerId,
        currency: row.currency,
        cost_micros: Math.round(row.costMicros),
        cost_native: Number(costNative.toFixed(2)),
        cost_czk: Number((costNative * fxRate).toFixed(2)),
        fetched_at: fetchedAt,
      });
    }

    console.log(`[sync-google-ads-costs] ${market.toUpperCase()} (${customerId}) rows: ${daily.length}`);
  }

  const upserted = await upsertSupabaseRows({ rows, supabaseUrl, serviceRoleKey });
  console.log(`[sync-google-ads-costs] Upserted rows: ${upserted}`);
  console.log('[sync-google-ads-costs] Done');
}

main().catch((error) => {
  console.error('[sync-google-ads-costs] FAILED:', error.message);
  process.exit(1);
});
