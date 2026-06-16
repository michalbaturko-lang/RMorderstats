import { normalizeText, toNumber } from './importLogisticsCore.js';

const MONTHS = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

const cleanText = (value) => normalizeText(value)
  .replace(/\t+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const parseMoney = (value) => {
  const parsed = toNumber(String(value || '').replace(/,/g, ''));
  return parsed == null ? null : parsed;
};

const parseEnglishDate = (value) => {
  const text = cleanText(value).replace(/(\d+)(st|nd|rd|th)/i, '$1');
  const match = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s+(\d{4})\b/i);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  return `${match[3]}-${month}-${String(match[2]).padStart(2, '0')}`;
};

function installPdfTextPolyfills() {
  if (!globalThis.DOMMatrix) {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor() {
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.e = 0;
        this.f = 0;
      }

      multiply() { return this; }
      translate() { return this; }
      scale() { return this; }
      rotate() { return this; }
      inverse() { return this; }
      transformPoint(point = {}) { return point; }
    };
  }
  if (!globalThis.ImageData) {
    globalThis.ImageData = class ImageData {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    };
  }
  if (!globalThis.Path2D) {
    globalThis.Path2D = class Path2D {};
  }
}

export async function extractPdfText(buffer) {
  installPdfTextPolyfills();
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result?.text || '';
  } finally {
    await parser.destroy();
  }
}

export function parseSupplierProformaText(text) {
  const normalized = String(text || '').replace(/\r/g, '');
  const lines = normalized
    .split('\n')
    .map(cleanText)
    .filter(Boolean);

  const invoiceNo = cleanText(normalized.match(/INVOICE\s+NO\.?:\s*([A-Z0-9-]+)/i)?.[1] || '');
  const supplierOrderCode = invoiceNo.replace(/^[A-Z]+-/, '') || null;
  const issueDate = parseEnglishDate(normalized.match(/Issue\s+Date:\s*([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s+\d{4})/i)?.[1] || '');
  const freightTerms = cleanText(normalized.match(/Freight:\s*([^\n]+)/i)?.[1] || '');
  const contactBy = cleanText(normalized.match(/Contact\s+By:\s*([^\n]+)/i)?.[1] || '');
  const containerSize = cleanText(normalized.match(/Container\s+Size:\s*([^\n]+)/i)?.[1] || '');
  const totalMatch = normalized.match(/TOTAL\s+(\d+(?:[.,]\d+)?)\s+PCS\s+US\$([\d,]+(?:\.\d+)?)/i);
  const deliveryTime = cleanText(normalized.match(/Delivery\s+Time:\s*([\s\S]*?)Payment\s+terms:/i)?.[1] || '');
  const paymentTerms = cleanText(normalized.match(/Payment\s+terms:\s*([\s\S]*?)Bank\s+Information:/i)?.[1] || '');

  const items = [];
  let current = null;

  for (const line of lines) {
    const itemMatch = line.match(/^(\d{1,3})\s+(\d{3,4}x\d{3,4}x\d{3,4}-\d+-[A-Z]+)\b/i);
    if (itemMatch) {
      if (current && current.quantity != null) items.push(current);
      current = {
        position: Number(itemMatch[1]),
        itemNo: itemMatch[2],
        finish: null,
        quantity: null,
        unitPurchasePrice: null,
        purchaseCurrency: 'USD',
        extendedPrice: null,
      };
      continue;
    }

    if (!current) continue;

    const finishMatch = line.match(/Surface\s+finish:\s*(.+)$/i);
    if (finishMatch) {
      current.finish = cleanText(finishMatch[1]).replace(/^Glavanized$/i, 'Galvanized');
      continue;
    }

    const priceMatch = line.match(/^(\d+(?:[.,]\d+)?)\s+\$?([\d,]+(?:\.\d+)?)\s+US\$?([\d,]+(?:\.\d+)?)$/i);
    if (priceMatch) {
      current.quantity = toNumber(priceMatch[1]);
      current.unitPurchasePrice = parseMoney(priceMatch[2]);
      current.extendedPrice = parseMoney(priceMatch[3]);
    }
  }

  if (current && current.quantity != null) items.push(current);

  return {
    documentKind: 'supplier_proforma',
    invoiceNo: invoiceNo || null,
    supplierOrderCode,
    issueDate,
    freightTerms: freightTerms || null,
    contactBy: contactBy || null,
    containerSize: containerSize || null,
    totalQuantity: totalMatch ? toNumber(totalMatch[1]) : null,
    totalAmount: totalMatch ? parseMoney(totalMatch[2]) : null,
    currency: totalMatch ? 'USD' : null,
    deliveryTime: deliveryTime || null,
    paymentTerms: paymentTerms || null,
    items,
    parser: 'abc_pdf_proforma_v1',
  };
}

export async function parseSupplierProformaPdf(buffer) {
  const text = await extractPdfText(buffer);
  return {
    text,
    parsed: parseSupplierProformaText(text),
  };
}
