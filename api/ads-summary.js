import { createClient } from '@supabase/supabase-js';
import { MODULE_IDS, canAccessModule, normalizeEmail } from '../src/userPermissions.js';

const DEFAULT_SUPABASE_URL = 'https://oonnawrfsbsbuijmfcqj.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vbm5hd3Jmc2JzYnVpam1mY3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMjA4ODcsImV4cCI6MjA4NTg5Njg4N30.d1jk1BYOc6eEx-KJzGpW3ekfDs4jxW10VgKmLef8f1Y';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ALLOWED_DOMAINS = (process.env.AUTH_ALLOWED_EMAIL_DOMAINS || 'regalmaster.cz,smartbidding.cz')
  .split(',')
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);
const MARKET_ORDER = ['cz', 'sk', 'hu', 'ro', 'unknown'];

function emptyAdsSummary() {
  return {
    rows: 0,
    spend: 0,
    clicks: 0,
    conversions: 0,
    conversionValue: 0,
    providers: [],
    markets: [],
    marketBreakdown: [],
    providerBreakdown: [],
    firstDate: '',
    lastDate: '',
    syncFreshness: [],
    warnings: [],
  };
}

function withCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
}

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

async function authenticate(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: { status: 401, message: 'Chybí přihlášení.' } };

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user) {
    return { error: { status: 401, message: 'Nepodařilo se ověřit uživatele.' } };
  }

  const email = normalizeEmail(data.user.email);
  const domain = email.split('@')[1] || '';
  if (!ALLOWED_DOMAINS.includes(domain)) {
    return { error: { status: 403, message: `Email ${email || 'bez emailu'} není povolený pro Ads.` } };
  }
  if (!canAccessModule(email, MODULE_IDS.ADS)) {
    return { error: { status: 403, message: 'Reklamy nejsou pro tento účet povolené.' } };
  }

  return { user: data.user };
}

function buildSummary(rows) {
  const summary = emptyAdsSummary();
  const providerSet = new Set();
  const marketSet = new Set();
  const dateSet = new Set();
  const byProvider = new Map();
  const byMarket = new Map();

  for (const row of rows) {
    const spend = Number(row.spend_czk || 0);
    const clicks = Number(row.clicks || 0);
    const conversions = Number(row.conversions || 0);
    const conversionValue = Number(row.conversion_value_czk || 0);
    const provider = row.provider || 'unknown';
    const market = row.market || 'unknown';
    const date = row.date || '';

    summary.rows += 1;
    summary.spend += spend;
    summary.clicks += clicks;
    summary.conversions += conversions;
    summary.conversionValue += conversionValue;

    if (provider) providerSet.add(provider);
    if (market) marketSet.add(market);
    if (date) dateSet.add(date);

    if (!byProvider.has(provider)) {
      byProvider.set(provider, {
        provider,
        spend: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
        rowCount: 0,
      });
    }
    const providerTarget = byProvider.get(provider);
    providerTarget.spend += spend;
    providerTarget.clicks += clicks;
    providerTarget.conversions += conversions;
    providerTarget.conversionValue += conversionValue;
    providerTarget.rowCount += 1;

    if (!byMarket.has(market)) {
      byMarket.set(market, {
        market,
        spend: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
        googleSpend: 0,
        metaSpend: 0,
      });
    }
    const marketTarget = byMarket.get(market);
    marketTarget.spend += spend;
    marketTarget.clicks += clicks;
    marketTarget.conversions += conversions;
    marketTarget.conversionValue += conversionValue;
    if (provider === 'google_ads') marketTarget.googleSpend += spend;
    if (provider === 'meta_ads') marketTarget.metaSpend += spend;
  }

  const dates = Array.from(dateSet).sort();
  summary.providers = Array.from(providerSet).sort();
  summary.markets = Array.from(marketSet).sort();
  summary.firstDate = dates[0] || '';
  summary.lastDate = dates[dates.length - 1] || '';
  summary.providerBreakdown = Array.from(byProvider.values())
    .map((row) => ({
      ...row,
      sharePct: summary.spend ? (row.spend / summary.spend) * 100 : 0,
    }))
    .sort((a, b) => b.spend - a.spend);
  summary.marketBreakdown = Array.from(byMarket.values()).sort((a, b) => {
    const ai = MARKET_ORDER.indexOf(a.market);
    const bi = MARKET_ORDER.indexOf(b.market);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.market.localeCompare(b.market);
  });

  return summary;
}

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase();
}

