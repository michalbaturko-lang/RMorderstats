#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { convertCurrencyToCzk } from '../src/currencyRates.js';
import {
  attachPurchasePriceLookup,
  buildPurchasePriceLookup,
  getLineBuyPriceWithoutVat,
  getOrderLineItems,
  getRawBuyPriceWithoutVat,
} from '../src/orderLineItems.js';

const CONTROL_PRODUCTS = {
  '2401005061050Z1': { CZK: 330, EUR: 13.6, HUF: 4836.58, RON: 71.26 },
  '15070304700Z1': { CZK: 158, EUR: 6.51, HUF: 2315.7, RON: 34.12 },
};

function approx(actual, expected, tolerance = 0.02) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

async function parseEnvFile(filePath) {
  const env = {};
  const text = await fs.readFile(filePath, 'utf8');
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

async function supabaseGet(env, path) {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.json();
}

function testRawBuyPriceVatHandling() {
  approx(getRawBuyPriceWithoutVat({ buy_price: 4836.58, vat: 0 }), 4836.58);
  approx(getRawBuyPriceWithoutVat({ buy_price: 6142.46, vat: 27 }), 4836.58, 0.01);
  approx(getRawBuyPriceWithoutVat({ buy_price: 399, vat: 21 }), 329.75, 0.01);
}

function testOrderItemPrefersRawSnapshot() {
  const order = {
    order_items: [
      {
        product_code: '2401005061050Z1',
        quantity: 3,
        buy_price: 3808.33,
        unit_price_without_vat: 21945.67,
        total_price_without_vat: 65837.01,
        vat_rate: 0,
      },
    ],
    raw_data: {
      products: [
        {
          code: '2401005061050Z1',
          buy_price: 4836.58,
          vat: 0,
        },
      ],
    },
  };

  const [line] = getOrderLineItems(order, { allowRawFallback: false });
  approx(getLineBuyPriceWithoutVat(line), 4836.58);
  assert.equal(line.source, 'raw_products_snapshot');
}

function testCatalogPriceBeatsGrossRawSnapshot() {
  const lookup = buildPurchasePriceLookup([
    {
      product_code: '2401005061050Z1',
      currency: 'HUF',
      purchase_price_without_vat_native: 4836.58,
    },
  ]);
  const [order] = attachPurchasePriceLookup([{
    currency: 'HUF',
    order_items: [
      {
        product_code: '2401005061050Z1',
        quantity: 1,
        buy_price: 4836.58,
        unit_price_without_vat: 21945.67,
        total_price_without_vat: 21945.67,
        vat_rate: 27,
      },
    ],
    raw_data: {
      products: [
        {
          code: '2401005061050Z1',
          buy_price: 6142.46,
          vat: 27,
        },
      ],
    },
  }], lookup);

  const [line] = getOrderLineItems(order, { allowRawFallback: false });
  approx(getLineBuyPriceWithoutVat(line), 4836.58, 0.01);
  assert.equal(line.source, 'purchase_price_catalog');
}

function testOrderItemFallback() {
  const order = {
    order_items: [
      {
        product_code: '15070304700Z1',
        quantity: 1,
        buy_price: 158,
        unit_price_without_vat: 309.09,
        total_price_without_vat: 309.09,
      },
    ],
    raw_data: { products: [] },
  };

  const [line] = getOrderLineItems(order, { allowRawFallback: false });
  approx(getLineBuyPriceWithoutVat(line), 158);
  assert.equal(line.source, 'order_items');
}

function testFxControls() {
  approx(convertCurrencyToCzk(4836.58, 'HUF'), 330, 0.05);
  approx(convertCurrencyToCzk(13.6, 'EUR'), 330, 0.1);
  approx(convertCurrencyToCzk(2315.7, 'HUF'), 158, 0.05);
  approx(convertCurrencyToCzk(6.51, 'EUR'), 158, 0.15);
}

async function testSupabasePurchaseRows() {
  const env = await parseEnvFile('.env.ads');
  const codes = Object.keys(CONTROL_PRODUCTS);
  const rows = await supabaseGet(
    env,
    `/rest/v1/upgates_product_purchase_prices_current?select=product_code,currency,purchase_price_without_vat_native&product_code=in.(${codes.join(',')})`,
  );
  const byKey = new Map(rows.map((row) => [`${row.product_code}:${row.currency}`, Number(row.purchase_price_without_vat_native)]));

  for (const [code, expectedByCurrency] of Object.entries(CONTROL_PRODUCTS)) {
    for (const [currency, expected] of Object.entries(expectedByCurrency)) {
      const actual = byKey.get(`${code}:${currency}`);
      assert.ok(actual != null, `Missing Supabase purchase price for ${code}/${currency}`);
      approx(actual, expected, currency === 'HUF' ? 1 : 0.02);
    }
  }
}

async function main() {
  testRawBuyPriceVatHandling();
  testOrderItemPrefersRawSnapshot();
  testCatalogPriceBeatsGrossRawSnapshot();
  testOrderItemFallback();
  testFxControls();
  await testSupabasePurchaseRows();

  console.log('OK: margin purchase-price tests passed');
}

main().catch((error) => {
  console.error('[verify-margin-purchase-prices] FAILED:', error.message);
  process.exit(1);
});
