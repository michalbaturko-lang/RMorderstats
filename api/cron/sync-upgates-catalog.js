import { runUpgatesPurchasePricesSync } from '../../scripts/sync-upgates-purchase-prices.mjs';
import { runUpgatesStockSync } from '../../scripts/sync-upgates-stock.mjs';

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

function bufferedLogger() {
  const lines = [];
  return {
    lines,
    log(message) {
      lines.push(String(message));
    },
    warn(message) {
      lines.push(`[warn] ${String(message)}`);
    },
  };
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
  const logger = bufferedLogger();

  try {
    const [purchasePrices, stock] = await Promise.all([
      runUpgatesPurchasePricesSync({ logger }),
      runUpgatesStockSync({ logger }),
    ]);
    const finishedAt = new Date().toISOString();

    console.log('[sync-upgates-catalog] ok', JSON.stringify({
      startedAt,
      finishedAt,
      purchasePriceRows: purchasePrices.rows,
      stockRows: stock.rows,
      knownStockRows: stock.knownStockRows,
      unknownStockRows: stock.unknownStockRows,
    }));

    return json(res, 200, {
      ok: true,
      startedAt,
      finishedAt,
      purchasePrices,
      stock,
      log: logger.lines.slice(-40),
    });
  } catch (error) {
    console.error('[sync-upgates-catalog] failed', error);
    return json(res, 500, {
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error.message,
      log: logger.lines.slice(-40),
    });
  }
}
