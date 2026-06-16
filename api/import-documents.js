import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { FX_RATES_TO_CZK, normalizeCurrency } from '../src/currencyRates.js';
import { parseSupplierProformaPdf } from '../src/importLogisticsProforma.js';
import { MODULE_IDS, getUserAccess, normalizeEmail } from '../src/userPermissions.js';

const DEFAULT_SUPABASE_URL = 'https://oonnawrfsbsbuijmfcqj.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vbm5hd3Jmc2JzYnVpam1mY3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMjA4ODcsImV4cCI6MjA4NTg5Njg4N30.d1jk1BYOc6eEx-KJzGpW3ekfDs4jxW10VgKmLef8f1Y';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ALLOWED_DOMAINS = (process.env.AUTH_ALLOWED_EMAIL_DOMAINS || 'regalmaster.cz,smartbidding.cz')
  .split(',')
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);
const BUCKET = 'import-documents';
const DOCUMENT_TYPES = new Set(['supplier_order', 'supplier_invoice', 'payment_proof', 'supplier_proforma', 'packing_list', 'forwarder_invoice', 'bl_tracking', 'loading_photo', 'other']);

function withCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
    return { error: { status: 403, message: `Email ${email || 'bez emailu'} není povolený.` } };
  }
  const access = getUserAccess(email);
  if (!access.modules.includes(MODULE_IDS.IMPORT_LOGISTICS)) {
    return { error: { status: 403, message: 'Importní logistika je zatím povolená jen pro oprávněné uživatele.' } };
  }

  return { user: data.user, access };
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const safeFileName = (value) => String(value || 'document')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120) || 'document';

const safeStorageSegment = (value) => safeFileName(value).replace(/\./g, '-');

function normalizedContentType(fileName, contentType) {
  const name = String(fileName || '').toLowerCase();
  const type = String(contentType || '').trim();
  if (/\.numbers$/i.test(name)) return 'application/x-iwork-numbers-sffnumbers';
  if (type && type !== 'application/octet-stream') return type;
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  if (/\.xlsx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (/\.xls$/i.test(name)) return 'application/vnd.ms-excel';
  if (/\.csv$/i.test(name)) return 'text/csv';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.png$/i.test(name)) return 'image/png';
  return type || 'application/octet-stream';
}

function inferDocumentType(fileName) {
  const name = String(fileName || '').toLowerCase();
  if (/(payment[-_\s]?proof|proof[-_\s]?of[-_\s]?payment|potvrzeni[-_\s]?platby|potvrzení[-_\s]?platby|uhrada|úhrada|platba)/i.test(name)) return 'payment_proof';
  if (/(kuehne|kühne|\bkn\b|forwarder|freight|doprava)/i.test(name)) return 'forwarder_invoice';
  if (/(invoice|commercial[-_\s]?invoice|\bci\b|faktura)/i.test(name)) return 'supplier_invoice';
  if (/(packing|packlist|packing-list|\bpl\b)/i.test(name)) return 'packing_list';
  if (/(bill[-_\s]?of[-_\s]?lading|\bbl\b|tracking)/i.test(name)) return 'bl_tracking';
  if (/(proforma|\bpi\b)/i.test(name)) return 'supplier_proforma';
  if (/(purchase[-_\s]?order|\bpo\b|objedn[aá]vka|\border\b)/i.test(name)) return 'supplier_order';
  if (/\b\d{2}ml\d{4}e\d{3}\b/i.test(name)) return 'supplier_order';
  return 'other';
}

async function getOrder(supabase, orderId) {
  const { data, error } = await supabase
    .from('import_orders')
    .select('id,order_code,status,ordered_date,total_pcs,audit_summary')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw new Error(`Order lookup failed: ${error.message}`);
  if (!data) throw new Error('Importní objednávka neexistuje.');
  return data;
}

