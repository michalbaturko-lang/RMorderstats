import { createHash } from 'node:crypto';

export const DEFAULT_FX_RATES = { CZK: 1, EUR: 25.2, HUF: 0.063, RON: 5.1 };
export const SUPPORTED_MARKETS = new Set(['cz', 'sk', 'hu', 'ro', 'unknown']);

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function parseJsonEnv(name, fallback = null) {
  const value = process.env[name];
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON in ${name}: ${error.message}`);
  }
}

export function toDateString(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function resolveDateRange() {
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

export function normalizeCustomerId(value) {
  return String(value || '').replace(/\D/g, '');
}

export function normalizeMetaAccountId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const numeric = raw.replace(/^act_/i, '').replace(/\D/g, '');
  return numeric ? `act_${numeric}` : raw;
}

export function parseMarketFilter() {
  const raw = process.env.SYNC_MARKETS || '';
  const markets = raw
    .split(',')
    .map((market) => market.trim().toLowerCase())
    .filter(Boolean);

  if (!markets.length) return null;

  const invalid = markets.filter((market) => !SUPPORTED_MARKETS.has(market));
  if (invalid.length) {
    throw new Error(`Unsupported market(s) in SYNC_MARKETS: ${invalid.join(', ')}`);
  }

  return new Set(markets);
}

export function isAccountActiveForRange(account, from, to) {
  if (account.enabled === false) return false;
  const activeFrom = account.activeFrom || account.active_from || '1900-01-01';
  const activeTo = account.activeTo || account.active_to || '2999-12-31';
  return !(activeTo < from || activeFrom > to);
}

export function assertSupportedMarket(market) {
  if (!SUPPORTED_MARKETS.has(market)) {
    throw new Error(`Unsupported market "${market}"`);
  }
}

export function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function integerOrNull(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Math.round(number);
}

export function microsToNative(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return number / 1_000_000;
}

export function nativeToMicros(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Math.round(number * 1_000_000);
}

export function currencyToCzk(value, currency, fxRates) {
  const number = numberOrNull(value);
  if (number === null) return null;
  const fxRate = fxRates[currency];
  if (fxRate == null) {
    throw new Error(`Missing FX rate for currency "${currency}". Add it to FX_RATES_JSON.`);
  }
  return roundMoney(number * fxRate);
}

export function roundMoney(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Number(number.toFixed(2));
}

export function roundMetric(value, digits = 6) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Number(number.toFixed(digits));
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashObject(value) {
  return createHash('sha1').update(stableJson(value)).digest('hex');
}

export function metricKey(parts) {
  return hashObject(parts);
}

export function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function supabaseRequest({ supabaseUrl, serviceRoleKey, path, method = 'GET', body, searchParams, prefer }) {
  const endpoint = new URL(path, supabaseUrl);
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (value !== undefined && value !== null) endpoint.searchParams.set(key, value);
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(endpoint, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase request failed (${response.status}) ${method} ${endpoint.pathname}: ${text}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function upsertSupabaseRows({ rows, supabaseUrl, serviceRoleKey, table, onConflict, chunkSize = 500 }) {
  if (!rows.length) return 0;

  let total = 0;
  for (const chunk of chunkArray(rows, chunkSize)) {
    await supabaseRequest({
      supabaseUrl,
      serviceRoleKey,
      path: `/rest/v1/${table}`,
      method: 'POST',
      searchParams: { on_conflict: onConflict },
      body: chunk,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    total += chunk.length;
  }
  return total;
}

export async function insertRawInsights({ rows, supabaseUrl, serviceRoleKey }) {
  return upsertSupabaseRows({
    rows,
    supabaseUrl,
    serviceRoleKey,
    table: 'ad_raw_insights',
    onConflict: 'raw_key',
    chunkSize: 250,
  });
}

export async function startSyncRun({ provider, syncType, from, to, supabaseUrl, serviceRoleKey }) {
  const rows = await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path: '/rest/v1/ad_sync_runs',
    method: 'POST',
    body: [
      {
        provider,
        sync_type: syncType,
        range_from: from,
        range_to: to,
        status: 'running',
      },
    ],
    prefer: 'return=representation',
  });

  return rows?.[0]?.id || null;
}

export async function finishSyncRun({
  id,
  status,
  rowsUpserted,
  warnings = [],
  errorMessage = null,
  supabaseUrl,
  serviceRoleKey,
}) {
  if (!id) return;
  await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path: '/rest/v1/ad_sync_runs',
    method: 'PATCH',
    searchParams: { id: `eq.${id}` },
    body: {
      status,
      rows_upserted: rowsUpserted,
      warnings,
      error_message: errorMessage,
      finished_at: new Date().toISOString(),
    },
    prefer: 'return=minimal',
  });
}

export function extractMetaActionStats(stats, candidates) {
  if (!Array.isArray(stats)) return null;
  for (const candidate of candidates) {
    const row = stats.find((item) => item.action_type === candidate);
    const value = numberOrNull(row?.value);
    if (value !== null) return value;
  }
  return null;
}

export function normalizeActionStats(stats) {
  if (!Array.isArray(stats)) return {};
  return stats.reduce((acc, item) => {
    if (item?.action_type) acc[item.action_type] = numberOrNull(item.value) ?? item.value ?? null;
    return acc;
  }, {});
}
