#!/usr/bin/env node

/**
 * Syncs current UpGates product stock into Supabase.
 *
 * UpGates is read-only here. Supabase writes are restricted to
 * public.upgates_product_stock_daily.
 */

import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const RM_ENV_PATH = '.env.ads';
const LOCAL_UPGATES_ENV_PATH = '/Users/mbo/Documents/Claude/Projects/Výprodej-regálů.cz/bazarovyregal-shopify/secrets/.env.local';
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
    'User-Agent': 'RegalMaster stock sync/1.0',
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

function stockRow({ product, snapshotDate, fetchedAt }) {
  const code = normalizeText(product.code || product.CODE);
  if (!code) return null;

  const stockQuantity = toNumber(product.stock);
  return {
    stock_key: `${snapshotDate}:${code}`,
    snapshot_date: snapshotDate,
    product_code: code,
    ean: normalizeText(product.ean) || null,
    title: firstTitle(product) || null,
    stock_quantity: stockQuantity,
    stock_status: stockQuantity == null ? 'unknown' : 'known',
    availability: normalizeText(product.availability) || null,
    availability_type: normalizeText(product.availability_type) || null,
    upgates_product_id: product.product_id == null ? null : String(product.product_id),
    is_active: toBool(product.active_yn),
    is_archived: toBool(product.archived_yn),
    can_add_to_basket: toBool(product.can_add_to_basket_yn),
    upgates_updated_at: normalizeText(product.last_update_time) || null,
    raw_data: product || {},
    fetched_at: fetchedAt,
    updated_at: fetchedAt,
  };
}

function buildRows(products, snapshotDate) {
  const fetchedAt = new Date().toISOString();
  const rowsByCode = new Map();

  for (const product of products) {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    if (variants.length) {
      for (const variant of variants) {
        const row = stockRow({
          product: {
            ...product,
            ...variant,
            descriptions: variant.descriptions || product.descriptions,
            product_id: variant.product_id || product.product_id,
          },
          snapshotDate,
          fetchedAt,
        });
        if (row) rowsByCode.set(row.product_code, row);
      }
      continue;
    }

    const row = stockRow({ product, snapshotDate, fetchedAt });
    if (row) rowsByCode.set(row.product_code, row);
  }

  return Array.from(rowsByCode.values());
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
      `${supabaseUrl}/rest/v1/upgates_product_stock_daily?on_conflict=stock_key`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(chunk),
      },
      `Supabase upsert UpGates stock ${index + 1}-${index + chunk.length}`,
    );
    logger.log?.(`Supabase stock upsert: ${index + chunk.length}/${rows.length}`);
  }
}

export async function runUpgatesStockSync({ envOverrides = {}, logger = console } = {}) {
  const env = await loadEnv(envOverrides);
  const snapshotDate = env.SNAPSHOT_DATE || new Date().toISOString().slice(0, 10);
  const products = await fetchUpgatesProducts(env, logger);
  const rows = buildRows(products, snapshotDate);
  const knownStockRows = rows.filter((row) => row.stock_status === 'known').length;
  await upsertRows(env, rows, logger);

  return {
    ok: true,
    snapshotDate,
    products: products.length,
    rows: rows.length,
    knownStockRows,
    unknownStockRows: rows.length - knownStockRows,
  };
}

async function main() {
  const result = await runUpgatesStockSync();
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[sync-upgates-stock] FAILED:', error.message);
    process.exit(1);
  });
}