async function listOrderLines(supabase, orderId) {
  const { data, error } = await supabase
    .from('import_order_lines')
    .select('id,source_row,raw_row,rm_code,ean,matched_rm_code,matched_ean,product_title,product_master_id,quantity,unit_purchase_price,purchase_currency,audit_status')
    .eq('order_id', orderId)
    .order('source_row', { ascending: true });
  if (error) throw new Error(`Order lines lookup failed: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

async function listDocuments(supabase, orderId) {
  const { data, error } = await supabase
    .from('import_order_documents')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Document list failed: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

async function getDocument(supabase, documentId) {
  const { data, error } = await supabase
    .from('import_order_documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle();
  if (error) throw new Error(`Document lookup failed: ${error.message}`);
  if (!data) throw new Error('Dokument neexistuje.');
  return data;
}

async function signedDocumentUrl(supabase, document) {
  const { data, error } = await supabase.storage
    .from(document.storage_bucket || BUCKET)
    .createSignedUrl(document.file_path, 60 * 5, {
      download: document.file_name || true,
    });
  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  return data?.signedUrl || null;
}

function amountToCzk(amount, currency) {
  const number = Number(String(amount ?? '').replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) return null;
  const normalized = normalizeCurrency(currency || 'CZK');
  const rate = FX_RATES_TO_CZK[normalized];
  return rate == null ? null : number * rate;
}

function positionForLine(line) {
  const rawPosition = line?.raw_row?.['Pos.'] ?? line?.raw_row?.Pos ?? line?.raw_row?.Position;
  const parsedRawPosition = Number(rawPosition);
  if (Number.isFinite(parsedRawPosition) && parsedRawPosition > 0) return parsedRawPosition;
  const sourceRow = Number(line?.source_row);
  return Number.isFinite(sourceRow) ? sourceRow - 1 : null;
}

function buildProformaProposal({ order, lines, parsed }) {
  const linesByPosition = new Map();
  for (const line of lines) {
    const position = positionForLine(line);
    if (position != null) linesByPosition.set(position, line);
  }

  const lineUpdates = (parsed.items || []).map((item) => {
    const line = linesByPosition.get(item.position) || null;
    return {
      position: item.position,
      item_no: item.itemNo,
      finish: item.finish,
      matched_line_id: line?.id || null,
      rm_code: line?.matched_rm_code || line?.rm_code || null,
      ean: line?.matched_ean || line?.ean || null,
      title: line?.product_title || null,
      quantity_before: line?.quantity ?? null,
      quantity_after: item.quantity,
      buy_price_before: line?.unit_purchase_price ?? null,
      buy_price_after: item.unitPurchasePrice,
      currency_before: line?.purchase_currency ?? null,
      currency_after: item.purchaseCurrency || parsed.currency || 'USD',
      extended_price: item.extendedPrice,
      will_update: Boolean(line?.id),
      issue: line?.id ? null : 'line_not_found',
    };
  });

  const matchedUpdates = lineUpdates.filter((update) => update.will_update);
  const totalQuantityAfter = parsed.totalQuantity ?? matchedUpdates.reduce((sum, update) => sum + (Number(update.quantity_after) || 0), 0);

  return {
    order_id: order.id,
    order_code: order.order_code,
    document_kind: parsed.documentKind,
    invoice_no: parsed.invoiceNo,
    supplier_order_code: parsed.supplierOrderCode,
    issue_date: parsed.issueDate,
    freight_terms: parsed.freightTerms,
    container_size: parsed.containerSize,
    total_quantity_before: order.total_pcs ?? null,
    total_quantity_after: totalQuantityAfter,
    total_amount: parsed.totalAmount,
    currency: parsed.currency,
    line_updates: lineUpdates,
    summary: {
      parsed_lines: parsed.items?.length || 0,
      matched_lines: matchedUpdates.length,
      unmatched_lines: lineUpdates.filter((update) => !update.will_update).length,
      quantity_filled: matchedUpdates.filter((update) => update.quantity_before == null && update.quantity_after != null).length,
      buy_prices_filled: matchedUpdates.filter((update) => update.buy_price_before == null && update.buy_price_after != null).length,
    },
  };
}

async function parseDocumentForPreview({ buffer, contentType, fileName, documentType, order, lines }) {
  const isPdf = /pdf/i.test(contentType || '') || /\.pdf$/i.test(fileName || '');
  const isSupplierDocument = ['supplier_proforma', 'supplier_invoice'].includes(documentType);
  if (!isPdf || !isSupplierDocument) {
    return {
      extractionStatus: 'not_parsed',
      extractedJson: {},
      proposal: null,
    };
  }

  const { parsed, text } = await parseSupplierProformaPdf(buffer);
  if (!parsed?.items?.length) {
    return {
      extractionStatus: 'failed',
      extractedJson: {
        parser: parsed?.parser || 'abc_pdf_proforma_v1',
        reason: 'no_line_items_found',
        textPreview: text.slice(0, 2000),
      },
      proposal: null,
    };
  }

  const proposal = buildProformaProposal({ order, lines, parsed });
  return {
    extractionStatus: 'parsed',
    extractedJson: {
      ...parsed,
      rawTextPreview: text.slice(0, 4000),
    },
    proposal,
  };
}

async function upsertForwarderCostFromDocument(supabase, document) {
  if (document.document_type !== 'forwarder_invoice') return;
  const amount = Number(String(document.amount ?? '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return;
  const currency = normalizeCurrency(document.currency || 'CZK');
  const amountCzk = amountToCzk(amount, currency);
  const { error } = await supabase
    .from('import_order_costs')
    .upsert({
      cost_key: `document:${document.id}:forwarder`,
      order_id: document.order_id,
      document_id: document.id,
      cost_type: 'forwarder',
      amount,
      currency,
      amount_czk: amountCzk,
      allocation_method: 'by_product_value',
      notes: 'Created from uploaded KN/forwarder invoice metadata.',
      raw_json: {
        source: 'api/import-documents',
        document_id: document.id,
        amount_czk_coverage: amountCzk == null ? 'missing_fx_rate' : 'converted',
      },
    }, { onConflict: 'cost_key' });
  if (error) throw new Error(`Forwarder cost upsert failed: ${error.message}`);
}

async function applyProformaProposal({ supabase, order, lines, proposal, extractedJson }) {
  if (!proposal?.line_updates?.length) return { updatedLines: 0, updatedOrder: false };

  const linesById = new Map(lines.map((line) => [line.id, line]));
  let updatedLines = 0;
  for (const update of proposal.line_updates) {
    if (!update.will_update || !update.matched_line_id) continue;
    const currentLine = linesById.get(update.matched_line_id) || {};
    const rawRow = {
      ...(currentLine.raw_row || {}),
      proforma: {
        invoice_no: proposal.invoice_no,
        supplier_order_code: proposal.supplier_order_code,
        item_no: update.item_no,
        position: update.position,
        quantity: update.quantity_after,
        unit_purchase_price: update.buy_price_after,
        currency: update.currency_after,
        extended_price: update.extended_price,
      },
    };
    const { error } = await supabase
      .from('import_order_lines')
      .update({
        quantity: update.quantity_after,
        unit_purchase_price: update.buy_price_after,
        purchase_currency: update.currency_after,
        audit_status: currentLine.product_master_id ? 'matched' : 'review',
        raw_row: rawRow,
        updated_at: new Date().toISOString(),
      })
      .eq('id', update.matched_line_id);
    if (error) throw new Error(`Line update failed: ${error.message}`);
    updatedLines += 1;
  }

  const auditSummary = {
    ...(order.audit_summary || {}),
    supplier_order_code: proposal.supplier_order_code || null,
    proforma_invoice_no: proposal.invoice_no || null,
    proforma_total_amount: proposal.total_amount || null,
    proforma_currency: proposal.currency || null,
    proforma_last_applied_at: new Date().toISOString(),
    proforma_parser: extractedJson?.parser || null,
    proforma_summary: proposal.summary,
  };

  const orderPatch = {
    total_pcs: proposal.total_quantity_after,
    supplier_order_code: proposal.supplier_order_code || null,
    audit_status: proposal.summary?.unmatched_lines ? 'needs_review' : 'data_missing',
    audit_summary: auditSummary,
    updated_at: new Date().toISOString(),
  };
  if (proposal.issue_date && !order.ordered_date) orderPatch.ordered_date = proposal.issue_date;
  if (order.status === 'navrh') orderPatch.status = 'objednano';

  const { error: orderError } = await supabase
    .from('import_orders')
    .update(orderPatch)
    .eq('id', order.id);
  if (orderError) throw new Error(`Order update failed: ${orderError.message}`);

  return { updatedLines, updatedOrder: true };
}

async function uploadDocument({ supabase, user, body, applyParsed = false }) {
  const orderId = String(body.orderId || '').trim();
  const originalFileName = String(body.fileName || 'document');
  const fileName = safeFileName(originalFileName);
  const base64 = String(body.base64 || '').trim();
  const contentType = normalizedContentType(originalFileName, body.contentType);
  const requestedDocumentType = String(body.documentType || '').trim();
  const documentType = DOCUMENT_TYPES.has(requestedDocumentType)
    ? requestedDocumentType
    : inferDocumentType(originalFileName);

  if (!orderId) throw new Error('Chybí orderId.');
  if (!base64) throw new Error('Chybí obsah souboru.');
  const order = await getOrder(supabase, orderId);

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('Soubor je prázdný.');

  const lines = await listOrderLines(supabase, order.id);
  const parsedDocument = await parseDocumentForPreview({
    buffer,
    contentType,
    fileName,
    documentType,
    order,
    lines,
  });

  if (body.action === 'preview') {
    return {
      previewOnly: true,
      proposal: parsedDocument.proposal,
      extractionStatus: parsedDocument.extractionStatus,
      extractedJson: parsedDocument.extractedJson,
    };
  }

  const filePath = `${safeStorageSegment(order.order_code)}/${Date.now()}-${randomUUID()}-${fileName}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, {
      contentType,
      upsert: false,
    });
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const documentRow = {
    document_key: filePath,
    order_id: order.id,
    uploaded_by: user.id,
    storage_bucket: BUCKET,
    file_path: filePath,
    file_name: fileName,
    content_type: contentType,
    document_type: documentType,
    amount: body.amount || null,
    currency: body.currency ? String(body.currency).toUpperCase() : null,
    document_date: body.documentDate || null,
    notes: body.notes || null,
    extraction_status: parsedDocument.extractionStatus,
    extracted_json: parsedDocument.extractedJson,
    raw_metadata: {
      size: buffer.length,
      originalFileName,
      storageOrderSegment: safeStorageSegment(order.order_code),
    },
  };

  const { data, error } = await supabase
    .from('import_order_documents')
    .upsert(documentRow, { onConflict: 'document_key' })
    .select('*')
    .single();
  if (error) throw new Error(`Document metadata failed: ${error.message}`);
  await upsertForwarderCostFromDocument(supabase, data);
  let applied = null;
  if (applyParsed && parsedDocument.proposal) {
    applied = await applyProformaProposal({
      supabase,
      order,
      lines,
      proposal: parsedDocument.proposal,
      extractedJson: parsedDocument.extractedJson,
    });
  }
  return {
    document: data,
    proposal: parsedDocument.proposal,
    applied,
    extractionStatus: parsedDocument.extractionStatus,
  };
}

