import React, { useEffect, useMemo, useState } from 'react';
import {
  allocateFreightByValue,
  buildSalesVelocity,
  convertImportUnitCostToCzk,
  predictStockoutDate,
  toNumber,
} from './importLogisticsCore';

const VIEW_TABS = [
  { id: 'orders', label: 'Objednávky na cestě' },
  { id: 'products', label: 'Produkty + inbound' },
  { id: 'risk', label: 'Riziko vyprodání' },
  { id: 'prices', label: 'Změny nákupek' },
  { id: 'review', label: 'Kontrola párování' },
];

const DOCUMENT_TYPES = [
  { value: 'supplier_order', label: 'Order' },
  { value: 'supplier_invoice', label: 'Supplier invoice' },
  { value: 'payment_proof', label: 'Payment Proof' },
  { value: 'supplier_proforma', label: 'Proforma' },
  { value: 'packing_list', label: 'Packing list' },
  { value: 'forwarder_invoice', label: 'KN/forwarder invoice' },
  { value: 'bl_tracking', label: 'BL/tracking' },
  { value: 'loading_photo', label: 'Fotky naložení' },
  { value: 'other', label: 'Other' },
];

const DOCUMENT_STATUS_ROWS = [
  { key: 'order', label: 'Order', types: ['supplier_order'] },
  { key: 'supplier_proforma', label: 'Proforma', types: ['supplier_proforma'] },
  { key: 'supplier_invoice', label: 'Invoice', types: ['supplier_invoice'] },
  { key: 'payment_proof', label: 'Payment Proof', types: ['payment_proof'] },
  { key: 'bl_tracking', label: 'BL/tracking', types: ['bl_tracking'] },
  { key: 'packing_list', label: 'Packing list', types: ['packing_list'] },
  { key: 'forwarder_invoice', label: 'KN invoice', types: ['forwarder_invoice'] },
];

let importLogisticsCache = null;
const IMPORT_LOGISTICS_CACHE_MS = 5 * 60 * 1000;
const SORT_COLLATOR = new Intl.Collator('cs-CZ', { numeric: true, sensitivity: 'base' });
const STATUS_SORT_ORDER = {
  navrh: 1,
  objednano: 2,
  shipped: 3,
  v_pristavu: 4,
  naskladneno: 5,
};

const documentTypeLabel = (value) => DOCUMENT_TYPES.find((type) => type.value === value)?.label || value || 'Dokument';

const MARKET_LABELS = {
  cz: 'CZ',
  sk: 'SK',
  hu: 'HU',
  ro: 'RO',
};

