#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  allocateFreightByValue,
  buildSalesVelocity,
  predictStockoutDate,
} from '../src/importLogisticsCore.js';
import { buildImportLogisticsDataset } from './lib/import-logistics-excel.mjs';

const IMPORT_WORKBOOK = '/Users/mbo/Downloads/RM importní logistika (2).xlsx';
const MASTER_WORKBOOK = '/Users/mbo/Downloads/RM_Master_Doc_ver01.xlsx';
const CHINA13_PROFORMA = '/Users/mbo/Library/Mobile Documents/com~apple~CloudDocs/PI D-202601ML.pdf';

const dataset = await buildImportLogisticsDataset({
  importWorkbookPath: IMPORT_WORKBOOK,
  masterWorkbookPath: MASTER_WORKBOOK,
  china13ProformaPath: CHINA13_PROFORMA,
});

assert.deepEqual(dataset.auditFailures, [], 'dry-run audit must match expected import counts');
assert.equal(dataset.audit['Čína 6'].rows, 32);
assert.equal(dataset.audit['Čína 6'].totalQty, 3903);
assert.equal(dataset.audit['Čína 6'].missingPrices, 0);
assert.equal(dataset.audit['Čína 9'].rows, 32);
assert.equal(dataset.audit['Čína 9'].totalQty, 5800);
assert.equal(dataset.audit['Čína 9'].missingPrices, 0);
assert.equal(dataset.audit['Čína 10'].rows, 24);
assert.equal(dataset.audit['Čína 10'].totalQty, 10862);
assert.equal(dataset.audit['Čína 10'].missingPrices, 0);
assert.equal(dataset.audit['Čína 11'].exactMatches, 39);
assert.equal(dataset.audit['Čína 11'].missingPrices, 0);
assert.equal(dataset.audit['Čína 12'].exactMatches, 8);
assert.equal(dataset.audit['Čína 13'].sourceSheet, 'Čína 0526');
assert.equal(dataset.audit['Čína 13'].rows, 13);
assert.equal(dataset.audit['Čína 13'].exactMatches, 13);
assert.equal(dataset.audit['Čína 13'].qtyUnknown, 0);
assert.equal(dataset.audit['Čína 13'].totalQty, 2600);
assert.equal(dataset.audit['Čína 13'].missingPrices, 0);
assert.equal(dataset.audit['Čína 15'].rows, 2);
assert.equal(dataset.audit['Čína 15'].totalQty, 4284);
assert.equal(dataset.audit['Čína 15'].missingPrices, 0);
assert.equal(dataset.audit['Čína 15'].reviewRows, 0);
assert.equal(dataset.audit['Čína 16'].rows, 6);
assert.equal(dataset.audit['Čína 16'].totalQty, 1860);
assert.equal(dataset.audit['Čína 16'].missingPrices, 0);
assert.equal(dataset.audit['Čína 16'].reviewRows, 6);

const orderNames = dataset.orders.map((order) => order.orderCode);
assert(orderNames.includes('Čína 6'), 'Čína 6 / 26ML224E must be included as in-transit');
assert(orderNames.includes('Čína 13'), 'Čína 0526 source sheet must be normalized to Čína 13');
assert(!orderNames.includes('Čína 0526'), 'Čína 0526 must not appear as an order code');

