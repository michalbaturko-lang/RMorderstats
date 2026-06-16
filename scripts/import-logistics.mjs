#!/usr/bin/env node

/**
 * Imports current in-transit import logistics workbooks into Supabase.
 *
 * Default mode is a dry-run audit. Use --apply after supabase/import_logistics.sql
 * has been applied to the target project.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  IMPORT_SUPPLIERS,
  buildProductMasterIndex,
} from '../src/importLogisticsCore.js';
import { buildImportLogisticsDataset } from './lib/import-logistics-excel.mjs';

const DEFAULT_IMPORT_WORKBOOK = '/Users/mbo/Downloads/RM importní logistika (2).xlsx';
const DEFAULT_MASTER_WORKBOOK = '/Users/mbo/Downloads/RM_Master_Doc_ver01.xlsx';
const DEFAULT_CHINA13_PROFORMA = '/Users/mbo/Library/Mobile Documents/com~apple~CloudDocs/PI D-202601ML.pdf';
const RM_ENV_PATH = '.env.ads';
const UPSERT_CHUNK_SIZE = 500;
const IMPORT_DOCUMENTS_BUCKET = 'import-documents';

const args = process.argv.slice(2);

const hasFlag = (flag) => args.includes(flag);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] || fallback);
};

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

async function loadEnv() {
  const repoEnv = await parseEnvFile(RM_ENV_PATH, true);
  return {
    ...repoEnv,
    ...process.env,
  };
}

function requireEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function upsertRows(supabase, table, rows, onConflict, select = '*') {
  const results = [];
  for (let index = 0; index < rows.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + UPSERT_CHUNK_SIZE);
    if (!chunk.length) continue;
    const { data, error } = await supabase
      .from(table)
      .upsert(chunk, { onConflict })
      .select(select);
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    results.push(...(Array.isArray(data) ? data : []));
  }
  return results;
}

async function fetchRowsByKeys(supabase, table, keyColumn, keys, select = '*') {
  const rows = [];
  const cleanKeys = [...new Set(keys.filter(Boolean))];
  for (let index = 0; index < cleanKeys.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = cleanKeys.slice(index, index + UPSERT_CHUNK_SIZE);
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .in(keyColumn, chunk);
    if (error) throw new Error(`${table} select failed: ${error.message}`);
    rows.push(...(Array.isArray(data) ? data : []));
  }
  return rows;
}

async function deleteRowsByIds(supabase, table, ids) {
  const cleanIds = [...new Set(ids.filter(Boolean))];
  for (let index = 0; index < cleanIds.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = cleanIds.slice(index, index + UPSERT_CHUNK_SIZE);
    const { error } = await supabase
      .from(table)
      .delete()
      .in('id', chunk);
    if (error) throw new Error(`${table} stale delete failed: ${error.message}`);
  }
}

async function deleteRowsNotInKeys(supabase, table, parentColumn, parentIds, keyColumn, keepKeys) {
  const rows = [];
  const cleanParentIds = [...new Set(parentIds.filter(Boolean))];
  for (let index = 0; index < cleanParentIds.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = cleanParentIds.slice(index, index + UPSERT_CHUNK_SIZE);
    const { data, error } = await supabase
      .from(table)
      .select(`id,${keyColumn}`)
      .in(parentColumn, chunk);
    if (error) throw new Error(`${table} select for stale cleanup failed: ${error.message}`);
    rows.push(...(Array.isArray(data) ? data : []));
  }

  const keep = new Set(keepKeys.filter(Boolean));
  const staleIds = rows
    .filter((row) => !keep.has(row[keyColumn]))
    .map((row) => row.id);
  await deleteRowsByIds(supabase, table, staleIds);
  return staleIds.length;
}

const safeStorageSegment = (value) => String(value || 'document')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120) || 'document';

const contentTypeForFile = (fileName) => {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.numbers')) return 'application/vnd.apple.numbers';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
};

async function uploadImportDocument(supabase, { orderCode, document }) {
  const fileName = document.fileName || path.basename(document.localPath || 'document');
  const documentType = document.documentType || 'other';
  const filePath = [
    safeStorageSegment(orderCode),
    'documents',
    safeStorageSegment(documentType),
    safeStorageSegment(fileName),
  ].join('/');
  const contentType = contentTypeForFile(fileName);
  const buffer = await fs.readFile(document.localPath);
  const { error } = await supabase.storage
    .from(IMPORT_DOCUMENTS_BUCKET)
    .upload(filePath, buffer, {
      contentType,
      upsert: true,
    });
  if (error) throw new Error(`Import document upload failed (${fileName}): ${error.message}`);
  return { filePath, fileName, contentType };
}

async function uploadLoadingPhoto(supabase, { orderCode, shipmentRef, photo }) {
  const fileName = photo.fileName || path.basename(photo.localPath || 'loading-photo.jpg');
  const filePath = [
    safeStorageSegment(orderCode),
    safeStorageSegment(shipmentRef || 'shipment'),
    'loading',
    safeStorageSegment(fileName),
  ].join('/');
  const contentType = contentTypeForFile(fileName);
  const buffer = await fs.readFile(photo.localPath);
  const { error } = await supabase.storage
    .from(IMPORT_DOCUMENTS_BUCKET)
    .upload(filePath, buffer, {
      contentType,
      upsert: true,
    });
  if (error) throw new Error(`Loading photo upload failed (${fileName}): ${error.message}`);
  return { filePath, fileName, contentType };
}

async function ensureImportDocumentsBucket(supabase) {
  const { error } = await supabase.storage.createBucket(IMPORT_DOCUMENTS_BUCKET, {
    public: false,
    fileSizeLimit: 25 * 1024 * 1024,
    allowedMimeTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.apple.numbers',
      'application/x-iwork-numbers-sffnumbers',
      'text/csv',
      'image/jpeg',
      'image/png',
    ],
  });
  if (error && !/already exists/i.test(error.message || '')) {
    throw new Error(`Storage bucket setup failed: ${error.message}`);
  }
}

const auditStatusForOrder = (audit) => {
  if (!audit) return 'needs_review';
  if (audit.reviewRows > 0) return 'match_review';
  if (audit.qtyUnknown > 0 || audit.missingPrices > 0) return 'data_missing';
  return 'ok';
};

const printAudit = ({ audit, auditFailures, orders }) => {
  const rows = orders.map((order) => {
    const row = audit[order.orderCode];
    return {
      order: order.orderCode,
      source_sheet: order.sourceSheet,
      rows: row.rows,
      total_qty: row.totalQty ?? 'unknown',
      exact: row.exactMatches,
      fallback: row.fallbackMatches,
      review: row.reviewRows,
      qty_unknown: row.qtyUnknown,
      matched_pct: `${row.matchedPct.toFixed(1)}%`,
    };
  });
  console.table(rows);
  if (auditFailures.length) {
    console.error('Audit failures:');
    auditFailures.forEach((failure) => console.error(`- ${failure}`));
  } else {
    console.log('Dry-run audit matches expected counts for current in-transit import orders.');
  }
};

const supplierRows = () => Object.values(IMPORT_SUPPLIERS).map((supplier) => ({
  supplier_key: supplier.supplierKey,
  supplier_code: supplier.supplierCode,
  display_name: supplier.name,
  country: 'CN',
  updated_at: new Date().toISOString(),
}));

const productRows = (dataset, sourceWorkbook) => {
  const masterIndex = buildProductMasterIndex(dataset.masterRows);
  const byKey = new Map();
  for (const product of masterIndex.rows) {
    if (!product.productKey || byKey.has(product.productKey)) continue;
    byKey.set(product.productKey, product);
  }
  return Array.from(byKey.values()).map((product) => ({
    product_key: product.productKey,
    rm_code: product.code || null,
    ean: product.ean || null,
    title: product.title || null,
    active_eshop: product.activeEshop,
    weight_kg: product.weightKg,
    old_code: product.oldCode || null,
    source_workbook: sourceWorkbook,
    source_sheet: product.sourceSheet,
    source_row: product.sourceRow,
    height_mm: product.heightMm,
    width_mm: product.widthMm,
    depth_mm: product.depthMm,
    color: product.color,
    shelf_count: product.shelfCount,
    capacity_kg: product.capacityKg,
    supplier_suffix: product.supplierSuffix,
    is_corner: product.isCorner,
    raw_row: product.rawRow || {},
    updated_at: new Date().toISOString(),
  })).filter((row) => row.product_key);
};

const orderRows = (dataset, supplierByKey) => dataset.orders.map((order) => ({
  order_code: order.orderCode,
  supplier_order_code: order.supplierOrderCode || null,
  source_workbook: order.sourceWorkbook,
  source_sheet: order.sourceSheet,
  supplier_id: supplierByKey.get(order.supplierKey)?.id || null,
  status: order.status,
  ordered_date: order.orderedDate,
  shipped_date: order.shippedDate,
  eta_brno: order.etaBrno,
  total_pcs: order.totalPcs,
  goods_description: order.goodsDescription || null,
  shelf_description: order.shelfDescription || null,
  audit_status: auditStatusForOrder(dataset.audit[order.orderCode]),
  audit_summary: {
    ...(dataset.audit[order.orderCode] || {}),
    ...(order.auditSummaryExtra || {}),
  },
  raw_overview_rows: order.rawOverviewRows || [],
  updated_at: new Date().toISOString(),
}));

const shipmentRows = (dataset, orderByCode) => dataset.orders.flatMap((order) => (
  (order.shipments || []).map((shipment) => ({
    shipment_key: shipment.shipmentKey,
    order_id: orderByCode.get(order.orderCode)?.id,
    shipment_ref: shipment.shipmentRef || null,
    kn_tracking_number: shipment.knTrackingNumber || null,
    bill_of_lading: shipment.billOfLading || shipment.knTrackingNumber || null,
    commercial_invoice_no: shipment.commercialInvoiceNo || null,
    supplier_order_codes: shipment.supplierOrderCodes || null,
    containers_text: shipment.containersText || null,
    container_count: shipment.containerCount ?? null,
    loading_method: shipment.loadingMethod || null,
    palletized: shipment.palletized ?? null,
    loading_summary: shipment.loadingSummary || null,
    loading_photo_count: shipment.loadingPhotos?.length || 0,
    loading_photos: shipment.loadingPhotos || [],
    status: shipment.status,
    ordered_date: shipment.orderedDate,
    port_departure_date: shipment.portDepartureDate || shipment.shippedDate,
    shipped_date: shipment.shippedDate,
    eta_brno: shipment.etaBrno,
    eta_hamburg: shipment.etaHamburg || shipment.etaPort || null,
    eta_port: shipment.etaPort || shipment.etaHamburg || null,
    tracking_url: shipment.trackingUrl || null,
    port_of_loading: shipment.portOfLoading || null,
    port_of_transshipment: shipment.portOfTransshipment || null,
    port_of_discharge: shipment.portOfDischarge || null,
    vessel_name: shipment.vesselName || null,
    voyage_no: shipment.voyageNo || null,
    allocated_quantity: shipment.allocatedQuantity ?? null,
    allocated_amount: shipment.allocatedAmount ?? null,
    allocated_currency: shipment.allocatedCurrency || null,
    allocation_note: shipment.allocationNote || null,
    raw_row: shipment.rawRow || {},
    updated_at: new Date().toISOString(),
  }))
)).filter((row) => row.order_id);

async function loadingPhotoDocumentRows(supabase, dataset, orderByCode, shipmentByKey) {
  const rows = [];
  for (const order of dataset.orders) {
    const orderId = orderByCode.get(order.orderCode)?.id;
    if (!orderId) continue;
    for (const shipment of order.shipments || []) {
      const shipmentId = shipmentByKey.get(shipment.shipmentKey)?.id || null;
      const photos = Array.isArray(shipment.loadingPhotos) ? shipment.loadingPhotos : [];
      for (let index = 0; index < photos.length; index += 1) {
        const photo = photos[index];
        const uploaded = await uploadLoadingPhoto(supabase, {
          orderCode: order.orderCode,
          shipmentRef: shipment.shipmentRef || shipment.shipmentKey,
          photo,
        });
        rows.push({
          document_key: `${shipment.shipmentKey}:loading_photo:${index + 1}`,
          order_id: orderId,
          shipment_id: shipmentId,
          storage_bucket: IMPORT_DOCUMENTS_BUCKET,
          file_path: uploaded.filePath,
          file_name: uploaded.fileName,
          content_type: uploaded.contentType,
          document_type: 'loading_photo',
          notes: photo.caption || shipment.loadingSummary || null,
          extraction_status: 'parsed',
          extracted_json: {
            shipment_ref: shipment.shipmentRef || null,
            commercial_invoice_no: shipment.commercialInvoiceNo || null,
            container_count: shipment.containerCount ?? null,
            loading_method: shipment.loadingMethod || null,
            palletized: shipment.palletized ?? null,
            loading_summary: shipment.loadingSummary || null,
            photo_index: index + 1,
            caption: photo.caption || null,
          },
          raw_metadata: {
            source: 'import_logistics_importer_loading_photo',
            local_path: photo.localPath || null,
            imported_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        });
      }
    }
  }
  return rows;
}

async function sourceDocumentRows(supabase, dataset, orderByCode) {
  const rows = [];
  for (const order of dataset.orders) {
    const orderId = orderByCode.get(order.orderCode)?.id;
    if (!orderId) continue;
    for (const document of order.documents || []) {
      const uploaded = await uploadImportDocument(supabase, {
        orderCode: order.orderCode,
        document,
      });
      rows.push({
        document_key: document.documentKey,
        order_id: orderId,
        shipment_id: null,
        storage_bucket: IMPORT_DOCUMENTS_BUCKET,
        file_path: uploaded.filePath,
        file_name: uploaded.fileName,
        content_type: uploaded.contentType,
        document_type: document.documentType || 'other',
        amount: document.amount ?? null,
        currency: document.currency || null,
        document_date: document.documentDate || null,
        notes: document.notes || null,
        extraction_status: document.extractionStatus || 'not_parsed',
        extracted_json: document.extractedJson || {},
        raw_metadata: {
          source: 'import_logistics_importer_source_document',
          local_path: document.localPath || null,
          imported_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      });
    }
  }
  return rows;
}

const lineRows = (dataset, orderByCode, productByKey) => dataset.orders.flatMap((order) => (
  order.lines.map((line) => {
    const matchedProduct = line.match?.matchedProduct || null;
    const product = matchedProduct?.productKey ? productByKey.get(matchedProduct.productKey) : null;
    return {
      line_key: line.lineKey,
      order_id: orderByCode.get(order.orderCode)?.id,
      source_workbook: line.sourceWorkbook,
      source_sheet: line.sourceSheet,
      source_row: line.sourceRow,
      raw_row: line.rawRow || {},
      spec: line.spec || null,
      rm_code: line.rmCode || null,
      ean: line.ean || null,
      product_master_id: product?.id || null,
      matched_rm_code: line.matchedCode || null,
      matched_ean: line.matchedEan || null,
      product_title: matchedProduct?.title || null,
      quantity: line.quantity,
      unit_purchase_price: line.unitPurchasePrice,
      purchase_currency: line.purchaseCurrency || null,
      height_mm: line.dimensions?.heightMm ?? null,
      width_mm: line.dimensions?.widthMm ?? null,
      depth_mm: line.dimensions?.depthMm ?? null,
      shelf_count: line.shelfCount,
      steel_thickness_mm: line.steelThicknessMm,
      mdf_thickness_mm: line.mdfThicknessMm,
      finish: line.finish || null,
      color: matchedProduct?.color || null,
      capacity: line.capacity || null,
      supplier_suffix: line.supplierSuffix,
      is_corner: Boolean(line.dimensions?.isCorner),
      match_method: line.matchMethod,
      match_confidence: line.matchConfidence,
      audit_status: line.auditStatus || line.match?.auditStatus || 'review',
      match_reason: line.match?.reason || null,
      match_candidates: line.match?.candidates || [],
      updated_at: new Date().toISOString(),
    };
  })
)).filter((row) => row.order_id);

const matchRows = (dataset, lineByKey, productByKey) => dataset.orders.flatMap((order) => (
  order.lines.map((line) => {
    const matchedProduct = line.match?.matchedProduct || null;
    const product = matchedProduct?.productKey ? productByKey.get(matchedProduct.productKey) : null;
    return {
      match_key: line.lineKey,
      order_line_id: lineByKey.get(line.lineKey)?.id,
      product_master_id: product?.id || null,
      match_method: line.match?.method || 'unmatched',
      confidence: line.match?.confidence || 0,
      audit_status: line.match?.auditStatus || line.auditStatus || 'review',
      reason: line.match?.reason || null,
      candidates: line.match?.candidates || [],
      raw_match: line.match || {},
      updated_at: new Date().toISOString(),
    };
  })
)).filter((row) => row.order_line_id);

async function applyDataset(dataset, env, importWorkbookPath) {
  const supabase = createClient(
    requireEnv(env, 'SUPABASE_URL'),
    requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );

  const suppliers = await upsertRows(supabase, 'import_suppliers', supplierRows(), 'supplier_key');
  const supplierByKey = new Map(suppliers.map((row) => [row.supplier_key, row]));

  const products = await upsertRows(
    supabase,
    'import_product_master',
    productRows(dataset, importWorkbookPath.split('/').pop()),
    'product_key',
    'id,product_key',
  );
  const productByKey = new Map(products.map((row) => [row.product_key, row]));

  const orders = await upsertRows(supabase, 'import_orders', orderRows(dataset, supplierByKey), 'order_code');
  const orderByCode = new Map(orders.map((row) => [row.order_code, row]));

  const shipmentPayload = shipmentRows(dataset, orderByCode);
  const upsertedShipments = await upsertRows(supabase, 'import_order_shipments', shipmentPayload, 'shipment_key', 'id,shipment_key');
  const shipmentByKey = new Map(upsertedShipments.map((row) => [row.shipment_key, row]));
  const staleShipments = await deleteRowsNotInKeys(
    supabase,
    'import_order_shipments',
    'order_id',
    Array.from(orderByCode.values()).map((order) => order.id),
    'shipment_key',
    shipmentPayload.map((shipment) => shipment.shipment_key),
  );

  await ensureImportDocumentsBucket(supabase);
  const loadingPhotoPayload = await loadingPhotoDocumentRows(supabase, dataset, orderByCode, shipmentByKey);
  const sourceDocumentPayload = await sourceDocumentRows(supabase, dataset, orderByCode);
  const documentPayload = [...loadingPhotoPayload, ...sourceDocumentPayload];
  if (documentPayload.length) {
    await upsertRows(supabase, 'import_order_documents', documentPayload, 'document_key');
  }

  const upsertedLines = await upsertRows(
    supabase,
    'import_order_lines',
    lineRows(dataset, orderByCode, productByKey),
    'line_key',
    'id,line_key',
  );
  const lineByKey = new Map(upsertedLines.map((row) => [row.line_key, row]));

  await upsertRows(supabase, 'import_product_matches', matchRows(dataset, lineByKey, productByKey), 'match_key');

  return {
    suppliers: suppliers.length,
    products: products.length,
    orders: orders.length,
    shipments: upsertedShipments.length,
    loadingPhotos: loadingPhotoPayload.length,
    sourceDocuments: sourceDocumentPayload.length,
    lines: upsertedLines.length,
    staleShipmentsDeleted: staleShipments,
  };
}

async function main() {
  const importWorkbookPath = readArg('--import-file', DEFAULT_IMPORT_WORKBOOK);
  const masterWorkbookPath = readArg('--master-file', DEFAULT_MASTER_WORKBOOK);
  const china13ProformaPath = readArg('--china13-proforma', DEFAULT_CHINA13_PROFORMA);
  const apply = hasFlag('--apply');
  const json = hasFlag('--json');

  const dataset = await buildImportLogisticsDataset({ importWorkbookPath, masterWorkbookPath, china13ProformaPath });

  if (json) {
    console.log(JSON.stringify({
      audit: dataset.audit,
      auditFailures: dataset.auditFailures,
      orders: dataset.orders.map((order) => ({
        orderCode: order.orderCode,
        sourceSheet: order.sourceSheet,
        lines: order.lines.length,
        reviewRows: order.lines.filter((line) => line.match?.auditStatus === 'review').length,
      })),
    }, null, 2));
  } else {
    printAudit(dataset);
  }

  if (dataset.auditFailures.length) {
    throw new Error('Dry-run audit does not match expected counts; refusing to apply.');
  }

  if (!apply) return;

  const env = await loadEnv();
  const result = await applyDataset(dataset, env, importWorkbookPath);
  console.log(JSON.stringify({ ok: true, applied: result }, null, 2));
}

main().catch((error) => {
  console.error('[import-logistics] FAILED:', error.message);
  process.exit(1);
});
