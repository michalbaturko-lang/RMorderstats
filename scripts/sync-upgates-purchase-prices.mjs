#!/usr/bin/env node

/**
 * Syncs current UpGates catalog purchase prices into Supabase.
 *
 * UpGates is read-only here. Supabase writes are restricted to
 * public.upgates_product_purchase_prices_daily.
 */

import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { FX_RATES_TO_CZK } from '../src/currencyRates.js';

const RM_ENV_PATH = '.env.ads';
const LOCAL_UPGATES_ENV_PATH = '/Users/mbo/Documents/Claude/Projects/V\u00fdprodej-reg\u00e1l\u016f.cz/bazarovyregal-shopify/secrets/.env.local';
const MARKET_BY_CURRENCY = {
  CZK: { market: 'cz', language: 'cs' },
  EUR: { market: 'sk', language: 'sv' },
  HUF: { market: 'hu', language: 'ho' },
  RON: { market: 'ro', language: 'ru' },
};
const PAGE_DELAY_MS = 60;
const UPSERT_CHUNK_SIZE = 500;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function toBool(value) {
  if (value === true || value === '1' || value === 1) return true;
  if (value === false || value === '0' || value === 0) return false;
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseEnvFile(filePath, optional = false) {
  let text = '';
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (optional) return {};
    throw error;
  }

  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function loadEnv(envOverrides = {}) {
  const repoEnv = await parseEnvFile(RM_ENV_PATH, true);
  const upgatesEnv = await parseEnvFile(LOCAL_UPGATES_ENV_PATH, true);
  return {
    ...repoEnv,
    ...upgatesEnv,
    ...process.env,
    ...envOverrides,
  };
}

function requireEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function basicAuth(login, key) {
  return `Basic ${Buffer.from(`${login}:${key}`).toString('base64')}`;
}

async function fetchJson(url, options, label) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function fetchUpgatesProducts(env, logger = console) {
  const base = requireEnv(env, 'UPGATES_API_URL').replace(/\/$/, '');
  const auth = basicAuth(requireEnv(env, 'UPGATES_API_LOGIN'), requireEnv(env, 'UPGATES_API_KEY'));
  const headers = {
    Authorization: auth,
    Accept: 'application/json',
    'User-Agent': 'RegalMaster purchase-price sync/1.0',
  };

  const products = [];
  let page = 1;
  let pages = 1;

  while (page <= pages) {
    const data = await fetchJson(`${base}/products?page=${page}`, { headers }, `UpGates GET /products page=${page}`);
    const batch = data.products || data.data || [];
    products.push(...batch);
    pages = Number(data.number_of_pages || data.pages || pages || 1);
    logger.log?.(`UpGates page ${page}/${pages}: +${batch.length}, total ${products.length}`);
    page += 1;
    if (page <= pages) await sleep(PAGE_DELAY_MS);
  }

  return products;
}

function firstTitle(product) {
  const descriptions = Array.isArray(product?.descriptions) ? product.descriptions : [];
  const description = descriptions.find((item) => item?.language === 'cs') || descriptions[0] || null;
  return normalizeText(description?.title || description?.name || '');
}

function bundleInfo(code) {
  const match = String(code || '').match(/_(\d+)$/);
  if (!match) return { baseCode: code, bundleQuantity: 1, isBundle: false };
  return {
    baseCode: String(code).replace(/_\d+$/, ''),
    bundleQuantity: Number(match[1]),
    isBundle: true,
  };
}

function priceRecord({ product, price, snapshotDate, fetchedAt }) {
  const code = normalizeText(product.code || product.CODE);
  const currency = normalizeText(price?.currency).toUpperCase();
  const marketConfig = MARKET_BY_CURRENCY[currency];
  if (!code || !marketConfig) return null;

  const purchasePrice = toNumber(price?.price_purchase);
  const fxToCzk = FX_RATES_TO_CZK[currency] || null;
  const { baseCode, bundleQuantity, isBundle } = bundleInfo(code);
  const pricelist = Array.isArray(price?.pricelists) ? price.pricelists[0] : null;

  return {
    price_key: `${snapshotDate}:${marketConfig.market}:${code}`,
    snapshot_date: snapshotDate,
    product_code: code,
    market: marketConfig.market,
    currency,
    purchase_price_without_vat_native: purchasePrice,
    purchase_price_czk: purchasePrice != null && fxToCzk != null ? purchasePrice * fxToCzk : null,
    fx_to_czk: fxToCzk,
    vat_rate: toNumber(price?.vat),
    sale_price_without_vat_native: toNumber(pricelist?.price_without_vat ?? pricelist?.price_sale),
    sale_price_with_vat_native: toNumber(pricelist?.price_with_vat),
    upgates_product_id: product.product_id == null ? null : String(product.product_id),
    ean: normalizeText(product.ean) || null,
    title: firstTitle(product) || null,
    base_code: baseCode,
    bundle_quantity: bundleQuantity,
    is_bundle: isBundle,
    stock_quantity: toNumber(product.stock),
    is_active: toBool(product.active_yn),
    is_archived: toBool(product.archived_yn),
    can_add_to_basket: toBool(product.can_add_to_basket_yn),
    upgates_updated_at: normalizeText(product.last_update_time) || null,
    raw_price: price || {},
    raw_data: product || {},
    fetched_at: fetchedAt,
    updated_at: fetchedAt,
  };
}

function buildRows(products, snapshotDate) {
  const fetchedAt = new Date().toISOString();
  const rows = [];
  for (const product of products) {
    const prices = Array.isArray(product?.prices) ? product.prices : [];
    for (const price of prices) {
      const row = priceRecord({ product, price, snapshotDate, fetchedAt });
      if (row) rows.push(row);
    }
  }
  return rows;
}

async function upsertRows(env, rows, logger = console) {
  const supabaseUrl = requireEnv(env, 'SUPABASE_URL').replace(/\/$/, '');
  const serviceRoleKey = requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY');
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };

  for (let index = 0; index < rows.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + UPSERT_CHUNK_SIZE);
    await fetchJson(
      `${supabaseUrl}/rest/v1/upgates_product_purchase_prices_daily?on_conflict=price_key`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(chunk),
      },
      `Supabase upsert purchase prices ${index + 1}-${index + chunk.length}`,
    );
    logger.log?.(`Supabase upsert: ${index + chunk.length}/${rows.length}`);
  }
}

export async function runUpgatesPurchasePricesSync({ envOverrides = {}, logger = console } = {}) {
  const env = await loadEnv(envOverrides);
  const snapshotDate = env.SNAPSHOT_DATE || new Date().toISOString().slice(0, 10);
  const products = await fetchUpgatesProducts(env, logger);
  const rows = buildRows(products, snapshotDate);
  const rowsWithPurchase = rows.filter((row) => row.purchase_price_without_vat_native != null).length;
  await upsertRows(env, rows, logger);

  return {
    ok: true,
    snapshotDate,
    products: products.length,
    rows: rows.length,
    rowsWithPurchase,
  };
}

async function main() {
  const result = await runUpgatesPurchasePricesSync();
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[sync-upgates-purchase-prices] FAILED:', error.message);
    process.exit(1);
  });
}