function providerLabel(provider) {
  if (provider === 'google_ads') return 'Google Ads';
  if (provider === 'meta_ads') return 'Meta Ads';
  return provider || 'Ads';
}

function pragueDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function ageMinutes(value) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return (Date.now() - timestamp) / 60000;
}

function formatPragueTimestamp(value) {
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime())) return 'bez času';
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function summarizeSyncFreshness({ provider, rows, dateTo, needsCurrentFreshness }) {
  const providerRows = rows.filter((row) => (
    normalizeProvider(row.provider) === provider &&
    String(row.sync_type || '').toLowerCase().includes('campaign')
  ));
  const latest = providerRows[0];
  const latestSuccess = providerRows.find((row) => normalizeProvider(row.status) === 'success');
  const label = providerLabel(provider);

  if (!latest) {
    return {
      provider,
      status: 'fail',
      latestStatus: null,
      lastSuccessAt: null,
      lastSuccessAgeMinutes: null,
      lastSuccessRangeFrom: null,
      lastSuccessRangeTo: null,
      message: `${label}: nevidím žádný campaign sync run, takže Ads spend pro ${dateTo} není potvrzený.`,
    };
  }

  const latestStatus = normalizeProvider(latest.status) || 'unknown';
  const latestFinishedAt = latest.finished_at || latest.started_at || null;
  const latestSuccessFinishedAt = latestSuccess?.finished_at || latestSuccess?.started_at || null;
  const latestSuccessRangeTo = latestSuccess?.range_to || null;
  const latestActiveRefresh = ['running', 'pending'].includes(latestStatus);
  const latestFinishedNonSuccess = ['failed', 'partial_success'].includes(latestStatus);
  const latestFailedAfterSuccess = latestFinishedNonSuccess && (
    !latestSuccessFinishedAt ||
    Date.parse(String(latestFinishedAt || '')) >= Date.parse(String(latestSuccessFinishedAt))
  );

  if (!latestSuccess || !latestSuccessRangeTo || latestSuccessRangeTo < dateTo) {
    return {
      provider,
      status: 'fail',
      latestStatus,
      lastSuccessAt: latestSuccessFinishedAt,
      lastSuccessAgeMinutes: latestSuccessFinishedAt ? Math.round(ageMinutes(latestSuccessFinishedAt)) : null,
      lastSuccessRangeFrom: latestSuccess?.range_from || null,
      lastSuccessRangeTo: latestSuccessRangeTo,
      message: `${label}: poslední úspěšný campaign sync nepokrývá ${dateTo}, takže aktuální Ads spend může být neúplný.`,
    };
  }

  if (needsCurrentFreshness && latestFailedAfterSuccess) {
    const failureText = latestStatus === 'partial_success' ? 'neproběhl kompletně' : 'selhal';
    return {
      provider,
      status: 'fail',
      latestStatus,
      lastSuccessAt: latestSuccessFinishedAt,
      lastSuccessAgeMinutes: latestSuccessFinishedAt ? Math.round(ageMinutes(latestSuccessFinishedAt)) : null,
      lastSuccessRangeFrom: latestSuccess?.range_from || null,
      lastSuccessRangeTo: latestSuccessRangeTo,
      message: `${label}: nejnovější campaign sync ${failureText} ${formatPragueTimestamp(latestFinishedAt)}. Dashboard teď může ukazovat jen částečný dnešní snapshot z posledního úspěšného běhu ${formatPragueTimestamp(latestSuccessFinishedAt)}.`,
    };
  }

  const activeAge = latestFinishedAt ? ageMinutes(latestFinishedAt) : Number.POSITIVE_INFINITY;
  if (needsCurrentFreshness && latestActiveRefresh && latest.range_to >= dateTo && activeAge <= 45) {
    return {
      provider,
      status: 'ok',
      latestStatus,
      lastSuccessAt: latestSuccessFinishedAt,
      lastSuccessAgeMinutes: latestSuccessFinishedAt ? Math.round(ageMinutes(latestSuccessFinishedAt)) : null,
      lastSuccessRangeFrom: latestSuccess?.range_from || null,
      lastSuccessRangeTo: latestSuccessRangeTo,
      message: `${label}: právě běží čerstvý campaign sync (${formatPragueTimestamp(latestFinishedAt)}), poslední úspěšný běh pokrývá ${latestSuccessRangeTo}.`,
    };
  }

  const successAge = latestSuccessFinishedAt ? ageMinutes(latestSuccessFinishedAt) : Number.POSITIVE_INFINITY;
  if (needsCurrentFreshness && successAge > 45) {
    return {
      provider,
      status: 'warn',
      latestStatus,
      lastSuccessAt: latestSuccessFinishedAt,
      lastSuccessAgeMinutes: Math.round(successAge),
      lastSuccessRangeFrom: latestSuccess?.range_from || null,
      lastSuccessRangeTo: latestSuccessRangeTo,
      message: `${label}: poslední úspěšný campaign sync je starý ${Math.round(successAge)} min (${formatPragueTimestamp(latestSuccessFinishedAt)}), takže dnešní spend už nemusí být aktuální.`,
    };
  }

  return {
    provider,
    status: 'ok',
    latestStatus,
    lastSuccessAt: latestSuccessFinishedAt,
    lastSuccessAgeMinutes: Number.isFinite(successAge) ? Math.round(successAge) : null,
    lastSuccessRangeFrom: latestSuccess?.range_from || null,
    lastSuccessRangeTo: latestSuccessRangeTo,
    message: `${label}: campaign sync je čerstvý (${formatPragueTimestamp(latestSuccessFinishedAt)}).`,
  };
}