const formatNumber = (value, digits = 0) => {
  const number = toNumber(value);
  if (number == null) return '—';
  return number.toLocaleString('cs-CZ', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const formatPct = (value) => `${formatNumber(value, 1)} %`;

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDateList = (values = []) => {
  const formatted = [...new Set(values.filter(Boolean).map(formatDate).filter((value) => value !== '—'))];
  return formatted.length ? formatted.join(' / ') : '—';
};

const addDaysIso = (value, days) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const etaBrnoFromKnPort = (shipment) => {
  const portEta = shipment?.eta_port || shipment?.eta_hamburg;
  if (!portEta) return null;
  return addDaysIso(portEta, 14);
};

const formatEtaBrnoList = (shipments = [], fallbackOrderEta = null) => {
  const values = shipments.map(etaBrnoFromKnPort).filter(Boolean);
  if (values.length) return formatDateList(values);
  return fallbackOrderEta ? formatDate(fallbackOrderEta) : '—';
};

const orderEtaBrnoIso = (order, shipments = []) => {
  const values = shipments.map(etaBrnoFromKnPort).filter(Boolean).sort();
  return values[0] || order?.eta_brno || null;
};

const formatCurrency = (value, currency = 'CZK') => {
  const number = toNumber(value);
  if (number == null) return '—';
  const digits = currency === 'HUF' ? 0 : 2;
  const formatted = number.toLocaleString('cs-CZ', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${formatted} ${currency === 'CZK' ? 'Kč' : currency}`;
};

const buyPriceSourceLabel = (line) => {
  const proforma = line?.raw_row?.proforma || {};
  if (proforma.invoice_no) return `invoice ${proforma.invoice_no}`;
  if (proforma.source_file) return proforma.source_file;
  if (proforma.supplier_order_code) return `PI ${proforma.supplier_order_code}`;
  if (line?.source_sheet === 'CI PL-26ML224E') return 'CI 26ML224E';
  return line?.source_sheet || '';
};

const dateForInput = (date) => date.toISOString().slice(0, 10);

const normalizeLookupKey = (value) => String(value || '').trim().toUpperCase();

const getLookupValue = (map, keys) => {
  for (const key of keys.flat().filter(Boolean)) {
    const row = map.get(normalizeLookupKey(key));
    if (row) return row;
  }
  return null;
};

const preferredCatalogRow = (current, next) => {
  if (!current) return next;
  if (next?.market === 'cz' && current?.market !== 'cz') return next;
  if (next?.purchase_price_czk != null && current?.purchase_price_czk == null) return next;
  return current;
};

const stockScore = (row) => {
  let score = 0;
  if (row?.is_active) score += 8;
  if (!row?.is_archived) score += 4;
  if (row?.stock_quantity != null) score += 2;
  if (row?.fetched_at) score += 1;
  return score;
};

const preferredStockRow = (current, next) => {
  if (!current) return next;
  const currentScore = stockScore(current);
  const nextScore = stockScore(next);
  if (nextScore !== currentScore) return nextScore > currentScore ? next : current;
  return String(next?.fetched_at || '') > String(current?.fetched_at || '') ? next : current;
};

const setPreferred = (map, key, row, chooser) => {
  const normalized = normalizeLookupKey(key);
  if (!normalized) return;
  map.set(normalized, chooser(map.get(normalized), row));
};

const lineCodeKeys = (line) => [
  line?.master_rm_code,
  line?.matched_rm_code,
  line?.rm_code,
  line?.raw_row?.rm_code,
  line?.raw_row?.product_code,
  line?.raw_row?.['KÓD NOVÝ'],
];

const lineEanKeys = (line) => [
  line?.master_ean,
  line?.matched_ean,
  line?.ean,
  line?.raw_row?.ean,
  line?.raw_row?.EAN,
  line?.raw_row?.['EAN POHODA'],
  line?.raw_row?.['RM EAN/GTIN'],
];

const productCodeForLine = (line) => line?.master_rm_code
  || line?.matched_rm_code
  || line?.rm_code
  || line?.raw_row?.rm_code
  || line?.raw_row?.product_code
  || line?.raw_row?.['KÓD NOVÝ']
  || line?.raw_row?.['Nový kód produktu']
  || '';

const productEanForLine = (line) => line?.master_ean
  || line?.matched_ean
  || line?.ean
  || line?.raw_row?.ean
  || line?.raw_row?.EAN
  || line?.raw_row?.['EAN POHODA']
  || line?.raw_row?.['RM EAN/GTIN']
  || '';

const productTitleForLine = (line) => line?.master_title
  || line?.product_title
  || line?.raw_row?.title
  || line?.raw_row?.name
  || line?.spec
  || '';

const lineStockRow = (line, stockByCode, stockByEan) => (
  getLookupValue(stockByCode, lineCodeKeys(line))
  || getLookupValue(stockByEan, lineEanKeys(line))
);

const productDimensionLabel = (row) => {
  const dims = [row.heightMm, row.widthMm, row.depthMm].map((value) => toNumber(value));
  return dims.every((value) => value != null) ? `${formatNumber(dims[0])}x${formatNumber(dims[1])}x${formatNumber(dims[2])}` : '';
};

const normalizeSearch = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase();

const productIdentityKeyForLine = (line) => {
  const code = normalizeLookupKey(productCodeForLine(line));
  if (code) return `code:${code}`;
  const ean = normalizeLookupKey(productEanForLine(line));
  if (ean) return `ean:${ean}`;
  return '';
};

const productDimensionValue = (value) => {
  const number = toNumber(value);
  return number == null ? '' : String(number);
};

const orderDocMatcher = (document, order) => {
  const name = `${document?.file_name || ''} ${document?.notes || ''}`.toLowerCase();
  const hasRealFile = Boolean(document?.file_path && document?.file_name);
  if (!hasRealFile) return false;
  const supplierOrderCodes = [
    order?.supplier_order_code,
    order?.supplier_order_codes,
    order?.audit_summary?.supplier_order_code,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[\s,/]+/))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length >= 4);
  if (document?.document_type === 'supplier_order') return true;
  if (document?.document_type !== 'other') return false;
  return /\b(order|purchase-order|po|objednavka|objednávka)\b/.test(name)
    || supplierOrderCodes.some((code) => name.includes(code));
};

const buildDocumentStatusRows = (order, documents = []) => DOCUMENT_STATUS_ROWS.map((row) => {
  if (row.key === 'order') {
    const document = documents.find((candidate) => orderDocMatcher(candidate, order));
    const supplierOrderCode = order?.supplier_order_code || order?.supplier_order_codes || '';
    return {
      ...row,
      document,
      present: Boolean(document),
      count: document ? documents.filter((candidate) => orderDocMatcher(candidate, order)).length : 0,
      detail: document?.file_name || (supplierOrderCode ? `chybí soubor · ${supplierOrderCode}` : 'chybí'),
    };
  }
  const document = documents.find((candidate) => row.types.includes(candidate.document_type));
  const count = documents.filter((candidate) => row.types.includes(candidate.document_type)).length;
  return {
    ...row,
    document,
    present: Boolean(document),
    count,
    detail: document?.file_name || 'chybí',
  };
});

const orderDocumentCoverage = (order, documents = []) => {
  const rows = buildDocumentStatusRows(order, documents);
  return {
    present: rows.filter((row) => row.present).length,
    total: rows.length,
  };
};

const uniqueBusinessDocumentCount = (documents = []) => new Set(
  documents
    .filter((document) => document.document_type !== 'loading_photo')
    .map((document) => document.file_path || document.id)
    .filter(Boolean),
).size;

const splitReferenceCodes = (value) => String(value || '')
  .split(/[,&/]+/)
  .map((code) => code.trim())
  .filter(Boolean);

const orderReferenceSummary = (order, shipments = []) => {
  const ciNumbers = [...new Set(shipments
    .map((shipment) => shipment.commercial_invoice_no)
    .filter(Boolean))];
  const piNumbers = [...new Set([
    order?.supplier_order_code,
    ...shipments.flatMap((shipment) => splitReferenceCodes(shipment.supplier_order_codes)),
  ].filter(Boolean))];
  const parts = [];
  if (ciNumbers.length) parts.push(`CI ${ciNumbers.join(' / ')}`);
  if (piNumbers.length) parts.push(`P/I ${piNumbers.join(' / ')}`);
  return parts.join(' · ');
};

const orderShipmentAmountCzk = (shipments = []) => shipments.reduce((sum, shipment) => {
  const converted = convertImportUnitCostToCzk(shipment.allocated_amount, shipment.allocated_currency || 'CZK');
  return sum + (converted || 0);
}, 0);

const orderShipmentOriginalSummary = (shipments = []) => {
  const totals = new Map();
  for (const shipment of shipments) {
    const amount = toNumber(shipment.allocated_amount);
    const currency = String(shipment.allocated_currency || 'USD').toUpperCase();
    if (amount == null) continue;
    totals.set(currency, (totals.get(currency) || 0) + amount);
  }
  return Array.from(totals.entries())
    .map(([currency, amount]) => formatCurrency(amount, currency))
    .join(' + ');
};

const orderLineOriginalSummary = (lines = []) => {
  const totals = new Map();
  for (const line of lines) {
    const qty = toNumber(line.quantity);
    const unitPrice = toNumber(line.unit_purchase_price);
    const currency = String(line.purchase_currency || 'CZK').toUpperCase();
    if (qty == null || unitPrice == null) continue;
    totals.set(currency, (totals.get(currency) || 0) + (qty * unitPrice));
  }
  return Array.from(totals.entries())
    .map(([currency, amount]) => formatCurrency(amount, currency))
    .join(' + ');
};

const orderGoodsValueDisplay = (shipments = [], lines = []) => {
  const shipmentValueCzk = orderShipmentAmountCzk(shipments);
  if (shipmentValueCzk > 0) {
    return {
      valueCzk: shipmentValueCzk,
      original: orderShipmentOriginalSummary(shipments),
      source: 'shipment',
    };
  }
  return {
    valueCzk: orderGoodsValueCzk(lines),
    original: orderLineOriginalSummary(lines),
    source: 'lines',
  };
};

const orderContainerCount = (order, shipments = []) => {
  const explicit = shipments.reduce((sum, shipment) => sum + (toNumber(shipment.container_count) || 0), 0);
  if (explicit > 0) return explicit;
  return null;
};

const containerPrimaryFromText = (text, count = null) => {
  const raw = String(text || '').trim();
  const starMatch = raw.match(/(\d+)\s*[*x]\s*40\s*([A-Z]{2,3})/i);
  if (starMatch) return `${starMatch[1]}x40${starMatch[2].toUpperCase()}`;
  const containerMatch = raw.match(/(\d+)\s*kontejner/i);
  if (containerMatch) return `${containerMatch[1]}x40HC`;
  if (count) return `${formatNumber(count)}x40HC`;
  return raw || '—';
};

const containerNoteFromText = (text, primary) => {
  const raw = String(text || '').trim();
  if (!raw || raw === primary) return '';
  const parenthetical = raw.match(/\((.+)\)/);
  if (parenthetical) return parenthetical[1];
  if (/sdílen|mix|část|součást/i.test(raw)) return raw;
  return '';
};

const shipmentContainerDisplay = (shipment) => {
  const count = toNumber(shipment?.container_count);
  const raw = shipment?.containers_text || shipment?.raw_row?.shipped_in || '';
  const primary = containerPrimaryFromText(raw, count);
  const note = containerNoteFromText(raw, primary);
  return { primary, note };
};

const orderContainerDisplay = (order, shipments = []) => {
  const displays = shipments.map(shipmentContainerDisplay).filter((item) => item.primary && item.primary !== '—');
  if (!displays.length && order?.containers) {
    const primary = containerPrimaryFromText(order.containers, orderContainerCount(order, shipments));
    return { primary, note: containerNoteFromText(order.containers, primary) };
  }
  const primary = [...new Set(displays.map((item) => item.primary))].join(' / ') || '—';
  const note = [...new Set(displays.map((item) => item.note).filter(Boolean))].join(' · ');
  return { primary, note };
};

const orderLoadingDisplay = (shipments = []) => {
  const entries = shipments
    .map((shipment) => ({
      label: loadingMethodLabel(shipment.loading_method, shipment.palletized),
      ref: shipment.shipment_ref || shipment.commercial_invoice_no || '',
    }))
    .filter((entry) => entry.label && entry.label !== 'Naložení neuvedeno');
  const primary = [...new Set(entries.map((entry) => entry.label))].join(' / ') || '—';
  const note = [...new Set(entries.map((entry) => entry.ref).filter(Boolean))].join(' / ');
  return { primary, note };
};

const orderGoodsValueCzk = (lines = []) => {
  let total = 0;
  let hasValue = false;
  for (const line of lines) {
    const qty = toNumber(line.quantity);
    const unitCzk = convertImportUnitCostToCzk(line.unit_purchase_price, line.purchase_currency || 'CZK');
    if (qty != null && unitCzk != null) {
      total += qty * unitCzk;
      hasValue = true;
    }
  }
  return hasValue ? total : null;
};

const meaningfulShipments = (shipments = []) => shipments.filter((shipment) => (
  shipment.container_count
  || shipment.containers_text
  || shipment.container_no
  || shipment.bill_of_lading
  || shipment.kn_tracking_number
  || shipment.commercial_invoice_no
  || shipment.eta_port
  || shipment.eta_hamburg
  || shipment.eta_brno
  || shipment.port_departure_date
  || shipment.shipped_date
  || shipment.loading_method
  || shipment.loading_summary
));

const sortableValue = (order, shipments, documents, lines, sortKey) => {
  if (sortKey === 'order') return order.order_code || '';
  if (sortKey === 'supplier') return order.supplier_name || '';
  if (sortKey === 'status') return STATUS_SORT_ORDER[order.status] || 99;
  if (sortKey === 'containers') return orderContainerCount(order, shipments);
  if (sortKey === 'qty') return toNumber(order.total_pcs);
  if (sortKey === 'value') return orderGoodsValueDisplay(shipments, lines).valueCzk || null;
  if (sortKey === 'documents') return orderDocumentCoverage(order, documents).present;
  if (sortKey === 'missing') {
    return (toNumber(order.review_line_count) || 0)
      + (toNumber(order.missing_price_line_count) || 0)
      + (toNumber(order.qty_unknown_line_count) || 0);
  }
  if (sortKey === 'shipped') {
    return shipments.map((shipment) => shipment.port_departure_date || shipment.shipped_date).filter(Boolean).sort()[0]
      || order.shipped_date
      || '';
  }
  if (sortKey === 'eta_port') {
    return shipments.map((shipment) => shipment.eta_port || shipment.eta_hamburg).filter(Boolean).sort()[0] || null;
  }
  if (sortKey === 'eta_brno') {
    return shipments.map(etaBrnoFromKnPort).filter(Boolean).sort()[0] || order.eta_brno || null;
  }
  return '';
};

const compareSortable = (a, b, direction = 'asc') => {
  const aMissing = a == null || a === '';
  const bMissing = b == null || b === '';
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const result = typeof a === 'number' || typeof b === 'number'
    ? Number(a) - Number(b)
    : SORT_COLLATOR.compare(String(a), String(b));
  return direction === 'asc' ? result : -result;
};

const fetchAllRows = async (queryBuilder) => {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryBuilder().range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = Array.isArray(data) ? data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
};

const fetchOrdersViaRest = async ({ supabaseUrl, supabaseKey, accessToken, fromDate, toDate }) => {
  if (!accessToken) throw new Error('Chybí přihlášení pro načtení prodejní historie.');

  const allRows = [];
  const pageSize = 1000;
  let useAnonymousReadFallback = false;
  for (let offset = 0; ; offset += pageSize) {
    const url = `${supabaseUrl}/rest/v1/orders?select=id,market,order_date,status,raw_data,order_items(order_id,product_code,product_name,quantity,buy_price,unit_price_without_vat,total_price_without_vat,vat_rate,sku,ean)&order_date=gte.${fromDate}T00:00:00&order_date=lte.${toDate}T23:59:59&order=order_date.desc&limit=${pageSize}&offset=${offset}`;
    const requestOptions = (anonymous = useAnonymousReadFallback) => ({
      headers: {
        apikey: supabaseKey,
        ...(anonymous ? {} : { Authorization: `Bearer ${accessToken}` }),
      },
    });
    const response = await fetch(url, requestOptions());
    if (!response.ok) throw new Error(`Orders HTTP ${response.status}`);
    const chunk = await response.json();
    let rows = Array.isArray(chunk) ? chunk : [];
    if (offset === 0 && !useAnonymousReadFallback && rows.length === 0) {
      const anonymousResponse = await fetch(url, requestOptions(true));
      if (anonymousResponse.ok) {
        const anonymousChunk = await anonymousResponse.json();
        if (Array.isArray(anonymousChunk) && anonymousChunk.length > 0) {
          useAnonymousReadFallback = true;
          rows = anonymousChunk;
          console.warn('Import logistics: Supabase authenticated RLS returned no sales history; using anon read fallback until authenticated read policies are applied.');
        }
      }
    }
    allRows.push(...rows);
    if (rows.length < pageSize) break;
  }
  return allRows;
};

const fetchSignedDocumentUrl = async (supabaseClient, document) => {
  if (!document?.id) return '';
  if (document.signed_url) return document.signed_url;
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return '';
  const response = await fetch(`/api/import-documents?documentId=${encodeURIComponent(document.id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Dokument se nepodařilo otevřít.');
  return payload.signedUrl || payload.document?.signed_url || '';
};

const emptyData = () => ({
  orders: [],
  lines: [],
  shipments: [],
  documents: [],
  costs: [],
  purchaseRows: [],
  stockRows: [],
  historyOrders: [],
});

const statusLabel = (status) => ({
  navrh: 'Návrh',
  objednano: 'Objednáno',
  shipped: 'Shipped',
  v_pristavu: 'V přístavu',
  naskladneno: 'Naskladněno',
}[status] || status || '—');

const statusClass = (status) => ({
  navrh: 'border-slate-200 bg-slate-50 text-slate-700',
  objednano: 'border-blue-200 bg-blue-50 text-blue-700',
  shipped: 'border-amber-200 bg-amber-50 text-amber-700',
  v_pristavu: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  naskladneno: 'border-slate-200 bg-slate-50 text-slate-500',
}[status] || 'border-slate-200 bg-slate-50 text-slate-700');

const loadingMethodLabel = (value, palletized) => {
  if (value === 'palletized') return 'Na paletách';
  if (value === 'floor_loaded') return 'Bez palet';
  if (value === 'mixed') return 'Mix';
  if (value === 'unknown') return 'Neznámé';
  if (palletized === true) return 'Na paletách';
  if (palletized === false) return 'Bez palet';
  return 'Naložení neuvedeno';
};

const loadingMethodClass = (value, palletized) => {
  const method = value || (palletized === true ? 'palletized' : palletized === false ? 'floor_loaded' : '');
  if (method === 'palletized') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (method === 'floor_loaded') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-600';
};

function Kpi({ label, value, sub, tone = 'slate' }) {
  return (
    <div className={`rm-kpi rm-kpi--${tone}`}>
      <div className="rm-kpi-label">{label}</div>
      <div className="rm-kpi-value">{value}</div>
      {sub && <div className="rm-kpi-sub">{sub}</div>}
    </div>
  );
}

function Pill({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

function DocumentUpload({ order, supabaseClient, canUploadDocuments = true, onUploaded }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [lastMessage, setLastMessage] = useState('');
  const [dragging, setDragging] = useState(false);

  const readFileBase64 = async (fileToRead = file) => {
    if (!fileToRead) return '';
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Soubor se nepodařilo načíst.'));
      reader.readAsDataURL(fileToRead);
    });
    return dataUrl.split(',')[1] || '';
  };

  const submitDocument = async (action, fileToUse = file) => {
    if (!fileToUse || !order?.id) return;
    if (!canUploadDocuments) {
      setError('Upload dokumentů není pro tento účet povolený.');
      return;
    }
    setUploading(true);
    setError('');
    setLastMessage('');
    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Chybí přihlášení pro upload dokumentu.');

      const response = await fetch('/api/import-documents', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderId: order.id,
          fileName: fileToUse.name,
          contentType: fileToUse.type || 'application/octet-stream',
          base64: await readFileBase64(fileToUse),
          documentType: 'auto',
          amount: null,
          currency: null,
          documentDate: null,
          notes: '',
          action,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Upload HTTP ${response.status}`);
      if (action === 'preview') {
        setProposal(payload.proposal || null);
        setPreviewReady(true);
        if (!payload.proposal) {
          setLastMessage(payload.extractionStatus === 'failed'
            ? 'Dokument se nahrál do náhledu, ale parser z něj nenašel řádky.'
            : 'Dokument je připravený k uložení k objednávce; automatické doplnění pro tento typ zatím není.');
        }
      } else {
        setFile(null);
        setProposal(null);
        setPreviewReady(false);
        setLastMessage(payload.applied
          ? `Doplněno: ${formatNumber(payload.applied?.updatedLines || 0)} řádků.`
          : 'Dokument uložený k objednávce.');
        onUploaded?.();
      }
    } catch (uploadError) {
      setError(uploadError?.message || 'Upload selhal.');
    } finally {
      setUploading(false);
    }
  };

  const upload = async (event) => {
    event.preventDefault();
    await submitDocument(previewReady ? 'apply' : 'preview');
  };

  const handleFileSelected = async (selectedFile) => {
    if (!canUploadDocuments) return;
    setFile(selectedFile);
    setProposal(null);
    setPreviewReady(false);
    setError('');
    setLastMessage('');
    if (selectedFile) await submitDocument('preview', selectedFile);
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (!canUploadDocuments) return;
    const droppedFile = event.dataTransfer.files?.[0] || null;
    if (droppedFile) void handleFileSelected(droppedFile);
  };

  if (!canUploadDocuments) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        Dokumenty jsou pro tento účet jen pro čtení. Upload může provádět pouze oprávněná role.
      </div>
    );
  }

  return (
    <form onSubmit={upload} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex min-h-[72px] cursor-pointer items-center justify-center rounded-lg border border-dashed bg-white px-3 py-3 text-center text-sm font-medium transition-all ${
            dragging ? 'border-blue-400 text-blue-700 ring-2 ring-blue-100' : 'border-slate-300 text-slate-600 hover:border-blue-300 hover:text-blue-700'
          }`}
        >
          <input
            type="file"
            onChange={(event) => {
              void handleFileSelected(event.target.files?.[0] || null);
            }}
            className="sr-only"
          />
          <span className="truncate">{file ? file.name : 'Přetáhni nebo vyber dokument'}</span>
        </label>
        <button
          type="submit"
          disabled={!file || uploading}
          className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? 'Nahrávám' : previewReady ? (proposal ? 'Potvrdit' : 'Uložit') : 'Načíst'}
        </button>
      </div>
      {proposal && (
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">
          <div className="font-semibold">
            Náhled doplnění: {proposal.invoice_no || 'bez čísla'} · {formatNumber(proposal.total_quantity_after)} ks · {formatCurrency(proposal.total_amount, proposal.currency || 'USD')}
          </div>
          <div className="mt-1 text-blue-800">
            Systém doplní {formatNumber(proposal.summary?.matched_lines)} řádků, nákupní ceny {formatNumber(proposal.summary?.buy_prices_filled)} řádkům a objednávkový kód {proposal.supplier_order_code || '—'}.
          </div>
          <div className="mt-2 max-h-44 overflow-auto rounded-md bg-white/70">
            <table className="w-full text-[11px]">
              <thead className="text-blue-700">
                <tr>
                  <th className="px-2 py-1 text-left">Ř.</th>
                  <th className="px-2 py-1 text-left">Produkt</th>
                  <th className="px-2 py-1 text-right">Qty</th>
                  <th className="px-2 py-1 text-right">Buy price CZK</th>
                </tr>
              </thead>
              <tbody>
                {(proposal.line_updates || []).slice(0, 20).map((row) => (
                  <tr key={row.position} className="border-t border-blue-100">
                    <td className="px-2 py-1">{row.position}</td>
                    <td className="px-2 py-1 font-medium">{row.rm_code || row.item_no}</td>
                    <td className="px-2 py-1 text-right">{formatNumber(row.quantity_after)}</td>
                    <td className="px-2 py-1 text-right">{formatCurrency(convertImportUnitCostToCzk(row.buy_price_after, row.currency_after || 'USD'), 'CZK')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {error && <div className="mt-2 text-xs font-medium text-red-600">{error}</div>}
      {lastMessage && <div className="mt-2 text-xs font-medium text-emerald-700">{lastMessage}</div>}
    </form>
  );
}

function SortableTh({ label, sortKey, sort, onSort, align = 'left', className = '' }) {
  const active = sort.key === sortKey;
  const arrow = active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕';
  return (
    <th className={`px-3 py-2 font-semibold ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 ${active ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'}`}
      >
        <span>{label}</span>
        <span className="text-[10px] text-slate-400">{arrow}</span>
      </button>
    </th>
  );
}

function OrdersTable({ orders, linesByOrder, shipmentsByOrder, documentsByOrder, selectedOrderId, onSelect, sort, onSort }) {
  const sortedOrders = useMemo(() => [...orders].sort((left, right) => {
    const leftLines = linesByOrder?.get(left.id) || [];
    const rightLines = linesByOrder?.get(right.id) || [];
    const leftShipments = shipmentsByOrder?.get(left.id) || [];
    const rightShipments = shipmentsByOrder?.get(right.id) || [];
    const leftDocuments = documentsByOrder?.get(left.id) || [];
    const rightDocuments = documentsByOrder?.get(right.id) || [];
    return compareSortable(
      sortableValue(left, leftShipments, leftDocuments, leftLines, sort.key),
      sortableValue(right, rightShipments, rightDocuments, rightLines, sort.key),
      sort.direction,
    );
  }), [orders, linesByOrder, shipmentsByOrder, documentsByOrder, sort]);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-[1380px] w-full text-xs">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <SortableTh label="Objednávka" sortKey="order" sort={sort} onSort={onSort} />
            <SortableTh label="Dodavatel" sortKey="supplier" sort={sort} onSort={onSort} />
            <SortableTh label="Stav" sortKey="status" sort={sort} onSort={onSort} />
            <th className="px-3 py-2 text-left font-semibold">KN / B/L</th>
            <SortableTh label="Kontejnery" sortKey="containers" sort={sort} onSort={onSort} />
            <th className="px-3 py-2 text-left font-semibold">Naložení</th>
            <SortableTh label="Ks" sortKey="qty" sort={sort} onSort={onSort} align="right" />
            <SortableTh label="Hodnota" sortKey="value" sort={sort} onSort={onSort} align="right" />
            <SortableTh label="Kontrola" sortKey="missing" sort={sort} onSort={onSort} align="right" />
            <SortableTh label="Dokumenty" sortKey="documents" sort={sort} onSort={onSort} align="right" />
            <SortableTh label="ETA port" sortKey="eta_port" sort={sort} onSort={onSort} />
            <SortableTh label="ETA Brno (+2 týdny)" sortKey="eta_brno" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {sortedOrders.map((order) => {
            const orderLines = linesByOrder?.get(order.id) || [];
            const orderShipments = shipmentsByOrder?.get(order.id) || [];
            const orderDocuments = documentsByOrder?.get(order.id) || [];
            const knTracking = orderShipments.map((shipment) => shipment.kn_tracking_number || shipment.bill_of_lading).filter(Boolean).join(', ');
            const etaPorts = orderShipments.length
              ? formatDateList(orderShipments.map((shipment) => shipment.eta_port || shipment.eta_hamburg))
              : '—';
            const etaBrno = formatEtaBrnoList(orderShipments, order.eta_brno);
            const containerDisplay = orderContainerDisplay(order, orderShipments);
            const loadingDisplay = orderLoadingDisplay(orderShipments);
            const goodsValue = orderGoodsValueDisplay(orderShipments, orderLines);
            const documentCoverage = orderDocumentCoverage(order, orderDocuments);
            const referenceSummary = orderReferenceSummary(order, orderShipments);
            return (
              <tr
                key={order.id}
                onClick={() => onSelect(order.id)}
                className={`cursor-pointer border-t border-slate-100 hover:bg-blue-50 ${selectedOrderId === order.id ? 'bg-blue-50' : 'odd:bg-white even:bg-slate-50/60'}`}
              >
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-800">{order.order_code}</div>
                  {referenceSummary && <div className="text-slate-500">{referenceSummary}</div>}
                </td>
                <td className="px-3 py-2 text-slate-600">{order.supplier_name}</td>
                <td className="px-3 py-2"><Pill className={statusClass(order.status)}>{statusLabel(order.status)}</Pill></td>
                <td className="px-3 py-2 font-medium text-slate-700">{knTracking || '—'}</td>
                <td className="px-3 py-2 text-slate-600">
                  <div className="whitespace-nowrap font-medium text-slate-700">{containerDisplay.primary}</div>
                  {containerDisplay.note && <div className="mt-0.5 max-w-[210px] text-[11px] leading-snug text-slate-400">{containerDisplay.note}</div>}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  <div className="whitespace-nowrap">{loadingDisplay.primary}</div>
                  {loadingDisplay.note && <div className="mt-0.5 text-[11px] text-slate-400">{loadingDisplay.note}</div>}
                </td>
                <td className="px-3 py-2 text-right font-medium text-slate-800">{formatNumber(order.total_pcs)}</td>
                <td className="px-3 py-2 text-right text-slate-700">
                  <div className="whitespace-nowrap">{goodsValue.valueCzk ? formatCurrency(goodsValue.valueCzk, 'CZK') : '—'}</div>
                  {goodsValue.original && <div className="text-[11px] text-slate-400">({goodsValue.original})</div>}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={order.review_line_count || order.missing_price_line_count || order.qty_unknown_line_count ? 'font-semibold text-amber-700' : 'text-slate-400'}>
                    {formatNumber((order.review_line_count || 0) + (order.missing_price_line_count || 0) + (order.qty_unknown_line_count || 0))}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={documentCoverage.present === documentCoverage.total ? 'font-semibold text-emerald-700' : documentCoverage.present ? 'font-semibold text-amber-700' : 'text-slate-400'}>
                    {documentCoverage.present}/{documentCoverage.total}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">{etaPorts}</td>
                <td className="px-3 py-2 font-medium text-slate-800">{etaBrno}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const productOrderQuantity = (row, orderId) => row.orderQuantities?.get(orderId) || 0;

const productSortableValue = (row, sortKey) => {
  if (sortKey === 'product') return row.code || row.ean || '';
  if (sortKey === 'stock') return row.stockQuantity;
  if (sortKey === 'inbound') return row.totalInbound;
  if (sortKey === 'eta') return row.earliestEta || null;
  if (sortKey === 'size') return [
    productDimensionValue(row.heightMm),
    productDimensionValue(row.widthMm),
    productDimensionValue(row.depthMm),
  ].join('x');
  if (sortKey.startsWith('order:')) return productOrderQuantity(row, sortKey.slice('order:'.length));
  return '';
};

function ProductFilterSelect({ label, value, options, onChange, unit = '' }) {
  return (
    <label className="flex min-w-[126px] flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-medium normal-case tracking-normal text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
      >
        <option value="">Vše</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}{unit}</option>
        ))}
      </select>
    </label>
  );
}

function ProductInboundView({ rows, columns, filterOptions, latestStockFetchedAt, unmatchedLineCount }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ height: '', width: '', depth: '', color: '' });
  const [expanded, setExpanded] = useState(true);
  const [sort, setSort] = useState({ key: 'eta', direction: 'asc' });
  const normalizedQuery = normalizeSearch(query);

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const onSort = (key) => setSort((current) => ({
    key,
    direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
  }));

  const filteredRows = useMemo(() => rows
    .filter((row) => {
      if (normalizedQuery) {
        const code = normalizeSearch(row.code);
        const ean = normalizeSearch(row.ean);
        const title = normalizeSearch(row.title);
        if (!code.startsWith(normalizedQuery) && !ean.startsWith(normalizedQuery) && !title.includes(normalizedQuery)) return false;
      }
      if (filters.height && productDimensionValue(row.heightMm) !== filters.height) return false;
      if (filters.width && productDimensionValue(row.widthMm) !== filters.width) return false;
      if (filters.depth && productDimensionValue(row.depthMm) !== filters.depth) return false;
      if (filters.color && String(row.color || '').trim() !== filters.color) return false;
      return true;
    })
    .sort((left, right) => compareSortable(
      productSortableValue(left, sort.key),
      productSortableValue(right, sort.key),
      sort.direction,
    ) || SORT_COLLATOR.compare(left.code || left.ean || '', right.code || right.ean || '')), [rows, normalizedQuery, filters, sort]);

  const visibleInboundQty = filteredRows.reduce((sum, row) => sum + (toNumber(row.totalInbound) || 0), 0);
  const stockKnownCount = filteredRows.filter((row) => row.stockQuantity != null).length;
  const orderColumns = expanded ? columns : [];
  const tableMinWidth = 320 + 118 + 128 + (expanded ? 0 : 136) + 170 + (orderColumns.length * 118);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_repeat(4,auto)]">
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Rychlé hledání
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Kód nebo EAN od prvního znaku"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium normal-case tracking-normal text-slate-800 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <ProductFilterSelect label="Výška" value={filters.height} options={filterOptions.heights || []} unit=" mm" onChange={(value) => setFilter('height', value)} />
            <ProductFilterSelect label="Šířka" value={filters.width} options={filterOptions.widths || []} unit=" mm" onChange={(value) => setFilter('width', value)} />
            <ProductFilterSelect label="Hloubka" value={filters.depth} options={filterOptions.depths || []} unit=" mm" onChange={(value) => setFilter('depth', value)} />
            <ProductFilterSelect label="Barva" value={filters.color} options={filterOptions.colors || []} onChange={(value) => setFilter('color', value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilters({ height: '', width: '', depth: '', color: '' })}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700"
            >
              Vyčistit filtry
            </button>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
            >
              {expanded ? 'Sbalit objednávky' : 'Rozpadnout na objednávky'}
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-4">
          <div><span className="font-semibold text-slate-800">{formatNumber(filteredRows.length)}</span> produktů ve filtru</div>
          <div><span className="font-semibold text-slate-800">{formatNumber(visibleInboundQty)}</span> ks na cestě</div>
          <div><span className="font-semibold text-slate-800">{formatNumber(stockKnownCount)}</span> s aktuálním skladem</div>
          <div>Stock sync: <span className="font-medium text-slate-700">{formatDateTime(latestStockFetchedAt)}</span></div>
        </div>
      </div>

      {unmatchedLineCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {formatNumber(unmatchedLineCount)} importních řádků není v produktovém pohledu zahrnuto, protože ještě nejsou jistě spárované s produktem. Dopárování patří do „Kontrola párování“.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-xs" style={{ minWidth: tableMinWidth }}>
          <colgroup>
            <col style={{ width: 320 }} />
            <col style={{ width: 118 }} />
            <col style={{ width: 128 }} />
            {!expanded && <col style={{ width: 136 }} />}
            <col style={{ width: 170 }} />
            {orderColumns.map((column) => <col key={column.orderId} style={{ width: 118 }} />)}
          </colgroup>
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="sticky left-0 z-20 bg-slate-100 px-3 py-2 text-left font-semibold shadow-[1px_0_0_0_rgba(226,232,240,1)]">
                <button
                  type="button"
                  onClick={() => onSort('product')}
                  className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:text-slate-900"
                >
                  Produkt <span className="text-[10px] text-slate-400">{sort.key === 'product' ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
                </button>
              </th>
              <SortableTh label="Skladem" sortKey="stock" sort={sort} onSort={onSort} align="right" className="w-[118px]" />
              <SortableTh label="Na cestě" sortKey="inbound" sort={sort} onSort={onSort} align="right" className="w-[128px] bg-blue-50 text-blue-800" />
              {!expanded && <SortableTh label="Nejbližší ETA Brno" sortKey="eta" sort={sort} onSort={onSort} className="w-[136px]" />}
              <SortableTh label="Rozměr" sortKey="size" sort={sort} onSort={onSort} className="w-[170px]" />
              {orderColumns.map((column) => (
                <th key={column.orderId} className="w-[118px] px-3 py-2 text-right font-semibold">
                  <button
                    type="button"
                    onClick={() => onSort(`order:${column.orderId}`)}
                    className={`inline-flex flex-col items-end gap-0.5 rounded-md px-1 py-0.5 ${sort.key === `order:${column.orderId}` ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    <span>{column.orderCode}</span>
                    <span className="text-[10px] font-medium text-slate-400">
                      ETA Brno {column.etaLabel}
                      {' '}
                      {sort.key === `order:${column.orderId}` ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.productKey} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                <td className="sticky left-0 z-10 bg-inherit px-3 py-2 shadow-[1px_0_0_0_rgba(226,232,240,1)]">
                  <div className="flex items-center gap-2">
                    <div className="truncate font-semibold text-slate-800">{row.code || row.ean || '—'}</div>
                    <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                      +{formatNumber(row.totalInbound)} ks
                    </span>
                  </div>
                  <div className="max-w-[260px] truncate text-slate-500">{row.title || row.ean || 'bez názvu'}</div>
                  {row.ean && <div className="text-[11px] text-slate-400">EAN {row.ean}</div>}
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  <div className={row.stockQuantity == null ? 'font-medium text-amber-700' : 'font-semibold text-slate-800'}>
                    {row.stockQuantity == null ? '—' : `${formatNumber(row.stockQuantity)} ks`}
                  </div>
                  {row.stockQuantity == null && <div className="text-[11px] text-slate-400">není v Upgates stock</div>}
                  {row.stockFetchedAt && <div className="text-[11px] text-slate-400">akt. {formatDateTime(row.stockFetchedAt)}</div>}
                </td>
                <td className="bg-blue-50/45 px-3 py-2 text-right font-semibold text-blue-800">{formatNumber(row.totalInbound)} ks</td>
                {!expanded && <td className="px-3 py-2 text-slate-700">{formatDate(row.earliestEta)}</td>}
                <td className="px-3 py-2 text-slate-600">
                  <div>{row.sizeLabel || '—'}</div>
                  <div className="text-[11px] text-slate-400">
                    {[row.shelfCount ? `${row.shelfCount} polic` : '', row.color || '', row.supplierSuffix ? `sufix ${row.supplierSuffix}` : ''].filter(Boolean).join(' · ')}
                  </div>
                </td>
                {orderColumns.map((column) => {
                  const qty = productOrderQuantity(row, column.orderId);
                  return (
                    <td key={column.orderId} className="px-3 py-2 text-right">
                      <span className={qty > 0 ? 'font-semibold text-blue-700' : 'text-slate-300'}>{qty > 0 ? formatNumber(qty) : '—'}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={5 + orderColumns.length} className="px-3 py-8 text-center text-sm text-slate-500">
                  Žádný produkt neodpovídá zadaným filtrům.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShipmentCard({ order, shipment, documents = [], supabaseClient }) {
  const routeLegs = Array.isArray(shipment.raw_row?.route_legs) ? shipment.raw_row.route_legs : [];
  const billOfLading = shipment.bill_of_lading || shipment.kn_tracking_number;
  const invoice = shipment.commercial_invoice_no;
  const supplierOrderCodes = shipment.supplier_order_codes || shipment.raw_row?.supplier_order_codes || order?.supplier_order_code;
  const loadingDocuments = documents.filter((document) => document.document_type === 'loading_photo' && document.shipment_id === shipment.id);
  const loadingPhotoCount = loadingDocuments.length || toNumber(shipment.loading_photo_count) || 0;
  const loadingLabel = loadingMethodLabel(shipment.loading_method, shipment.palletized);
  const route = [
    shipment.port_of_loading || shipment.raw_row?.port_of_loading,
    shipment.port_of_transshipment || shipment.raw_row?.port_of_transshipment,
    shipment.port_of_discharge || shipment.raw_row?.port_of_discharge,
  ].filter(Boolean).join(' -> ');
  const vesselRoute = routeLegs.length
    ? routeLegs.map((leg) => `${leg.vessel || 'vessel'} ${leg.voyage || ''}`.trim()).join(' / ')
    : `${shipment.vessel_name || '—'} ${shipment.voyage_no || ''}`.trim();
  const shipmentCurrency = shipment.allocated_currency || 'USD';
  const shipmentValueCzk = convertImportUnitCostToCzk(shipment.allocated_amount, shipmentCurrency);
  const containerDisplay = shipmentContainerDisplay(shipment);
  const etaBrno = etaBrnoFromKnPort(shipment);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900">{shipment.shipment_ref || invoice || billOfLading}</div>
          <div className="mt-0.5 text-slate-500">{billOfLading ? `B/L ${billOfLading}` : 'B/L zatím chybí'}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill className={loadingMethodClass(shipment.loading_method, shipment.palletized)}>{loadingLabel}</Pill>
          <Pill className={statusClass(shipment.status)}>{statusLabel(shipment.status)}</Pill>
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-md bg-slate-50 p-2">
          <div className="font-semibold text-slate-800">Termíny</div>
          <div className="mt-1 grid grid-cols-3 gap-2 text-slate-600">
            <span><span className="block text-[10px] uppercase text-slate-400">Odjezd</span>{formatDate(shipment.port_departure_date || shipment.shipped_date)}</span>
            <span><span className="block text-[10px] uppercase text-slate-400">ETA port</span>{formatDate(shipment.eta_port || shipment.eta_hamburg)}</span>
            <span><span className="block text-[10px] uppercase text-slate-400">ETA Brno +2t</span>{formatDate(etaBrno)}</span>
          </div>
        </div>
        <div className="rounded-md bg-slate-50 p-2">
          <div className="font-semibold text-slate-800">Kontejnery</div>
          <div className="mt-1 font-medium text-slate-700">{containerDisplay.primary}</div>
          {containerDisplay.note && <div className="mt-0.5 text-[11px] text-slate-400">{containerDisplay.note}</div>}
          {shipment.loading_summary && <div className="mt-1 text-slate-500">{shipment.loading_summary}</div>}
        </div>
        <div className="rounded-md bg-slate-50 p-2">
          <div className="font-semibold text-slate-800">Doprava</div>
          <div className="mt-1 text-slate-600">{route || 'trasa neuvedena'}</div>
          <div className="mt-1 text-slate-500">{vesselRoute}</div>
        </div>
        <div className="rounded-md bg-slate-50 p-2">
          <div className="font-semibold text-slate-800">Alokace</div>
          <div className="mt-1 text-slate-600">{formatNumber(shipment.allocated_quantity)} ks</div>
          <div className="mt-1 whitespace-nowrap text-slate-700">{formatCurrency(shipmentValueCzk, 'CZK')}</div>
          {shipment.allocated_amount != null && shipmentCurrency !== 'CZK' && (
            <div className="text-[11px] text-slate-400">({formatCurrency(shipment.allocated_amount, shipmentCurrency)})</div>
          )}
        </div>
      </div>
      {(invoice || supplierOrderCodes) && (
        <div className="mt-2 text-slate-500">
          {invoice && <>CI {invoice}</>}
          {supplierOrderCodes && <> · P/I {supplierOrderCodes}</>}
        </div>
      )}
      {loadingPhotoCount > 0 && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-slate-500">{formatNumber(loadingPhotoCount)} fotek naložení</span>
          </div>
          {loadingDocuments.length > 0 && <LoadingPhotoGallery documents={loadingDocuments} supabaseClient={supabaseClient} />}
        </div>
      )}
      {shipment.allocation_note && <div className="mt-1 text-slate-600">{shipment.allocation_note}</div>}
      {shipment.tracking_url && (
        <a className="mt-2 inline-flex font-medium text-blue-700 hover:text-blue-900" href={shipment.tracking_url} target="_blank" rel="noreferrer">
          Otevřít KN tracking
        </a>
      )}
    </div>
  );
}

function LoadingPhotoGallery({ documents = [], supabaseClient }) {
  const photos = useMemo(() => documents.filter((document) => {
    const name = String(document.file_name || '').toLowerCase();
    const contentType = String(document.content_type || '').toLowerCase();
    return contentType.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(name);
  }), [documents]);
  const photoKey = photos.map((photo) => photo.id).join('|');
  const [signedUrls, setSignedUrls] = useState({});
  const [activeIndex, setActiveIndex] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadSignedUrls() {
      const entries = await Promise.all(photos.map(async (photo) => {
        const signedUrl = await fetchSignedDocumentUrl(supabaseClient, photo).catch(() => '');
        return [photo.id, signedUrl];
      }));
      if (!cancelled) setSignedUrls(Object.fromEntries(entries));
    }
    if (photos.length && supabaseClient) void loadSignedUrls();
    return () => {
      cancelled = true;
    };
  }, [photoKey, photos, supabaseClient]);

  useEffect(() => {
    if (activeIndex == null || !photos.length) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') setActiveIndex(null);
      if (event.key === 'ArrowRight') setActiveIndex((index) => (index + 1) % photos.length);
      if (event.key === 'ArrowLeft') setActiveIndex((index) => (index - 1 + photos.length) % photos.length);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [activeIndex, photos.length]);

  if (!photos.length) return null;

  const activePhoto = activeIndex == null ? null : photos[activeIndex];
  const activeUrl = activePhoto ? signedUrls[activePhoto.id] : '';

  return (
    <>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((photo, index) => {
          const url = signedUrls[photo.id];
          return (
            <button
              key={photo.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              className="group overflow-hidden rounded-md border border-slate-200 bg-white text-left hover:border-blue-300"
              title={photo.file_name}
            >
              {url ? (
                <img src={url} alt={photo.file_name} className="h-20 w-full object-cover transition-transform group-hover:scale-[1.03]" />
              ) : (
                <div className="flex h-20 items-center justify-center px-2 text-center text-[11px] text-slate-500">{photo.file_name}</div>
              )}
              <div className="truncate px-2 py-1 text-[11px] font-medium text-slate-600">{photo.file_name}</div>
            </button>
          );
        })}
      </div>
      {activePhoto && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) setActiveIndex(null);
          }}
        >
          <button
            type="button"
            onClick={() => setActiveIndex(null)}
            className="absolute right-4 top-4 rounded-full bg-white/95 px-3 py-1.5 text-lg font-semibold text-slate-800 shadow hover:bg-white"
            aria-label="Zavřít fotku"
          >
            ×
          </button>
          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setActiveIndex((index) => (index - 1 + photos.length) % photos.length)}
                className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-2xl font-semibold text-slate-800 shadow hover:bg-white"
                aria-label="Předchozí fotka"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setActiveIndex((index) => (index + 1) % photos.length)}
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-2xl font-semibold text-slate-800 shadow hover:bg-white"
                aria-label="Další fotka"
              >
                ›
              </button>
            </>
          )}
          <div className="max-h-[90vh] max-w-[92vw]">
            {activeUrl ? (
              <img src={activeUrl} alt={activePhoto.file_name} className="max-h-[82vh] max-w-full rounded-lg object-contain shadow-2xl" />
            ) : (
              <div className="rounded-lg bg-white p-6 text-sm text-slate-700">Fotka se načítá…</div>
            )}
            <div className="mt-2 text-center text-xs font-medium text-white">
              {activePhoto.file_name} · {activeIndex + 1}/{photos.length}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DocumentChecklist({ order, documents, onOpenDocument }) {
  const rows = buildDocumentStatusRows(order, documents);
  const rowDocumentIds = new Set(rows.map((row) => row.document?.id).filter(Boolean));
  const otherDocuments = documents.filter((document) => (
    document.document_type === 'other'
    && !rowDocumentIds.has(document.id)
  ));
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.key}
          className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${
            row.present ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div className="min-w-0">
            <div className={`font-semibold ${row.present ? 'text-emerald-800' : 'text-slate-700'}`}>
              <span className="mr-2">{row.present ? '✓' : '○'}</span>
              {row.label}
            </div>
            <div className="mt-0.5 truncate text-slate-500">
              {row.detail}
              {row.count > 1 ? ` +${row.count - 1}` : ''}
            </div>
          </div>
          {row.document && (
            <button
              type="button"
              onClick={() => onOpenDocument?.(row.document)}
              className="shrink-0 rounded-md border border-emerald-200 bg-white px-2 py-1 font-medium text-emerald-700 hover:border-emerald-300 hover:text-emerald-900"
            >
              Stáhnout
            </button>
          )}
        </div>
      ))}
      {otherDocuments.length > 0 && (
        <div className="pt-1">
          <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">Ostatní</div>
          <div className="flex flex-wrap gap-2">
            {otherDocuments.map((document) => (
              <button
                key={document.id}
                type="button"
                onClick={() => onOpenDocument?.(document)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:border-blue-300 hover:text-blue-700"
              >
                {document.file_name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OrderDetail({
  order,
  lines,
  shipments,
  documents,
  costs,
  purchaseByCode,
  purchaseByEan,
  stockByCode,
  stockByEan,
  inboundByCode,
  inboundByProductKey,
  allocatedLines,
  supabaseClient,
  canUploadDocuments,
  onRefresh,
}) {
  if (!order) return null;
  const totalFreight = costs
    .filter((cost) => ['freight', 'forwarder'].includes(cost.cost_type))
    .reduce((sum, cost) => sum + (toNumber(cost.amount_czk ?? cost.amount) || 0), 0);
  const documentRows = buildDocumentStatusRows(order, documents);
  const presentDocumentRows = documentRows.filter((row) => row.present).length;
  const displayShipments = meaningfulShipments(shipments);
  const containerCount = orderContainerCount(order, shipments);
  const goodsValueCzk = orderGoodsValueCzk(lines);
  const missingPriceCount = toNumber(order.missing_price_line_count) || 0;
  const qtyUnknownCount = toNumber(order.qty_unknown_line_count) || 0;
  const reviewLineCount = toNumber(order.review_line_count) || 0;
  const etaBrno = formatEtaBrnoList(shipments, order.eta_brno);
  const businessDocumentCount = uniqueBusinessDocumentCount(documents);
  const alerts = [
    missingPriceCount ? `${formatNumber(missingPriceCount)} řádků nemá nákupní cenu z importu/PO.` : '',
    totalFreight > 0 ? '' : 'KN/freight cena chybí, landed cost není kompletní.',
    qtyUnknownCount ? `${formatNumber(qtyUnknownCount)} řádků má neznámé množství.` : '',
    reviewLineCount ? `${formatNumber(reviewLineCount)} řádků čeká na kontrolu spárování.` : '',
  ].filter(Boolean);
  const openDocument = async (document) => {
    const url = await fetchSignedDocumentUrl(supabaseClient, document);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Řádků" value={formatNumber(lines.length)} sub="v objednávce" tone="blue" />
        <Kpi label="Množství" value={formatNumber(order.total_pcs)} sub={qtyUnknownCount ? 'část qty chybí' : 'potvrzené'} tone={qtyUnknownCount ? 'amber' : 'emerald'} />
        <Kpi label="Kontejnerů" value={formatNumber(containerCount)} sub={displayShipments.length ? `${formatNumber(displayShipments.length)} zásilek` : 'shipmenty chybí'} tone="slate" />
        <Kpi label="ETA Brno" value={etaBrno} sub="+2 týdny od ETA port z KN" tone="slate" />
        <Kpi label="Hodnota zboží" value={formatCurrency(goodsValueCzk, 'CZK')} sub="z importních cen" tone={goodsValueCzk ? 'emerald' : 'amber'} />
        <Kpi label="Dokumenty" value={`${presentDocumentRows}/${documentRows.length}`} sub="order až KN invoice" tone={presentDocumentRows === documentRows.length ? 'emerald' : 'amber'} />
      </div>
      {alerts.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {alerts.map((alert) => <div key={alert}>{alert}</div>)}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Shipments</h3>
          <div className="space-y-2">
            {displayShipments.length ? displayShipments.map((shipment) => (
              <ShipmentCard key={shipment.id} order={order} shipment={shipment} documents={documents} supabaseClient={supabaseClient} />
            )) : <div className="text-xs text-slate-500">Zatím bez shipment řádků.</div>}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">Dokumenty</h3>
            <span className="text-xs text-slate-400">{businessDocumentCount} souborů</span>
          </div>
          <DocumentChecklist order={order} documents={documents} onOpenDocument={openDocument} />
          <div className="my-3 border-t border-slate-100" />
          <DocumentUpload order={order} supabaseClient={supabaseClient} canUploadDocuments={canUploadDocuments} onUploaded={onRefresh} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-[1180px] w-full text-xs">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Produkt</th>
              <th className="px-3 py-2 text-right font-semibold">Qty</th>
              <th className="px-3 py-2 text-right font-semibold">Sklad + inbound</th>
              <th className="px-3 py-2 text-right font-semibold">Upgates NC</th>
              <th className="min-w-[170px] px-3 py-2 text-right font-semibold">Buy price CZK</th>
              <th className="px-3 py-2 text-right font-semibold">Freight/ks</th>
              <th className="px-3 py-2 text-right font-semibold">Landed</th>
              <th className="px-3 py-2 text-center font-semibold">OK</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const code = productCodeForLine(line);
              const ean = productEanForLine(line);
              const purchase = getLookupValue(purchaseByCode, lineCodeKeys(line)) || getLookupValue(purchaseByEan, lineEanKeys(line));
              const stockRow = lineStockRow(line, stockByCode, stockByEan);
              const currentStock = stockRow?.stock_quantity ?? null;
              const allocated = allocatedLines.get(line.id);
              const productKey = productIdentityKeyForLine(line);
              const inboundRows = inboundByProductKey?.get(productKey) || inboundByCode.get(code) || [];
              const inboundQty = inboundRows.reduce((sum, item) => sum + (toNumber(item.quantity) || 0), 0);
              const sourceLabel = buyPriceSourceLabel(line);
              const importUnitCostCzk = convertImportUnitCostToCzk(line.unit_purchase_price, line.purchase_currency || 'CZK');
              return (
                <tr key={line.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-800">{line.master_rm_code || line.matched_rm_code || line.rm_code || '—'}</div>
                    <div className="max-w-[340px] truncate text-slate-500">{line.master_title || line.product_title || line.spec}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-slate-800">{formatNumber(line.quantity)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    <div className={currentStock == null ? 'font-medium text-amber-700' : ''}>
                      {stockRow ? `Skladem ${formatNumber(currentStock)} ks` : 'chybí'}
                    </div>
                    {currentStock == null && <div className="text-[11px] text-slate-400">{stockRow ? 'stock neznámý' : 'není v Upgates'}</div>}
                    {stockRow?.availability && <div className="text-[11px] text-slate-400">{stockRow.availability}</div>}
                    {stockRow?.fetched_at && <div className="text-[11px] text-slate-400">akt. {formatDateTime(stockRow.fetched_at)}</div>}
                    {inboundQty > 0 && <div className="text-[11px] text-slate-500">Inbound +{formatNumber(inboundQty)} ks</div>}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(purchase?.purchase_price_czk ?? purchase?.purchase_price_without_vat_native, purchase?.purchase_price_czk ? 'CZK' : purchase?.currency)}</td>
                  <td className="min-w-[170px] px-3 py-2 text-right text-slate-700">
                    <div>{formatCurrency(importUnitCostCzk, 'CZK')}</div>
                    {line.unit_purchase_price != null && (
                      <div className="ml-auto max-w-[170px] truncate text-right text-[11px] text-slate-400">
                        {formatCurrency(line.unit_purchase_price, line.purchase_currency || 'USD')} {sourceLabel ? `· ${sourceLabel}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(allocated?.freightPerUnit, 'CZK')}</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-800">{formatCurrency(allocated?.landedUnitCostCzk ?? allocated?.landedUnitCost, 'CZK')}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={line.audit_status === 'review' ? 'font-semibold text-amber-700' : 'font-semibold text-emerald-700'}>
                      {line.audit_status === 'review' ? '!' : '✓'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ImportLogisticsModule({ supabaseClient, supabaseUrl, supabaseKey, canLoadSalesHistory = true, canUploadDocuments = false }) {
  const [view, setView] = useState('orders');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [data, setData] = useState(() => importLogisticsCache?.data || emptyData());
  const [loading, setLoading] = useState(() => !importLogisticsCache?.data);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [orderSort, setOrderSort] = useState({ key: 'eta_brno', direction: 'asc' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const cached = importLogisticsCache;
      if (refreshKey === 0 && cached?.data && Date.now() - cached.cachedAt < IMPORT_LOGISTICS_CACHE_MS) {
        setData(cached.data);
        setLoading(false);
        setRefreshing(false);
        setSelectedOrderId((current) => current || cached.data.orders[0]?.id || null);
        return;
      }

      const hasUsableSnapshot = Boolean(importLogisticsCache?.data);
      setLoading(!hasUsableSnapshot);
      setRefreshing(hasUsableSnapshot);
      setError('');
      try {
        const today = new Date();
        const from = new Date(today);
        from.setDate(from.getDate() - 90);

        const loadSalesHistory = () => (canLoadSalesHistory
          ? supabaseClient.auth
              .getSession()
              .then(({ data: sessionData }) => fetchOrdersViaRest({
                supabaseUrl,
                supabaseKey,
                accessToken: sessionData?.session?.access_token,
                fromDate: dateForInput(from),
                toDate: dateForInput(today),
              }))
              .catch(() => [])
          : Promise.resolve([]));

        const [
          orders,
          lines,
          shipments,
          documents,
          costs,
          purchaseRows,
          stockRows,
        ] = await Promise.all([
          fetchAllRows(() => supabaseClient.from('import_orders_on_the_way').select('*').order('eta_brno', { ascending: true, nullsFirst: false })),
          fetchAllRows(() => supabaseClient.from('import_order_lines_detail').select('*').in('order_status', ['navrh', 'objednano', 'shipped', 'v_pristavu']).order('source_row', { ascending: true })),
          fetchAllRows(() => supabaseClient.from('import_order_shipments').select('*').order('eta_brno', { ascending: true, nullsFirst: false })),
          fetchAllRows(() => supabaseClient.from('import_order_documents').select('*').order('created_at', { ascending: false })),
          fetchAllRows(() => supabaseClient.from('import_order_costs').select('*')),
          fetchAllRows(() => supabaseClient.from('upgates_product_purchase_prices_current').select('product_code,market,currency,purchase_price_without_vat_native,purchase_price_czk,title,ean')),
          fetchAllRows(() => supabaseClient.from('upgates_product_stock_current').select('product_code,ean,title,stock_quantity,stock_status,availability,availability_type,is_active,is_archived,can_add_to_basket,fetched_at')),
        ]);
        if (cancelled) return;
        const inTransitOrderIds = new Set(orders.map((order) => order.id));
        const loadedData = {
          orders,
          lines: lines.filter((line) => inTransitOrderIds.has(line.order_id)),
          shipments: shipments.filter((shipment) => inTransitOrderIds.has(shipment.order_id)),
          documents: documents.filter((document) => inTransitOrderIds.has(document.order_id)),
          costs: costs.filter((cost) => inTransitOrderIds.has(cost.order_id)),
          purchaseRows,
          stockRows,
          historyOrders: importLogisticsCache?.data?.historyOrders || [],
        };
        importLogisticsCache = { data: loadedData, cachedAt: Date.now() };
        setData(loadedData);
        setSelectedOrderId((current) => current || orders[0]?.id || null);
        setLoading(false);
        setRefreshing(false);

        loadSalesHistory().then((historyOrders) => {
          if (cancelled) return;
          setData((current) => {
            const nextData = { ...current, historyOrders };
            importLogisticsCache = { data: nextData, cachedAt: Date.now() };
            return nextData;
          });
        });
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError?.message || 'Importní logistika se nepodařila načíst.');
        if (!importLogisticsCache?.data) setData(emptyData());
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [canLoadSalesHistory, refreshKey, supabaseClient, supabaseKey, supabaseUrl]);

  const derived = useMemo(() => {
    const linesByOrder = new Map();
    const shipmentsByOrder = new Map();
    const documentsByOrder = new Map();
    const costsByOrder = new Map();

    for (const line of data.lines) {
      if (!linesByOrder.has(line.order_id)) linesByOrder.set(line.order_id, []);
      linesByOrder.get(line.order_id).push(line);
    }
    for (const shipment of data.shipments) {
      if (!shipmentsByOrder.has(shipment.order_id)) shipmentsByOrder.set(shipment.order_id, []);
      shipmentsByOrder.get(shipment.order_id).push(shipment);
    }
    for (const document of data.documents) {
      if (!documentsByOrder.has(document.order_id)) documentsByOrder.set(document.order_id, []);
      documentsByOrder.get(document.order_id).push(document);
    }
    for (const cost of data.costs) {
      if (!costsByOrder.has(cost.order_id)) costsByOrder.set(cost.order_id, []);
      costsByOrder.get(cost.order_id).push(cost);
    }

    const purchaseByCode = new Map();
    const purchaseByEan = new Map();
    const stockByCode = new Map();
    const stockByEan = new Map();
    for (const row of data.purchaseRows) {
      const code = row.product_code;
      const ean = row.ean;
      if (code) setPreferred(purchaseByCode, code, row, preferredCatalogRow);
      if (ean) setPreferred(purchaseByEan, ean, row, preferredCatalogRow);
    }
    for (const row of data.stockRows) {
      if (row.product_code) setPreferred(stockByCode, row.product_code, row, preferredStockRow);
      if (row.ean) setPreferred(stockByEan, row.ean, row, preferredStockRow);
    }

    const velocity = buildSalesVelocity(data.historyOrders, { asOfDate: new Date() });
    const ordersById = new Map(data.orders.map((order) => [order.id, order]));
    const orderColumns = data.orders.map((order) => {
      const orderLines = linesByOrder.get(order.id) || [];
      const totalQty = orderLines.reduce((sum, line) => sum + (toNumber(line.quantity) || 0), 0);
      const etaDate = orderEtaBrnoIso(order, shipmentsByOrder.get(order.id) || []);
      return {
        orderId: order.id,
        orderCode: order.order_code,
        supplierOrderCode: order.supplier_order_code,
        status: order.status,
        etaDate,
        etaLabel: formatDate(etaDate),
        totalQty,
      };
    })
      .filter((column) => column.totalQty > 0 && column.status !== 'navrh')
      .sort((a, b) => compareSortable(a.etaDate || '9999-12-31', b.etaDate || '9999-12-31', 'asc')
        || SORT_COLLATOR.compare(a.orderCode || '', b.orderCode || ''));

    const inboundByCode = new Map();
    const inboundByProductKey = new Map();
    const productMap = new Map();
    let unmatchedProductLineCount = 0;
    for (const line of data.lines) {
      const code = productCodeForLine(line);
      const ean = productEanForLine(line);
      const productKey = productIdentityKeyForLine(line);
      const qty = toNumber(line.quantity) || 0;
      const order = ordersById.get(line.order_id);
      const etaDate = order ? orderEtaBrnoIso(order, shipmentsByOrder.get(order.id) || []) : null;
      if (order?.status === 'navrh') continue;
      const hasReliableProductMatch = Boolean(productKey && line.product_master_id && line.audit_status !== 'review');
      if (!(qty > 0) || !hasReliableProductMatch) {
        unmatchedProductLineCount += 1;
        continue;
      }
      if (code) {
        if (!inboundByCode.has(code)) inboundByCode.set(code, []);
        inboundByCode.get(code).push({
          quantity: qty,
          ean,
          etaDate,
          orderCode: order?.order_code || '',
        });
      }
      if (!inboundByProductKey.has(productKey)) inboundByProductKey.set(productKey, []);
      inboundByProductKey.get(productKey).push({
        quantity: qty,
        ean,
        etaDate,
        orderCode: order?.order_code || '',
      });

      if (!productMap.has(productKey)) {
        productMap.set(productKey, {
          productKey,
          code,
          ean,
          title: productTitleForLine(line),
          heightMm: line.height_mm,
          widthMm: line.width_mm,
          depthMm: line.depth_mm,
          shelfCount: line.shelf_count,
          color: line.color || line.finish || '',
          supplierSuffix: line.supplier_suffix,
          stockRow: null,
          totalInbound: 0,
          earliestEta: null,
          lineCount: 0,
          reviewLineCount: 0,
          orderQuantities: new Map(),
          orderLineIds: new Map(),
        });
      }
      const productRow = productMap.get(productKey);
      const stockRow = lineStockRow(line, stockByCode, stockByEan);
      if (stockRow) productRow.stockRow = preferredStockRow(productRow.stockRow, stockRow);
      productRow.totalInbound += qty;
      productRow.lineCount += 1;
      if (line.audit_status === 'review' || !line.product_master_id) productRow.reviewLineCount += 1;
      productRow.heightMm = productRow.heightMm ?? line.height_mm;
      productRow.widthMm = productRow.widthMm ?? line.width_mm;
      productRow.depthMm = productRow.depthMm ?? line.depth_mm;
      productRow.shelfCount = productRow.shelfCount ?? line.shelf_count;
      productRow.color = productRow.color || line.color || line.finish || '';
      productRow.supplierSuffix = productRow.supplierSuffix ?? line.supplier_suffix;
      productRow.ean = productRow.ean || ean;
      productRow.title = productRow.title || productTitleForLine(line);
      if (etaDate && (!productRow.earliestEta || etaDate < productRow.earliestEta)) productRow.earliestEta = etaDate;
      const currentOrderQty = productRow.orderQuantities.get(line.order_id) || 0;
      productRow.orderQuantities.set(line.order_id, currentOrderQty + qty);
      if (!productRow.orderLineIds.has(line.order_id)) productRow.orderLineIds.set(line.order_id, []);
      productRow.orderLineIds.get(line.order_id).push(line.id);
    }

    const productRows = Array.from(productMap.values()).map((row) => ({
      ...row,
      stockQuantity: row.stockRow?.stock_quantity ?? null,
      stockStatus: row.stockRow ? (row.stockRow.stock_quantity == null ? 'unknown' : 'known') : 'missing_upgates_card',
      stockFetchedAt: row.stockRow?.fetched_at || null,
      availability: row.stockRow?.availability || '',
      searchText: normalizeSearch(`${row.code} ${row.ean} ${row.title}`),
      sizeLabel: productDimensionLabel(row),
    }));
    const productFilterOptions = {
      heights: [...new Set(productRows.map((row) => productDimensionValue(row.heightMm)).filter(Boolean))].sort((a, b) => Number(a) - Number(b)),
      widths: [...new Set(productRows.map((row) => productDimensionValue(row.widthMm)).filter(Boolean))].sort((a, b) => Number(a) - Number(b)),
      depths: [...new Set(productRows.map((row) => productDimensionValue(row.depthMm)).filter(Boolean))].sort((a, b) => Number(a) - Number(b)),
      colors: [...new Set(productRows.map((row) => String(row.color || '').trim()).filter(Boolean))].sort((a, b) => SORT_COLLATOR.compare(a, b)),
    };
    const latestStockFetchedAt = data.stockRows
      .map((row) => row.fetched_at)
      .filter(Boolean)
      .sort()
      .at(-1) || null;

    const riskRows = Array.from(inboundByCode.entries()).map(([code, inbound]) => {
      const inboundEan = inbound.find((item) => item.ean)?.ean;
      const purchase = getLookupValue(purchaseByCode, [code]) || getLookupValue(purchaseByEan, [inboundEan]);
      const stockRow = getLookupValue(stockByCode, [code]) || getLookupValue(stockByEan, [inboundEan]);
      const currentStock = stockRow?.stock_quantity ?? null;
      const velocityRow = velocity[code] || {};
      const predicted = currentStock == null
        ? { date: null }
        : predictStockoutDate({
          currentStock,
          inboundShipments: inbound,
          baseDailyDemand: velocityRow[30]?.globalDaily || 0,
          asOfDate: new Date(),
        });
      const earliestEta = inbound.map((item) => item.etaDate).filter(Boolean).sort()[0] || null;
      return {
        code,
        ean: purchase?.ean || '',
        title: stockRow?.title || purchase?.title || '',
        stock: currentStock,
        stockStatus: stockRow ? (currentStock == null ? 'unknown' : 'known') : 'missing_upgates_card',
        inboundQty: inbound.reduce((sum, item) => sum + (toNumber(item.quantity) || 0), 0),
        eta: earliestEta,
        velocity7: velocityRow[7]?.globalDaily || 0,
        velocity14: velocityRow[14]?.globalDaily || 0,
        velocity30: velocityRow[30]?.globalDaily || 0,
        byMarket7: velocityRow[7]?.byMarket || {},
        byMarket14: velocityRow[14]?.byMarket || {},
        byMarket30: velocityRow[30]?.byMarket || {},
        stockoutDate: predicted.date,
        stockoutBeforeInbound: predicted.date && earliestEta ? predicted.date < earliestEta : false,
      };
    }).sort((a, b) => {
      if (!a.stockoutDate && !b.stockoutDate) return b.velocity30 - a.velocity30;
      if (!a.stockoutDate) return 1;
      if (!b.stockoutDate) return -1;
      return a.stockoutDate.localeCompare(b.stockoutDate);
    });

    const allocatedByLine = new Map();
    for (const order of data.orders) {
      const orderLines = linesByOrder.get(order.id) || [];
      const orderCosts = costsByOrder.get(order.id) || [];
      const totalFreight = orderCosts
        .filter((cost) => ['freight', 'forwarder'].includes(cost.cost_type))
        .reduce((sum, cost) => sum + (toNumber(cost.amount_czk ?? cost.amount) || 0), 0);
      if (!(totalFreight > 0)) {
        orderLines.forEach((line) => {
          allocatedByLine.set(line.id, {
            id: line.id,
            freightPerUnit: null,
            landedUnitCost: null,
            landedCostStatus: 'missing_freight',
          });
        });
        continue;
      }
      const allocated = allocateFreightByValue(orderLines.map((line) => ({
        id: line.id,
        quantity: line.quantity,
        unitPurchasePrice: line.unit_purchase_price,
        unitPurchasePriceCzk: convertImportUnitCostToCzk(line.unit_purchase_price, line.purchase_currency || 'CZK'),
        purchaseCurrency: line.purchase_currency || 'CZK',
      })), totalFreight);
      allocated.forEach((row) => allocatedByLine.set(row.id, row));
    }

    const priceRows = data.lines
      .filter((line) => line.product_master_id)
      .map((line) => {
        const code = line.master_rm_code || line.matched_rm_code || line.rm_code;
        const ean = line.master_ean || line.matched_ean || line.ean;
        const purchase = getLookupValue(purchaseByCode, lineCodeKeys(line)) || getLookupValue(purchaseByEan, lineEanKeys(line));
        const allocated = allocatedByLine.get(line.id);
        const currentNc = purchase?.purchase_price_czk ?? (purchase?.currency === 'CZK' ? purchase?.purchase_price_without_vat_native : null);
        const landed = allocated?.landedUnitCostCzk ?? allocated?.landedUnitCost ?? null;
        const importCostCzk = convertImportUnitCostToCzk(line.unit_purchase_price, line.purchase_currency || 'CZK');
        return {
          line,
          code,
          title: line.master_title || line.product_title || purchase?.title || '',
          currentNc,
          currentCurrency: 'CZK',
          importCost: line.unit_purchase_price,
          importCurrency: line.purchase_currency || 'USD',
          importCostCzk,
          landedCost: landed,
          previousImportCost: null,
          deltaPct: currentNc && landed ? ((landed - currentNc) / currentNc) * 100 : null,
          status: line.unit_purchase_price == null ? 'missing_import_price' : (importCostCzk == null ? 'missing_fx_rate' : (landed == null ? 'missing_freight' : 'ready')),
        };
      })
      .sort((a, b) => Math.abs(b.deltaPct || 0) - Math.abs(a.deltaPct || 0));

    return {
      linesByOrder,
      shipmentsByOrder,
      documentsByOrder,
      costsByOrder,
      purchaseByCode,
      purchaseByEan,
      stockByCode,
      stockByEan,
      inboundByCode,
      inboundByProductKey,
      orderColumns,
      productRows,
      productFilterOptions,
      latestStockFetchedAt,
      unmatchedProductLineCount,
      riskRows,
      allocatedByLine,
      priceRows,
      reviewRows: data.lines.filter((line) => line.audit_status === 'review'),
    };
  }, [data]);

  const selectedOrder = data.orders.find((order) => order.id === selectedOrderId) || data.orders[0] || null;
  const selectedLines = selectedOrder ? (derived.linesByOrder.get(selectedOrder.id) || []) : [];
  const selectedShipments = selectedOrder ? (derived.shipmentsByOrder.get(selectedOrder.id) || []) : [];
  const selectedDocuments = selectedOrder ? (derived.documentsByOrder.get(selectedOrder.id) || []) : [];
  const selectedCosts = selectedOrder ? (derived.costsByOrder.get(selectedOrder.id) || []) : [];
  const handleOrderSort = (key) => {
    setOrderSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const summary = useMemo(() => {
    const totalPcs = data.orders.reduce((sum, order) => sum + (toNumber(order.total_pcs) || 0), 0);
    const reviewRows = data.orders.reduce((sum, order) => sum + (toNumber(order.review_line_count) || 0), 0);
    const missingPrices = data.orders.reduce((sum, order) => sum + (toNumber(order.missing_price_line_count) || 0), 0);
    const risky = derived.riskRows.filter((row) => row.stockoutBeforeInbound).length;
    const qtyUnknown = data.orders.reduce((sum, order) => sum + (toNumber(order.qty_unknown_line_count) || 0), 0);
    return { totalPcs, reviewRows, missingPrices, risky, qtyUnknown };
  }, [data.orders, derived.riskRows]);

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Načítám importní logistiku...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-semibold">Importní logistika není dostupná.</div>
        <div className="mt-1">{error}</div>
        <div className="mt-2 text-xs">Zkontroluj, že je aplikovaná migrace <code>supabase/import_logistics.sql</code> a proběhl import <code>npm run import:logistics</code>.</div>
      </div>
    );
  }

  return (
    <div className="rm-import space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Objednávky na cestě" value={formatNumber(data.orders.length)} sub="aktuální importy" tone="blue" />
        <Kpi label="Potvrzený inbound" value={formatNumber(summary.totalPcs)} sub={summary.qtyUnknown ? `${formatNumber(summary.qtyUnknown)} řádků bez qty` : 'všechny qty doplněné'} tone="emerald" />
        <Kpi label="Ke kontrole" value={formatNumber(summary.reviewRows)} sub="nesedí jistota produktu" tone={summary.reviewRows ? 'amber' : 'slate'} />
        <Kpi label="Riziko před ETA" value={formatNumber(summary.risky)} sub="+20 % MoM forecast" tone={summary.risky ? 'red' : 'slate'} />
      </div>

      <div className="rm-alert rm-alert--warn">
        Landed cost je označený jako nekompletní, dokud chybí importní nákupky nebo KN/forwarder faktury. Clo v této verzi nepočítáme.
      </div>

      <div className="rm-subtabs">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setView(tab.id)}
            className={`rm-subtab ${view === tab.id ? 'rm-subtab--active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
        {refreshing && <span className="rm-subtabs-meta">Aktualizuji…</span>}
      </div>

      {view === 'orders' && (
        <>
          <OrdersTable
            orders={data.orders}
            linesByOrder={derived.linesByOrder}
            shipmentsByOrder={derived.shipmentsByOrder}
            documentsByOrder={derived.documentsByOrder}
            selectedOrderId={selectedOrder?.id}
            onSelect={setSelectedOrderId}
            sort={orderSort}
            onSort={handleOrderSort}
          />
          <OrderDetail
            order={selectedOrder}
            lines={selectedLines}
            shipments={selectedShipments}
            documents={selectedDocuments}
            costs={selectedCosts}
            purchaseByCode={derived.purchaseByCode}
            purchaseByEan={derived.purchaseByEan}
            stockByCode={derived.stockByCode}
            stockByEan={derived.stockByEan}
            inboundByCode={derived.inboundByCode}
            inboundByProductKey={derived.inboundByProductKey}
            allocatedLines={derived.allocatedByLine}
            supabaseClient={supabaseClient}
            canUploadDocuments={canUploadDocuments}
            onRefresh={() => setRefreshKey((key) => key + 1)}
          />
        </>
      )}

      {view === 'products' && (
        <ProductInboundView
          rows={derived.productRows}
          columns={derived.orderColumns}
          filterOptions={derived.productFilterOptions}
          latestStockFetchedAt={derived.latestStockFetchedAt}
          unmatchedLineCount={derived.unmatchedProductLineCount}
        />
      )}

      {view === 'risk' && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-[1040px] w-full text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">SKU/EAN</th>
                <th className="px-3 py-2 text-right font-semibold">Sklad</th>
                <th className="px-3 py-2 text-right font-semibold">Inbound</th>
                <th className="px-3 py-2 text-left font-semibold">ETA</th>
                <th className="px-3 py-2 text-right font-semibold">Vel. 7</th>
                <th className="px-3 py-2 text-right font-semibold">Vel. 14</th>
                <th className="px-3 py-2 text-right font-semibold">Vel. 30</th>
                <th className="px-3 py-2 text-left font-semibold">CZ/SK/HU/RO 7/14/30</th>
                <th className="px-3 py-2 text-left font-semibold">Stockout</th>
              </tr>
            </thead>
            <tbody>
              {derived.riskRows.map((row) => (
                <tr key={row.code} className={`border-t border-slate-100 ${row.stockoutBeforeInbound ? 'bg-red-50' : 'odd:bg-white even:bg-slate-50/60'}`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-800">{row.code}</div>
                    <div className="text-slate-500">{row.ean || row.title}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    <div className={row.stock == null ? 'font-medium text-amber-700' : ''}>{row.stock == null ? '—' : `${formatNumber(row.stock)} ks`}</div>
                    {row.stock == null && (
                      <div className="text-[11px] text-slate-400">
                        {row.stockStatus === 'missing_upgates_card' ? 'není v Upgates' : 'stock neznámý'}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-slate-800">{formatNumber(row.inboundQty)}</td>
                  <td className="px-3 py-2 text-slate-700">{formatDate(row.eta)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.velocity7, 2)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.velocity14, 2)}</td>
                  <td className="px-3 py-2 text-right font-medium text-slate-800">{formatNumber(row.velocity30, 2)}</td>
                  <td className="px-3 py-2 text-slate-600">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {Object.entries(MARKET_LABELS).map(([market, label]) => (
                        <span key={market}>
                          {label} {formatNumber(row.byMarket7?.[market]?.daily || 0, 2)}
                          /{formatNumber(row.byMarket14?.[market]?.daily || 0, 2)}
                          /{formatNumber(row.byMarket30?.[market]?.daily || 0, 2)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={row.stockoutBeforeInbound ? 'font-semibold text-red-700' : 'text-slate-700'}>
                      {formatDate(row.stockoutDate)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'prices' && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-[920px] w-full text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Produkt</th>
                <th className="px-3 py-2 text-right font-semibold">Aktuální Upgates NC</th>
                <th className="min-w-[170px] px-3 py-2 text-right font-semibold">Buy price CZK</th>
                <th className="px-3 py-2 text-right font-semibold">Landed CZK</th>
                <th className="px-3 py-2 text-right font-semibold">Předchozí import</th>
                <th className="px-3 py-2 text-right font-semibold">Změna</th>
                <th className="px-3 py-2 text-left font-semibold">Stav</th>
              </tr>
            </thead>
            <tbody>
              {derived.priceRows.map((row) => (
                <tr key={`${row.line.id}-${row.code}`} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-800">{row.code}</div>
                    <div className="max-w-[420px] truncate text-slate-500">{row.title}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.currentNc, row.currentCurrency || 'CZK')}</td>
	                  <td className="min-w-[170px] px-3 py-2 text-right text-slate-700">
                      <div>{formatCurrency(row.importCostCzk, 'CZK')}</div>
                      {row.line?.unit_purchase_price != null && (
                        <div className="ml-auto max-w-[170px] truncate text-right text-[11px] text-slate-400">
                          {formatCurrency(row.importCost, row.importCurrency)} · {buyPriceSourceLabel(row.line)}
                        </div>
                      )}
                    </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-800">{formatCurrency(row.landedCost, 'CZK')}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{formatCurrency(row.previousImportCost, 'CZK')}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={row.deltaPct == null ? 'text-slate-400' : row.deltaPct > 0 ? 'font-semibold text-red-700' : 'font-semibold text-emerald-700'}>
                      {row.deltaPct == null ? '—' : formatPct(row.deltaPct)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'review' && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-[980px] w-full text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Order/row</th>
                <th className="px-3 py-2 text-left font-semibold">Spec</th>
                <th className="px-3 py-2 text-left font-semibold">Reason</th>
                <th className="px-3 py-2 text-left font-semibold">Candidates</th>
              </tr>
            </thead>
            <tbody>
              {derived.reviewRows.length ? derived.reviewRows.map((line) => (
                <tr key={line.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                  <td className="px-3 py-2 font-semibold text-slate-800">{line.order_code} · row {line.source_row}</td>
                  <td className="px-3 py-2 text-slate-700">{line.spec} · {line.finish}</td>
                  <td className="px-3 py-2 text-amber-700">{line.match_reason}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {(line.match_candidates || []).map((candidate) => candidate.code).join(', ') || '—'}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">Žádné řádky k ručnímu párování.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