const china6 = dataset.orders.find((order) => order.orderCode === 'Čína 6');
assert(china6, 'Čína 6 order exists');
assert.equal(china6.status, 'shipped');
assert.equal(china6.supplierOrderCode, '25ML1206E665');
assert.equal(china6.totalPcs, 3903);
assert.equal(china6.etaBrno, '2026-07-03');
assert.equal(china6.shipments[0].knTrackingNumber, '1073423125');
assert.equal(china6.shipments[0].billOfLading, '1073423125');
assert.equal(china6.shipments[0].commercialInvoiceNo, '26ML224E');
assert.equal(china6.shipments[0].allocatedQuantity, 3903);
assert.equal(china6.shipments[0].allocatedAmount, 61591.36);
assert.equal(china6.shipments[0].shippedDate, '2026-04-26');
assert.equal(china6.shipments[0].etaPort, '2026-06-19');
assert.equal(china6.shipments[0].etaBrno, '2026-07-03');
assert.equal(china6.shipments[0].containerCount, 2);
assert.equal(china6.shipments[0].loadingMethod, 'floor_loaded');
assert.equal(china6.shipments[0].palletized, false);
assert.equal(china6.shipments[0].loadingPhotos.length, 3);
assert.equal(china6.documents.length, 3);
assert.deepEqual(
  china6.documents.map((document) => document.documentType).sort(),
  ['bl_tracking', 'packing_list', 'supplier_invoice'],
);
assert.equal(china6.lines[0].unitPurchasePrice, 7.65);
assert.equal(china6.lines[0].purchaseCurrency, 'USD');
assert.equal(china6.lines.at(-1).itemModel, 'MH-101A');

const china9 = dataset.orders.find((order) => order.orderCode === 'Čína 9');
assert(china9, 'Čína 9 order exists');
assert.equal(china9.status, 'shipped');
assert.equal(china9.shipments[0].knTrackingNumber, '1073423126');
assert.equal(china9.shipments[0].billOfLading, '1073423126');
assert.equal(china9.shipments[0].commercialInvoiceNo, '26ML215E');
assert.equal(china9.shipments[0].allocatedQuantity, 5800);
assert.equal(china9.shipments[0].shippedDate, '2026-04-19');
assert.equal(china9.shipments[0].etaPort, '2026-06-12');
assert.equal(china9.shipments[0].etaBrno, '2026-06-26');
assert.equal(china9.shipments[0].containerCount, 7);
assert.equal(china9.lines[0].unitPurchasePrice, 7.44);
assert.equal(china9.lines[0].purchaseCurrency, 'USD');
const cornerCodes = china9.lines.slice(-2).map((line) => line.matchedCode);
assert.deepEqual(cornerCodes, ['18090405875Z3CORNER', '18090405875BLACK3CORNER']);

const china10 = dataset.orders.find((order) => order.orderCode === 'Čína 10');
assert.equal(china10.status, 'shipped');
assert.equal(china10.shipments.length, 2);
assert.equal(china10.shipments[0].knTrackingNumber, '1073422970');
assert.equal(china10.shipments[0].billOfLading, '1073422970');
assert.equal(china10.shipments[0].commercialInvoiceNo, '26ML183E');
assert.equal(china10.shipments[0].allocatedQuantity, 4862);
assert.equal(china10.shipments[0].shippedDate, '2026-04-05');
assert.equal(china10.shipments[0].etaPort, '2026-06-16');
assert.equal(china10.shipments[0].etaBrno, '2026-06-30');
assert.equal(china10.shipments[0].containerCount, 2);
assert.equal(china10.shipments[0].loadingMethod, 'palletized');
assert.equal(china10.shipments[0].palletized, true);
assert.equal(china10.shipments[0].loadingPhotos.length, 3);
assert.equal(china10.shipments[1].knTrackingNumber, '1073423126');
assert.equal(china10.shipments[1].commercialInvoiceNo, '26ML215E');
assert.equal(china10.shipments[1].allocatedQuantity, 6000);
assert.equal(china10.shipments[1].shippedDate, '2026-04-19');
assert.equal(china10.shipments[1].etaPort, '2026-06-12');
assert.equal(china10.shipments[1].etaBrno, '2026-06-26');
assert.equal(china10.shipments[1].containerCount, 7);
assert.equal(Math.round((china10.shipments[0].allocatedAmount + china10.shipments[1].allocatedAmount) * 100) / 100, 104504.3);
assert.equal(china10.lines[0].unitPurchasePrice, 6.93);
assert.equal(china10.lines[0].purchaseCurrency, 'USD');
const china10ReviewRows = china10.lines.filter((line) => line.match?.auditStatus === 'review');
assert.equal(china10ReviewRows.length, 0, 'Čína 10 manual review rows should now be resolved');
assert(china10.lines.some((line) => line.matchMethod === 'fallback_spec'), 'Čína 10 must keep confident fallback matches');
assert(china10.lines.some((line) => line.matchMethod === 'manual_verified'), 'Čína 10 must preserve manually selected matches');

