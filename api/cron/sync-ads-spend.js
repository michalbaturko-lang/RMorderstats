import { runAdsAnalyticsSync } from '../../scripts/sync-ads-analytics.mjs';
import { FX_RATES_TO_CZK } from '../../src/currencyRates.js';

const DEFAULT_FX_RATES_JSON = JSON.stringify(FX_RATES_TO_CZK);

function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(payload));
}

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, reason: 'Na serveru chybi CRON_SECRET.' };
  const authHeader = req.headers.authorization || '';
  return authHeader === `Bearer ${secret}`
    ? { ok: true }
    : { ok: false, reason: 'Unauthorized cron request.' };
}

export default async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  const auth = isAuthorized(req);
  if (!auth.ok) {
    const status = auth.reason === 'Unauthorized cron request.' ? 401 : 500;
    return json(res, status, { ok: false, error: auth.reason });
  }

  const startedAt = new Date().toISOString();
  const syncWindowDays = String(process.env.ADS_SPEND_CRON_DAYS_BACK || '1');

  try {
    const result = await runAdsAnalyticsSync({
      envOverrides: {
        ADS_SYNC_PROVIDERS: process.env.ADS_SPEND_PROVIDERS || 'google_ads,meta_ads',
        ADS_SYNC_SKIP_MISSING_SECRETS: '1',
        SYNC_DAYS_BACK: syncWindowDays,
        FX_RATES_JSON: process.env.FX_RATES_JSON || DEFAULT_FX_RATES_JSON,
        GOOGLE_ADS_DETAIL_LEVELS: process.env.GOOGLE_ADS_SPEND_LEVELS || 'campaign,hour',
        META_ADS_DETAIL_LEVELS: process.env.META_ADS_SPEND_LEVELS || 'campaign',
      },
    });

    return json(res, 200, {
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      syncWindowDays,
      ...result,
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error.message,
    });
  }
}