async function handle(req, res) {
  withCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Na serveru chybí SUPABASE_SERVICE_ROLE_KEY.' });

  const auth = await authenticate(req);
  if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    if (req.method === 'GET') {
      const documentId = String(req.query.documentId || '').trim();
      if (documentId) {
        const document = await getDocument(supabase, documentId);
        await getOrder(supabase, document.order_id);
        const signedUrl = await signedDocumentUrl(supabase, document);
        return res.status(200).json({ document, signedUrl });
      }
      const orderId = String(req.query.orderId || '').trim();
      if (!orderId) return res.status(400).json({ error: 'Chybí orderId.' });
      await getOrder(supabase, orderId);
      const documents = await listDocuments(supabase, orderId);
      const documentsWithUrls = await Promise.all(documents.map(async (document) => ({
        ...document,
        signed_url: await signedDocumentUrl(supabase, document).catch(() => null),
      })));
      return res.status(200).json({ documents: documentsWithUrls });
    }

    if (!auth.access.canUploadImportDocuments) {
      return res.status(403).json({ error: 'Upload dokumentů není pro tento účet povolený.' });
    }

    const body = await readJsonBody(req);
    const result = await uploadDocument({
      supabase,
      user: auth.user,
      body,
      applyParsed: body.action === 'apply',
    });
    if (result.previewOnly) return res.status(200).json(result);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Document operation failed.' });
  }
}

export default handle;