async function fetchAdsRows({ dateFrom, dateTo, country }) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const endpoint = new URL('/rest/v1/ad_metrics_daily', SUPABASE_URL);
    endpoint.searchParams.set('select', 'date,provider,market,spend_czk,clicks,conversions,conversion_value_czk');
    endpoint.searchParams.append('date', `gte.${dateFrom}`);
    endpoint.searchParams.append('date', `lte.${dateTo}`);
    endpoint.searchParams.set('level', 'eq.campaign');
    endpoint.searchParams.set('order', 'date.asc');
    if (country && country !== 'all') endpoint.searchParams.set('market', `eq.${country}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('upstream request timeout')), 4000);
    const response = await fetch(endpoint, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Range: `${from}-${from + pageSize - 1}`,
        Prefer: 'count=exact',
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase Ads query failed (${response.status}): ${text}`);
    }

    const text = await response.text();
    const chunk = text ? JSON.parse(text) : [];
    const pageRows = Array.isArray(chunk) ? chunk : [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }

  return rows;
}

async function fetchSyncFreshness({ dateTo }) {
  const endpoint = new URL('/rest/v1/ad_sync_runs', SUPABASE_URL);
  endpoint.searchParams.set('select', 'provider,sync_type,range_from,range_to,status,rows_upserted,error_message,started_at,finished_at');
  endpoint.searchParams.set('provider', 'in.(google_ads,meta_ads)');
  endpoint.searchParams.set('order', 'started_at.desc');
  endpoint.searchParams.set('limit', '80');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('upstream request timeout')), 4000);
  const response = await fetch(endpoint, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase sync query failed (${response.status}): ${text}`);
  }

  const text = await response.text();
  const rows = text ? JSON.parse(text) : [];
  const needsCurrentFreshness = dateTo >= pragueDateKey();
  return ['google_ads', 'meta_ads'].map((provider) =>
    summarizeSyncFreshness({ provider, rows: Array.isArray(rows) ? rows : [], dateTo, needsCurrentFreshness })
  );
}

async function handle(req, res) {
  withCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const dateFrom = String(req.query.dateFrom || '');
  const dateTo = String(req.query.dateTo || '');
  const country = String(req.query.country || 'all');

  if (!isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo)) {
    return res.status(400).json({ error: 'Neplatné datum. Očekávám YYYY-MM-DD.' });
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Na serveru chybí SUPABASE_SERVICE_ROLE_KEY.' });
  }

  const auth = await authenticate(req);
  if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message });

  try {
    const [data, syncFreshness] = await Promise.all([
      fetchAdsRows({ dateFrom, dateTo, country }),
      fetchSyncFreshness({ dateTo }),
    ]);
    const summary = buildSummary(data);
    summary.syncFreshness = syncFreshness;
    summary.warnings = syncFreshness
      .filter((item) => item.status !== 'ok')
      .map((item) => item.message);
    return res.status(200).json(summary);
  } catch (error) {
    return res.status(500).json({
      error: `Ads souhrn se nepodařilo načíst: ${error.message || 'neznámá chyba'}`,
    });
  }
}

export default handle;