const china11 = dataset.orders.find((order) => order.orderCode === 'Čína 11');
assert.equal(china11.status, 'objednano');
assert.equal(china11.shipments[0].status, 'objednano');
assert.equal(china11.shipments[0].shippedDate, null);
assert.equal(china11.shipments[0].etaBrno, null);
assert.equal(china11.shipments[0].containerCount, 4);
assert.equal(china11.shipments[0].allocatedAmount, 78404);
assert.equal(china11.lines[0].unitPurchasePrice, 6.25);
assert.equal(china11.lines[0].purchaseCurrency, 'USD');

const china12 = dataset.orders.find((order) => order.orderCode === 'Čína 12');
assert.equal(china12.status, 'objednano');
assert.equal(china12.supplierOrderCode, '26ML0429E246');
assert.equal(china12.shipments[0].containerCount, 4);
assert.equal(china12.shipments[0].containersText, '4x40GP');
assert.equal(china12.shipments[0].allocatedQuantity, 7530);
assert.equal(china12.shipments[0].allocatedAmount, 77543.5);
assert.equal(china12.lines[0].unitPurchasePrice, 8.75);
assert.equal(china12.lines[0].purchaseCurrency, 'USD');

const china13 = dataset.orders.find((order) => order.orderCode === 'Čína 13');
assert.equal(china13.status, 'objednano');
assert.equal(china13.supplierOrderCode, '202601ML');
assert.equal(china13.orderedDate, '2026-04-01');
assert.equal(china13.totalPcs, 2600);
assert(china13.lines.every((line) => line.quantity === 200), 'Čína 13 proforma fills 200 pcs on each line');
assert.equal(china13.lines[0].unitPurchasePrice, 12.8);
assert.equal(china13.lines[0].purchaseCurrency, 'USD');

const china15 = dataset.orders.find((order) => order.orderCode === 'Čína 15');
assert(china15, 'Čína 15 proforma order exists');
assert.equal(china15.status, 'objednano');
assert.equal(china15.supplierOrderCode, '26ML0611E370');
assert.equal(china15.sourceSheet, 'PI 26ML0611E370');
assert.equal(china15.totalPcs, 4284);
assert.equal(china15.shipments[0].status, 'objednano');
assert.equal(china15.shipments[0].containerCount, 2);
assert.equal(china15.shipments[0].containersText, '2x40HC');
assert.equal(china15.shipments[0].palletized, true);
assert.equal(china15.shipments[0].allocatedAmount, 34914.6);
assert.equal(china15.documents.length, 1);
assert.equal(china15.documents[0].documentType, 'supplier_proforma');
assert.equal(china15.lines.length, 2);
assert.equal(china15.lines[0].quantity, 2142);
assert.equal(china15.lines[0].unitPurchasePrice, 7.5);
assert.equal(china15.lines[0].purchaseCurrency, 'USD');
assert.deepEqual(china15.lines.map((line) => line.matchedCode), ['18090405875Z3', '18090405875BLACK3']);
assert(china15.lines.every((line) => line.matchMethod === 'manual_verified'), 'Čína 15 uses verified matches from the same spec as Čína 10');

const china16 = dataset.orders.find((order) => order.orderCode === 'Čína 16');
assert(china16, 'Čína 16 quotation order exists');
assert.equal(china16.status, 'objednano');
assert.equal(china16.supplierOrderCode, null);
assert.equal(china16.sourceSheet, 'Quotation 2026-04-30 INLAY');
assert.equal(china16.totalPcs, 1860);
assert.equal(china16.shipments[0].status, 'objednano');
assert.equal(china16.shipments[0].containerCount, 2);
assert.equal(china16.shipments[0].containersText, 'odhad 2x40GP');
assert.equal(china16.shipments[0].allocatedAmount, 47721);
assert.equal(china16.documents.length, 1);
assert.equal(china16.documents[0].documentType, 'other');
assert.equal(china16.lines.length, 6);
assert.equal(china16.lines[0].quantity, 350);
assert.equal(china16.lines[0].unitPurchasePrice, 22.95);
assert.equal(china16.lines[0].purchaseCurrency, 'USD');
assert(china16.lines.every((line) => line.match?.auditStatus === 'review'), 'Čína 16 needs match review until RM codes/EANs are known');

const freightRows = allocateFreightByValue([
  { sku: 'cheap', quantity: 10, unitPurchasePrice: 10 },
  { sku: 'expensive', quantity: 10, unitPurchasePrice: 100 },
], 110);
const cheap = freightRows.find((row) => row.sku === 'cheap');
const expensive = freightRows.find((row) => row.sku === 'expensive');
assert(expensive.allocatedFreight > cheap.allocatedFreight, 'expensive item gets higher absolute freight allocation');
assert.equal(Math.round((cheap.allocatedFreight + expensive.allocatedFreight) * 100) / 100, 110);

const mixedCurrencyFreightRows = allocateFreightByValue([
  { sku: 'usd-line', quantity: 1, unitPurchasePrice: 10, currency: 'USD' },
  { sku: 'czk-line', quantity: 1, unitPurchasePrice: 100, currency: 'CZK' },
], 309.58);
const usdLine = mixedCurrencyFreightRows.find((row) => row.sku === 'usd-line');
const czkLine = mixedCurrencyFreightRows.find((row) => row.sku === 'czk-line');
assert(usdLine.unitPurchasePriceCzk > 200, 'USD import unit cost must be converted to CZK before freight allocation');
assert(usdLine.allocatedFreight > czkLine.allocatedFreight, 'freight allocation compares goods value in CZK, not mixed currencies');

const asOfDate = new Date('2026-05-27T12:00:00Z');
const velocity = buildSalesVelocity([
  {
    order_date: '2026-05-26T10:00:00Z',
    market: 'cz',
    status: 'VYŘÍZENO',
    order_items: [{ product_code: 'SKU-1', quantity: 7 }],
  },
  {
    order_date: '2026-05-25T10:00:00Z',
    market: 'sk',
    status: 'STORNO',
    order_items: [{ product_code: 'SKU-1', quantity: 700 }],
  },
  {
    order_date: '2026-05-24T10:00:00Z',
    market: 'hu',
    status: 'Platba SELHAL',
    order_items: [{ product_code: 'SKU-1', quantity: 700 }],
  },
], { asOfDate });
assert.equal(velocity['SKU-1'][7].globalQty, 7, 'business-clean velocity excludes STORNO and SELHAL');
assert.equal(velocity['SKU-1'][7].byMarket.cz.quantity, 7);

const stockoutWithoutGrowth = predictStockoutDate({
  currentStock: 31,
  baseDailyDemand: 1,
  asOfDate,
  monthlyGrowth: 0,
  horizonDays: 40,
});
const stockoutWithGrowth = predictStockoutDate({
  currentStock: 31,
  baseDailyDemand: 1,
  asOfDate,
  monthlyGrowth: 0.2,
  horizonDays: 40,
});
assert(stockoutWithGrowth.dayIndex < stockoutWithoutGrowth.dayIndex, '+20% monthly growth pulls stockout earlier than flat demand');

console.log(JSON.stringify({
  ok: true,
  audit: dataset.audit,
  china10ReviewRows: china10ReviewRows.length,
  freightAllocation: {
    cheap: cheap.allocatedFreight,
    expensive: expensive.allocatedFreight,
  },
  stockout: {
    flat: stockoutWithoutGrowth.date,
    growth20pctMoM: stockoutWithGrowth.date,
  },
}, null, 2));
