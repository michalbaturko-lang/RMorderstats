import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readSheet } from 'read-excel-file/node';
import {
  CURRENT_IMPORT_ORDER_CONFIG,
  IMPORT_KN_TRACKING_SHIPMENTS,
  auditImportOrders,
  enrichImportOrdersWithMatches,
  normalizeCode,
  normalizeEan,
  normalizeOrderCode,
  normalizeText,
  parseDimensions,
  supplierForCode,
  toNumber,
  validateExpectedAudit,
} from '../../src/importLogisticsCore.js';
import { parseSupplierProformaPdf } from '../../src/importLogisticsProforma.js';

const IMPORT_OVERVIEW_SHEET = 'Přehled';
const DEFAULT_LEAGLE_PROFORMA_PRICE_FILES = {
  'Čína 9': '/Users/mbo/Library/Mobile Documents/com~apple~CloudDocs/Downloads/PI--26ML0121E035_FILLED_RM.xlsx',
  'Čína 10': '/Users/mbo/Library/Mobile Documents/com~apple~CloudDocs/Downloads/PI--26ML0210E093_FILLED_RM.xlsx',
  'Čína 11': '/Users/mbo/Downloads/PI--26ML0320E160 2.xlsx',
  'Čína 12': '/Users/mbo/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_90d0kh8rvfhs12_83eb/msg/file/2026-05/PI--light version butterfly-26ML0429E246.xls',
};
const LEAGLE_224E_SOURCE_WORKBOOK = 'CI PL-26ML224E.xls';
const LEAGLE_224E_SOURCE_PATH = '/Users/mbo/CI PL-26ML224E.xls';
const LEAGLE_224E_TELEX_RELEASE_PATH = '/Users/mbo/Telex Cargo Release Order--26ML224E.pdf';
const execFileAsync = promisify(execFile);
const LEAGLE_224E_CI_LINES = [
  { sourceRow: 15, model: 2, productCategory: 'Full metal shelf with bolts (low cost)', sizeCm: [150, 70, 30], steelThicknessMm: 0.5, boardThicknessMm: 0.4, shelfCount: 4, capacity: '60KG', finish: 'White', board: 'White', unitPurchasePrice: 7.65, quantity: 100, amount: 765, unitGrossWeightKg: 6, totalWeightKg: 600, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 16, model: 4, productCategory: 'Full metal shelf with bolts (low cost)', sizeCm: [160, 80, 40], steelThicknessMm: 0.5, boardThicknessMm: 0.4, shelfCount: 4, capacity: '60KG', finish: 'White', board: 'White', unitPurchasePrice: 9.2, quantity: 100, amount: 920, unitGrossWeightKg: 7.5, totalWeightKg: 750, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 17, model: 8, productCategory: 'Full metal RIVET shelf (inlay)', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 5, capacity: '175KG', finish: 'White', board: 'white laminated', unitPurchasePrice: 14.95, quantity: 100, amount: 1495, unitGrossWeightKg: 13, totalWeightKg: 1300, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 18, model: 13, productCategory: 'Double layer RIVET shelf (inlay)', sizeCm: [150, 70, 30], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 4, capacity: '175KG', finish: 'White', board: 'white laminated', unitPurchasePrice: 12.25, quantity: 100, amount: 1225, unitGrossWeightKg: 9.8, totalWeightKg: null, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 19, model: 20, productCategory: 'Single RIVET shelf (inlay) - color 1', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 5, capacity: '175KG', finish: 'Hammer painting', board: 'MDF', unitPurchasePrice: 12.4, quantity: 100, amount: 1240, unitGrossWeightKg: 13, totalWeightKg: 1300, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 20, model: 21, productCategory: 'Single RIVET shelf (inlay) - color 2', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 5, capacity: '175KG', finish: 'Hammer painting', board: 'MDF', unitPurchasePrice: 12.4, quantity: 100, amount: 1240, unitGrossWeightKg: 13, totalWeightKg: 1300, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 21, model: 22, productCategory: 'Single RIVET shelf (inlay) - color 3', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 5, capacity: '175KG', finish: 'Hammer painting', board: 'MDF', unitPurchasePrice: 12.4, quantity: 100, amount: 1240, unitGrossWeightKg: 13, totalWeightKg: 1300, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 22, model: 6, productCategory: 'Full metal RIVET shelf (inlay)', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 5, capacity: '175KG', finish: 'Black', board: 'MDF', unitPurchasePrice: 12.4, quantity: 548, amount: 6795.2, unitGrossWeightKg: 13, totalWeightKg: 7124, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 23, model: 7, productCategory: 'Full metal RIVET shelf (inlay)', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 5, capacity: '175KG', finish: 'Black', board: 'black laminated', unitPurchasePrice: 14.95, quantity: 100, amount: 1495, unitGrossWeightKg: 13, totalWeightKg: 1300, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 24, model: 10, productCategory: 'Full metal RIVET shelf (inlay)', sizeCm: [150, 70, 30], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 4, capacity: '175KG', finish: 'Black', board: 'black laminated', unitPurchasePrice: 11.45, quantity: 100, amount: 1145, unitGrossWeightKg: 7.8, totalWeightKg: 780, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 25, model: 12, productCategory: 'Double layer RIVET shelf (inlay)', sizeCm: [150, 70, 30], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 4, capacity: '175KG', finish: 'Black', board: 'black laminated', unitPurchasePrice: 12.25, quantity: 100, amount: 1225, unitGrossWeightKg: 9.8, totalWeightKg: 980, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 26, model: 3, productCategory: 'Full metal shelf with bolts (low cost)', sizeCm: [160, 80, 40], steelThicknessMm: 0.5, boardThicknessMm: 0.4, shelfCount: 4, capacity: '60KG', finish: 'Zinc', board: 'zinc', unitPurchasePrice: 7.38, quantity: 100, amount: 738, unitGrossWeightKg: 7.3, totalWeightKg: 730, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 27, model: 5, productCategory: 'Full metal RIVET shelf (inlay)', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 5, capacity: '175KG', finish: 'Zinc', board: 'MDF', unitPurchasePrice: 10.4, quantity: 648, amount: 6739.2, unitGrossWeightKg: 12.8, totalWeightKg: 8294.4, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 28, model: 9, productCategory: 'Full metal RIVET shelf (inlay)', sizeCm: [150, 70, 30], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 4, capacity: '175KG', finish: 'Zinc', board: 'MDF', unitPurchasePrice: 8.45, quantity: 100, amount: 845, unitGrossWeightKg: 7.6, totalWeightKg: 760, container: 'MSCU5459597/FX47269017' },
  { sourceRow: 30, model: 11, productCategory: 'Full metal RIVET shelf (inlay)', sizeCm: [150, 70, 30], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 4, capacity: '175KG', finish: 'White', board: 'white laminated', unitPurchasePrice: 11.45, quantity: 100, amount: 1145, unitGrossWeightKg: 7.8, totalWeightKg: 780, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 31, model: 15, productCategory: 'Double layer RIVET shelf (inlay)', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 5, capacity: '175KG', finish: 'White', board: 'white laminated', unitPurchasePrice: 16.25, quantity: 100, amount: 1625, unitGrossWeightKg: 14.5, totalWeightKg: 1450, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 32, model: 24, productCategory: 'Full metal RIVET shelf (inlay)', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 0.4, shelfCount: 5, capacity: '175KG', finish: 'WHITE', board: 'metal', unitPurchasePrice: 26.4, quantity: 100, amount: 2640, unitGrossWeightKg: 15.6, totalWeightKg: 1560, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 33, model: 29, productCategory: 'Double layer RIVET shelf -full metal', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 0.4, shelfCount: 5, capacity: '175KG', finish: 'WHITE', board: 'metal', unitPurchasePrice: 29.25, quantity: 100, amount: 2925, unitGrossWeightKg: 18.6, totalWeightKg: 1860, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 34, model: 25, productCategory: 'Double layer RIVET shelf (inlay) - color 1', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 5, capacity: '175KG', finish: 'Hammer painting', board: 'MDF', unitPurchasePrice: 15.95, quantity: 100, amount: 1595, unitGrossWeightKg: 14.5, totalWeightKg: 1450, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 35, model: 26, productCategory: 'Double layer RIVET shelf (inlay) - color 2', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 5, capacity: '175KG', finish: 'Hammer painting', board: 'MDF', unitPurchasePrice: 15.95, quantity: 100, amount: 1595, unitGrossWeightKg: 14.5, totalWeightKg: 1450, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 36, model: 27, productCategory: 'Double layer RIVET shelf (inlay) - color 3', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 5, capacity: '175KG', finish: 'Hammer painting', board: 'MDF', unitPurchasePrice: 15.95, quantity: 100, amount: 1595, unitGrossWeightKg: 14.5, totalWeightKg: 1450, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 37, model: 14, productCategory: 'Double layer RIVET shelf (inlay)', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 5, capacity: '175KG', finish: 'Black', board: 'black laminated', unitPurchasePrice: 16.25, quantity: 100, amount: 1625, unitGrossWeightKg: 14.5, totalWeightKg: 1450, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 38, model: 16, productCategory: 'Double layer RIVET shelf (inlay)', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 5, capacity: '175KG', finish: 'Black', board: 'wooden', unitPurchasePrice: 16.25, quantity: 100, amount: 1625, unitGrossWeightKg: 14.5, totalWeightKg: 1450, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 39, model: 17, productCategory: 'Double layer RIVET shelf (inlay)', sizeCm: [150, 70, 30], steelThicknessMm: 0.55, boardThicknessMm: 4, shelfCount: 4, capacity: '175KG', finish: 'Black', board: 'wooden', unitPurchasePrice: 12.25, quantity: 100, amount: 1225, unitGrossWeightKg: 9.8, totalWeightKg: 980, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 40, model: 18, productCategory: 'Heavy duty RIVET shelf', sizeCm: [216, 180, 50], steelThicknessMm: 0.9, boardThicknessMm: 6.2, shelfCount: 5, capacity: '400KG', finish: 'Black', board: 'MDF', unitPurchasePrice: 36.25, quantity: 100, amount: 3625, unitGrossWeightKg: 40, totalWeightKg: 4000, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 41, model: 23, productCategory: 'Full metal RIVET shelf (inlay)', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 0.4, shelfCount: 5, capacity: '175KG', finish: 'BLACK', board: 'metal', unitPurchasePrice: 26.4, quantity: 100, amount: 2640, unitGrossWeightKg: 15.6, totalWeightKg: 1560, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 42, model: 28, productCategory: 'Double layer RIVET shelf -full metal', sizeCm: [180, 90, 40], steelThicknessMm: 0.55, boardThicknessMm: 0.4, shelfCount: 5, capacity: '175KG', finish: 'BLACK', board: 'metal', unitPurchasePrice: 29.25, quantity: 100, amount: 2925, unitGrossWeightKg: 18.6, totalWeightKg: 1860, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 43, model: 1, productCategory: 'Full metal shelf with bolts (low cost)', sizeCm: [150, 70, 30], steelThicknessMm: 0.5, boardThicknessMm: 0.4, shelfCount: 4, capacity: '60KG', finish: 'Zinc', board: 'zinc', unitPurchasePrice: 5.95, quantity: 100, amount: 595, unitGrossWeightKg: 5.8, totalWeightKg: 580, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 44, model: 19, productCategory: 'Heavy duty RIVET shelf', sizeCm: [180, 180, 50], steelThicknessMm: 0.9, boardThicknessMm: 6.2, shelfCount: 5, capacity: '400KG', finish: 'Zync', board: 'MDF', unitPurchasePrice: 33.15, quantity: 100, amount: 3315, unitGrossWeightKg: 39.2, totalWeightKg: 3920, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 45, model: 'KTW-1642', productCategory: 'Fully Automatic packing machines', unitPurchasePrice: 250.24, quantity: 3, amount: 750.72, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 46, model: 'A5', productCategory: 'Fully Automatic packing machines', unitPurchasePrice: 1838.24, quantity: 1, amount: 1838.24, container: 'FFAU2929604/FX46181725' },
  { sourceRow: 47, model: 'MH-101A', productCategory: 'Fully Automatic packing machines', unitPurchasePrice: 400, quantity: 3, amount: 1200, container: 'FFAU2929604/FX46181725' },
];
const CHINA16_INLAY_QUOTATION_LINES = [
  { sourceRow: 1, layer: 4, heightMm: 1800, widthMm: 1200, depthMm: 400, capacity: '400KG', steelThicknessMm: 1, chipBoardMm: 9, middleSupport: 2, cartonSize: '122*41*7.4', grossWeightKg: 26.7, netWeightKg: 26, containerLoadingQty: 1067, unitPurchasePrice: 22.95, quantity: 350 },
  { sourceRow: 2, layer: 4, heightMm: 1800, widthMm: 900, depthMm: 400, capacity: '400KG', steelThicknessMm: 1, chipBoardMm: 9, middleSupport: 1, cartonSize: '93*41*7.4', grossWeightKg: 21.5, netWeightKg: 21, containerLoadingQty: 1325, unitPurchasePrice: 19.15, quantity: 350 },
  { sourceRow: 3, layer: 4, heightMm: 2000, widthMm: 1200, depthMm: 500, capacity: '400KG', steelThicknessMm: 1, chipBoardMm: 9, middleSupport: 2, cartonSize: '122*51*7.4', grossWeightKg: 31, netWeightKg: 30.2, containerLoadingQty: 919, unitPurchasePrice: 25.75, quantity: 360 },
  { sourceRow: 4, layer: 4, heightMm: 2000, widthMm: 900, depthMm: 500, capacity: '400KG', steelThicknessMm: 1, chipBoardMm: 9, middleSupport: 2, cartonSize: '102*51*7.4', grossWeightKg: 24.2, netWeightKg: 23.7, containerLoadingQty: 1177, unitPurchasePrice: 22.15, quantity: 400 },
  { sourceRow: 5, layer: 5, heightMm: 2160, widthMm: 1400, depthMm: 500, capacity: '400KG', steelThicknessMm: 1, chipBoardMm: 9, middleSupport: 2, cartonSize: '142*51*8.3', grossWeightKg: 43.8, netWeightKg: 42.8, containerLoadingQty: 650, unitPurchasePrice: 34.13, quantity: 200 },
  { sourceRow: 6, layer: 5, heightMm: 2160, widthMm: 1400, depthMm: 700, capacity: '400KG', steelThicknessMm: 1, chipBoardMm: 9, middleSupport: 2, cartonSize: '142*71*9.5', grossWeightKg: 53.2, netWeightKg: 52, containerLoadingQty: 535, unitPurchasePrice: 40.15, quantity: 200 },
];
const LEAGLE_0611E370_PI_LINES = [
  { sourceRow: 1, spec: '1800x900x400', layer: 5, steelThicknessMm: 0.55, mdfThicknessMm: 4, grossNetWeight: '11.8/12.4', cartonSize: '91.5x40.5x5.8', containerLoadingQty: 2142, finish: 'Galvanised', quantity: 2142, unitPurchasePrice: 7.5, amount: 16065 },
  { sourceRow: 2, spec: '1800x900x400', layer: 5, steelThicknessMm: 0.55, mdfThicknessMm: 4, grossNetWeight: '12.05/12.65', cartonSize: '91.5x40.5x5.8', containerLoadingQty: 2142, finish: 'Black Painting', quantity: 2142, unitPurchasePrice: 8.8, amount: 18849.6 },
];

const cell = (row, index) => row?.[index] ?? null;

const dateToIso = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 20000 && value < 80000) {
      return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
    }
    return null;
  }
  const text = normalizeText(value);
  const czechDate = text.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
  if (czechDate) {
    return `${czechDate[3]}-${String(czechDate[2]).padStart(2, '0')}-${String(czechDate[1]).padStart(2, '0')}`;
  }
  const englishMonthDate = text.match(/^([A-Z]{3,9})\.?\s*(\d{1,2}),?\s*(\d{4})$/i);
  if (englishMonthDate) {
    const monthMap = {
      JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
      JUL: '07', AUG: '08', SEP: '09', SEPT: '09', OCT: '10', NOV: '11', DEC: '12',
    };
    const month = monthMap[englishMonthDate[1].slice(0, 4).toUpperCase()] || monthMap[englishMonthDate[1].slice(0, 3).toUpperCase()];
    if (month) return `${englishMonthDate[3]}-${month}-${String(englishMonthDate[2]).padStart(2, '0')}`;
  }
  if (/^\d+(\.\d+)?$/.test(text)) return dateToIso(Number(text));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const rawRowFromHeaders = (headers = [], row = []) => {
  const raw = {};
  headers.forEach((header, index) => {
    const key = normalizeText(header) || `col_${index + 1}`;
    raw[key] = row[index] ?? null;
  });
  return raw;
};

const parsePrice = (value) => {
  const text = normalizeText(value);
  const price = toNumber(value);
  if (price == null) return { unitPurchasePrice: null, currency: null };
  if (/US\$|\bUSD\b/i.test(text)) return { unitPurchasePrice: price, currency: 'USD' };
  if (/€|\bEUR\b/i.test(text)) return { unitPurchasePrice: price, currency: 'EUR' };
  if (/Kč|\bCZK\b/i.test(text)) return { unitPurchasePrice: price, currency: 'CZK' };
  return { unitPurchasePrice: price, currency: null };
};

const parseProformaCode = (rows = []) => {
  for (const row of rows.slice(0, 12)) {
    for (let index = 0; index < row.length; index += 1) {
      const value = normalizeText(row[index]);
      if (/^P\/I\s*No\.?:?$/i.test(value) || /^P\/I\s*No\.?:/i.test(value)) {
        const inline = value.match(/P\/I\s*No\.?:\s*(.+)$/i)?.[1];
        return normalizeText(inline || row[index + 1]);
      }
    }
  }
  return '';
};

const parseProformaIssueDate = (rows = []) => {
  for (const row of rows.slice(0, 12)) {
    for (let index = 0; index < row.length; index += 1) {
      const value = normalizeText(row[index]);
      if (/^DATE:?$/i.test(value) || /^DATE:/i.test(value)) {
        const inline = value.match(/DATE:\s*(.+)$/i)?.[1];
        return dateToIso(inline || row[index + 1]);
      }
    }
  }
  return null;
};

const convertLegacyXlsToXlsx = async (filePath) => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-logistics-xls-'));
  const candidates = ['/opt/homebrew/bin/soffice', 'soffice'];
  let lastError = null;
  for (const soffice of candidates) {
    try {
      await execFileAsync(soffice, ['--headless', '--convert-to', 'xlsx', '--outdir', outputDir, filePath], {
        timeout: 30000,
      });
      const converted = path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}.xlsx`);
      await fs.access(converted);
      return converted;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Could not convert ${filePath}`);
};

const readSheetWithLegacyFallback = async (filePath, sheetName) => {
  try {
    return await readSheet(filePath, sheetName);
  } catch (error) {
    if (!/\.xls$/i.test(filePath) || /\.xlsx$/i.test(filePath)) throw error;
    const convertedPath = await convertLegacyXlsToXlsx(filePath);
    return readSheet(convertedPath, sheetName);
  }
};

const headerIndexFor = (headers = [], patterns = []) => headers.findIndex((header) => {
  const normalized = normalizeText(header);
  return patterns.some((pattern) => pattern.test(normalized));
});

const findProformaHeaderRow = (rows = []) => rows.findIndex((row) => {
  const headerText = row.map(normalizeText).join(' | ');
  return /order\s*qty/i.test(headerText) && /(unit\s*price|fob\s*unit\s*price)/i.test(headerText);
});

const readSupplementalProformaPrices = async (orderCode, filePath) => {
  if (!filePath) return [];
  let rows;
  try {
    rows = await readSheetWithLegacyFallback(filePath, 'Sheet1');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const supplierOrderCode = parseProformaCode(rows);
  const issueDate = parseProformaIssueDate(rows);
  const headerRowIndex = findProformaHeaderRow(rows);
  const headers = headerRowIndex >= 0 ? rows[headerRowIndex] : [];
  const specIndex = headerIndexFor(headers, [/^spec/i]);
  const finishIndex = headerIndexFor(headers, [/finish/i, /color/i]);
  const quantityIndex = headerIndexFor(headers, [/order\s*qty/i]);
  const unitPriceIndex = headerIndexFor(headers, [/unit\s*price/i, /fob\s*unit\s*price/i]);
  const amountIndex = headerIndexFor(headers, [/^amount$/i]);
  const hasStructuredHeaders = [specIndex, finishIndex, quantityIndex, unitPriceIndex].every((index) => index >= 0);
  const dataRows = headerRowIndex >= 0
    ? rows.slice(headerRowIndex + 1).map((row, index) => ({ row, sourceRow: headerRowIndex + index + 2 }))
    : rows.map((row, index) => ({ row, sourceRow: index + 1 }));

  return dataRows
    .map(({ row, sourceRow }) => ({
      sourceRow,
      spec: normalizeText(cell(row, hasStructuredHeaders ? specIndex : 1)),
      finish: normalizeText(cell(row, hasStructuredHeaders ? finishIndex : 8)),
      quantity: toNumber(cell(row, hasStructuredHeaders ? quantityIndex : 9)),
      unitPurchasePrice: toNumber(cell(row, hasStructuredHeaders ? unitPriceIndex : 10)),
      amount: toNumber(cell(row, hasStructuredHeaders ? amountIndex : 11)),
      supplierOrderCode,
      issueDate,
      sourceFile: path.basename(filePath),
    }))
    .filter((row) => row.spec && row.finish && row.quantity != null && row.unitPurchasePrice != null);
};

const hasAnyValue = (row = []) => row.some((value) => value !== null && value !== undefined && normalizeText(value) !== '');

const statusFromOverview = (overviewRows) => {
  const rows = overviewRows || [];
  if (rows.some((row) => row.etaBrno && new Date(row.etaBrno) <= new Date())) return 'v_pristavu';
  if (rows.some((row) => row.shippedDate)) return 'shipped';
  if (rows.some((row) => row.orderedDate)) return 'objednano';
  return 'navrh';
};

export async function readImportOverview(importWorkbookPath) {
  const rows = await readSheet(importWorkbookPath, IMPORT_OVERVIEW_SHEET);
  const overview = new Map();

  rows.slice(1).forEach((row, rowIndex) => {
    if (!hasAnyValue(row)) return;
    const orderCode = normalizeOrderCode(cell(row, 1));
    if (!orderCode) return;
    const currentConfig = CURRENT_IMPORT_ORDER_CONFIG.find((config) => config.orderCode === orderCode);
    if (!currentConfig) return;

    const supplierCode = toNumber(cell(row, 9)) ?? currentConfig.supplierCode;
    const item = {
      sourceRow: rowIndex + 2,
      orderCode,
      sourceSheet: currentConfig.sourceSheet,
      sequenceNumber: toNumber(cell(row, 0)),
      overviewTotalPcs: toNumber(cell(row, 2)),
      containersText: normalizeText(cell(row, 3)),
      forwarderShipmentNo: normalizeText(cell(row, 4)),
      orderedDate: dateToIso(cell(row, 5)),
      shippedDate: dateToIso(cell(row, 6)),
      etaBrno: dateToIso(cell(row, 7)),
      goodsDescription: normalizeText(cell(row, 8)),
      supplierCode,
      supplierName: supplierForCode(supplierCode).name,
      shelfDescription: normalizeText(cell(row, 10)),
      trackingUrl: normalizeText(cell(row, 11)),
      rawRow: rawRowFromHeaders(rows[0], row),
    };

    if (!overview.has(orderCode)) overview.set(orderCode, []);
    overview.get(orderCode).push(item);
  });

  return overview;
}

const lineBase = ({ importWorkbookPath, orderCode, sourceSheet, sourceRow, row, headers, supplierCode }) => ({
  orderCode,
  sourceWorkbook: path.basename(importWorkbookPath),
  sourceSheet,
  sourceRow,
  supplierCode,
  lineKey: `${orderCode}:${sourceSheet}:${sourceRow}`,
  rawRow: rawRowFromHeaders(headers, row),
});

const parseStandardSpecLine = ({ importWorkbookPath, orderCode, sourceSheet, sourceRow, row, headers, supplierCode, hasExactCodes }) => {
  const price = hasExactCodes && sourceSheet === 'Čína 12' ? parsePrice(cell(row, 13)) : { unitPurchasePrice: null, currency: null };
  return {
    ...lineBase({ importWorkbookPath, orderCode, sourceSheet, sourceRow, row, headers, supplierCode }),
    spec: normalizeText(cell(row, 0)),
    dimensions: parseDimensions(cell(row, 0)),
    shelfCount: toNumber(cell(row, 1)),
    steelThicknessMm: toNumber(cell(row, 2)),
    mdfThicknessMm: toNumber(cell(row, 3)),
    grossNetWeight: normalizeText(cell(row, 4)),
    cartonSize: normalizeText(cell(row, 5)),
    containerLoadingQty: toNumber(cell(row, 6)),
    finish: normalizeText(cell(row, 7)),
    quantity: toNumber(cell(row, 8)),
    rmCode: hasExactCodes ? normalizeCode(cell(row, 9)) : '',
    ean: hasExactCodes ? normalizeEan(cell(row, 10)) : '',
    sourceStatus: hasExactCodes ? normalizeText(cell(row, 11)) : '',
    unitPurchasePrice: price.unitPurchasePrice,
    purchaseCurrency: price.currency,
  };
};

const parseChina12Line = ({ importWorkbookPath, orderCode, sourceSheet, sourceRow, row, headers, supplierCode }) => {
  const price = parsePrice(cell(row, 13));
  return {
    ...lineBase({ importWorkbookPath, orderCode, sourceSheet, sourceRow, row, headers, supplierCode }),
    spec: normalizeText(cell(row, 1)),
    dimensions: parseDimensions(cell(row, 1)),
    shelfCount: toNumber(cell(row, 2)),
    middleSupport: toNumber(cell(row, 3)),
    steelThicknessMm: toNumber(cell(row, 4)),
    mdfThicknessMm: toNumber(cell(row, 5)),
    capacity: normalizeText(cell(row, 6)),
    packing: normalizeText(cell(row, 7)),
    netWeightKg: toNumber(cell(row, 8)),
    grossWeightKg: toNumber(cell(row, 9)),
    cartonSize: normalizeText(cell(row, 10)),
    containerLoadingQty: toNumber(cell(row, 11)),
    quantity: toNumber(cell(row, 12)),
    unitPurchasePrice: price.unitPurchasePrice,
    purchaseCurrency: price.currency,
    finish: normalizeText(cell(row, 14)),
    rmCode: normalizeCode(cell(row, 15)),
    ean: normalizeEan(cell(row, 16)),
    sourceStatus: normalizeText(cell(row, 17)),
  };
};

const parseChina13Line = ({ importWorkbookPath, orderCode, sourceSheet, sourceRow, row, headers, supplierCode }) => ({
  ...lineBase({ importWorkbookPath, orderCode, sourceSheet, sourceRow, row, headers, supplierCode }),
  position: toNumber(cell(row, 0)),
  spec: normalizeText(cell(row, 1)),
  dimensions: {
    heightMm: toNumber(cell(row, 2)),
    widthMm: toNumber(cell(row, 3)),
    depthMm: toNumber(cell(row, 4)),
    isCorner: false,
    raw: normalizeText(cell(row, 1)),
  },
  shelfCount: toNumber(cell(row, 5)),
  finish: normalizeText(cell(row, 6)),
  rmCode: normalizeCode(cell(row, 7)),
  ean: normalizeEan(cell(row, 8)),
  sourceStatus: normalizeText(cell(row, 9)),
  quantity: null,
  unitPurchasePrice: null,
  purchaseCurrency: null,
});

const parseLeagle224eLine = (row, config) => {
  const isMachine = normalizeText(row.productCategory).includes('packing machines');
  const spec = isMachine
    ? `${row.productCategory} ${row.model}`
    : `${row.sizeCm?.[0]}x${row.sizeCm?.[1]}x${row.sizeCm?.[2]}`;

  return {
    ...lineBase({
      importWorkbookPath: LEAGLE_224E_SOURCE_WORKBOOK,
      orderCode: config.orderCode,
      sourceSheet: config.sourceSheet,
      sourceRow: row.sourceRow,
      row: [],
      headers: [],
      supplierCode: config.supplierCode,
    }),
    itemModel: row.model,
    spec,
    dimensions: isMachine ? null : parseDimensions(spec),
    shelfCount: row.shelfCount ?? null,
    steelThicknessMm: row.steelThicknessMm ?? null,
    mdfThicknessMm: row.boardThicknessMm ?? null,
    capacity: row.capacity || '',
    finish: row.finish || '',
    board: row.board || '',
    quantity: row.quantity,
    unitPurchasePrice: row.unitPurchasePrice,
    purchaseCurrency: 'USD',
    containerNo: row.container?.split('/')?.[0] || '',
    sealNo: row.container?.split('/')?.[1] || '',
    allowFallbackMatch: !isMachine,
    rawRow: {
      source: LEAGLE_224E_SOURCE_WORKBOOK,
      commercial_invoice_no: '26ML224E',
      supplier_order_code: '25ML1206E665',
      source_row: row.sourceRow,
      model: row.model,
      product_category: row.productCategory,
      size_cm: row.sizeCm || null,
      steel_thickness_mm: row.steelThicknessMm ?? null,
      board_thickness_mm: row.boardThicknessMm ?? null,
      shelf_count: row.shelfCount ?? null,
      capacity: row.capacity || null,
      finish: row.finish || null,
      board: row.board || null,
      unit_purchase_price: row.unitPurchasePrice,
      quantity: row.quantity,
      amount: row.amount,
      unit_gross_weight_kg: row.unitGrossWeightKg ?? null,
      total_weight_kg: row.totalWeightKg ?? null,
      container_seal: row.container || null,
    },
  };
};

const readLeagle224eLines = (config) => LEAGLE_224E_CI_LINES.map((row) => parseLeagle224eLine(row, config));

const parseLeagleInlayQuotationLine = (row, config) => {
  const spec = `${row.heightMm}x${row.widthMm}x${row.depthMm}`;
  const amount = Math.round(row.quantity * row.unitPurchasePrice * 100) / 100;

  return {
    ...lineBase({
      importWorkbookPath: config.quotationPath,
      orderCode: config.orderCode,
      sourceSheet: config.sourceSheet,
      sourceRow: row.sourceRow,
      row: [],
      headers: [],
      supplierCode: config.supplierCode,
    }),
    itemModel: 'INLAY model',
    spec,
    dimensions: parseDimensions(spec),
    shelfCount: row.layer,
    middleSupport: row.middleSupport,
    steelThicknessMm: row.steelThicknessMm,
    mdfThicknessMm: row.chipBoardMm,
    capacity: row.capacity,
    packing: 'without pallets',
    netWeightKg: row.netWeightKg,
    grossWeightKg: row.grossWeightKg,
    cartonSize: row.cartonSize,
    containerLoadingQty: row.containerLoadingQty,
    quantity: row.quantity,
    unitPurchasePrice: row.unitPurchasePrice,
    purchaseCurrency: 'USD',
    finish: 'Painting',
    allowFallbackMatch: true,
    rawRow: {
      source: path.basename(config.quotationPath),
      source_row: row.sourceRow,
      quotation_date: config.orderedDate || '2026-04-30',
      quotation_title: 'Quotation for heavy version butterfly rackshelves - INLAY model',
      model_note: 'INLAY MODEL, narrow upright 35+35mm, splitted upright',
      layer: row.layer,
      height_mm: row.heightMm,
      width_mm: row.widthMm,
      depth_mm: row.depthMm,
      capacity_per_layer: row.capacity,
      steel_thickness_mm: row.steelThicknessMm,
      chip_board_mm: row.chipBoardMm,
      middle_support_0_7mm: row.middleSupport,
      carton_size_cm: row.cartonSize,
      gross_weight_kg: row.grossWeightKg,
      net_weight_kg: row.netWeightKg,
      container_loading_qty_per_40gp: row.containerLoadingQty,
      fob_painting_price_without_pallets: row.unitPurchasePrice,
      quantity: row.quantity,
      amount,
      currency: 'USD',
    },
  };
};

const readLeagleInlayQuotationLines = (config) => (
  CHINA16_INLAY_QUOTATION_LINES.map((row) => parseLeagleInlayQuotationLine(row, config))
);

const parseLeagle0611E370PiLine = (row, config) => ({
  ...lineBase({
    importWorkbookPath: config.proformaPath,
    orderCode: config.orderCode,
    sourceSheet: config.sourceSheet,
    sourceRow: row.sourceRow,
    row: [],
    headers: [],
    supplierCode: config.supplierCode,
  }),
  itemModel: '26ML0611E370',
  spec: row.spec,
  dimensions: parseDimensions(row.spec),
  shelfCount: row.layer,
  steelThicknessMm: row.steelThicknessMm,
  mdfThicknessMm: row.mdfThicknessMm,
  grossNetWeight: row.grossNetWeight,
  cartonSize: row.cartonSize,
  containerLoadingQty: row.containerLoadingQty,
  finish: row.finish,
  quantity: row.quantity,
  unitPurchasePrice: row.unitPurchasePrice,
  purchaseCurrency: 'USD',
  allowFallbackMatch: true,
  rawRow: {
    source: path.basename(config.proformaPath),
    source_row: row.sourceRow,
    proforma_invoice_no: config.supplierOrderCode,
    proforma_date: config.orderedDate || '2026-06-11',
    spec_mm: row.spec,
    layer: row.layer,
    steel_thickness_mm: row.steelThicknessMm,
    mdf_thickness_mm: row.mdfThicknessMm,
    gross_net_weight_kg: row.grossNetWeight,
    carton_size_cm: row.cartonSize,
    container_loading_qty_per_40gp: row.containerLoadingQty,
    finish: row.finish,
    quantity: row.quantity,
    unit_purchase_price: row.unitPurchasePrice,
    currency: 'USD',
    amount: row.amount,
  },
});

const readLeagle0611E370PiLines = (config) => (
  LEAGLE_0611E370_PI_LINES.map((row) => parseLeagle0611E370PiLine(row, config))
);

const parseLeagleXlsxProformaLine = ({
  row,
  headers,
  sourceRow,
  config,
  supplierOrderCode,
  issueDate,
}) => {
  const height = toNumber(cell(row, 1));
  const width = toNumber(cell(row, 2));
  const depth = toNumber(cell(row, 3));
  const spec = [height, width, depth].every((value) => value != null)
    ? `${height}x${width}x${depth}`
    : normalizeText(cell(row, 1));
  const capacityKg = toNumber(cell(row, 8));
  const unitPurchasePrice = toNumber(cell(row, 15));
  const quantity = toNumber(cell(row, 14));
  const amount = toNumber(cell(row, 17));

  return {
    ...lineBase({
      importWorkbookPath: config.proformaPath,
      orderCode: config.orderCode,
      sourceSheet: config.sourceSheet,
      sourceRow,
      row,
      headers,
      supplierCode: config.supplierCode,
    }),
    itemModel: normalizeText(cell(row, 0)),
    spec,
    dimensions: parseDimensions(spec),
    shelfCount: toNumber(cell(row, 4)),
    middleSupport: toNumber(cell(row, 5)),
    steelThicknessMm: toNumber(cell(row, 6)),
    mdfThicknessMm: toNumber(cell(row, 7)),
    capacity: capacityKg == null ? normalizeText(cell(row, 8)) : `${capacityKg}KG`,
    packing: normalizeText(cell(row, 9)),
    netWeightKg: toNumber(cell(row, 10)),
    grossWeightKg: toNumber(cell(row, 11)),
    cartonSize: normalizeText(cell(row, 12)),
    containerLoadingQty: toNumber(cell(row, 13)),
    quantity,
    unitPurchasePrice,
    purchaseCurrency: 'USD',
    finish: normalizeText(cell(row, 16)),
    allowFallbackMatch: true,
    rawRow: {
      ...rawRowFromHeaders(headers, row),
      source: path.basename(config.proformaPath),
      source_row: sourceRow,
      proforma_invoice_no: supplierOrderCode || config.supplierOrderCode || null,
      proforma_date: issueDate || config.orderedDate || null,
      model: normalizeText(cell(row, 0)),
      spec_mm: spec,
      quantity,
      unit_purchase_price: unitPurchasePrice,
      currency: 'USD',
      amount,
      cbm_per_unit: toNumber(cell(row, 18)),
      total_cbm: toNumber(cell(row, 19)),
      total_weight_kg: toNumber(cell(row, 20)),
    },
  };
};

const readLeagleXlsxProformaLines = async (config) => {
  const rows = await readSheetWithLegacyFallback(config.proformaPath, 'Sheet1');
  const headerRowIndex = findProformaHeaderRow(rows);
  if (headerRowIndex < 0) {
    throw new Error(`Could not find proforma header row in ${config.proformaPath}`);
  }

  const headers = rows[headerRowIndex] || [];
  const supplierOrderCode = parseProformaCode(rows) || config.supplierOrderCode || null;
  const issueDate = parseProformaIssueDate(rows) || config.orderedDate || null;

  return rows.slice(headerRowIndex + 1)
    .map((row, index) => ({ row, sourceRow: headerRowIndex + index + 2 }))
    .filter(({ row }) => (
      normalizeText(cell(row, 0))
      && toNumber(cell(row, 14)) != null
      && toNumber(cell(row, 15)) != null
    ))
    .map(({ row, sourceRow }) => parseLeagleXlsxProformaLine({
      row,
      headers,
      sourceRow,
      config,
      supplierOrderCode,
      issueDate,
    }));
};

export async function readImportOrderLines(importWorkbookPath, config) {
  if (config.sourceType === 'manual_leagle_ci_224e') {
    return readLeagle224eLines(config);
  }

  if (config.sourceType === 'leagle_xlsx_proforma') {
    return readLeagleXlsxProformaLines(config);
  }

  if (config.sourceType === 'manual_leagle_inlay_quotation') {
    return readLeagleInlayQuotationLines(config);
  }

  if (config.sourceType === 'manual_leagle_pdf_pi_0611e370') {
    return readLeagle0611E370PiLines(config);
  }

  const rows = await readSheet(importWorkbookPath, config.sourceSheet);
  const supplierCode = config.supplierCode;

  if (config.sourceSheet === 'Čína 9') {
    const headers = rows[2] || [];
    return rows.slice(3)
      .map((row, index) => ({ row, sourceRow: index + 4 }))
      .filter(({ row }) => normalizeText(cell(row, 0)))
      .map(({ row, sourceRow }) => parseStandardSpecLine({
        importWorkbookPath,
        orderCode: config.orderCode,
        sourceSheet: config.sourceSheet,
        sourceRow,
        row,
        headers,
        supplierCode,
        hasExactCodes: false,
      }));
  }

  if (config.sourceSheet === 'Čína 10') {
    const headers = rows[1] || [];
    return rows.slice(2)
      .map((row, index) => ({ row, sourceRow: index + 3 }))
      .filter(({ row }) => normalizeText(cell(row, 0)))
      .map(({ row, sourceRow }) => parseStandardSpecLine({
        importWorkbookPath,
        orderCode: config.orderCode,
        sourceSheet: config.sourceSheet,
        sourceRow,
        row,
        headers,
        supplierCode,
        hasExactCodes: false,
      }));
  }

  if (config.sourceSheet === 'Čína 11') {
    const headers = rows[0] || [];
    return rows.slice(1)
      .map((row, index) => ({ row, sourceRow: index + 2 }))
      .filter(({ row }) => normalizeText(cell(row, 0)))
      .map(({ row, sourceRow }) => parseStandardSpecLine({
        importWorkbookPath,
        orderCode: config.orderCode,
        sourceSheet: config.sourceSheet,
        sourceRow,
        row,
        headers,
        supplierCode,
        hasExactCodes: true,
      }));
  }

  if (config.sourceSheet === 'Čína 12') {
    const headers = rows[0] || [];
    return rows.slice(2)
      .map((row, index) => ({ row, sourceRow: index + 3 }))
      .filter(({ row }) => normalizeText(cell(row, 1)))
      .map(({ row, sourceRow }) => parseChina12Line({
        importWorkbookPath,
        orderCode: config.orderCode,
        sourceSheet: config.sourceSheet,
        sourceRow,
        row,
        headers,
        supplierCode,
      }));
  }

  if (config.sourceSheet === 'Čína 0526') {
    const headers = rows[0] || [];
    return rows.slice(1)
      .map((row, index) => ({ row, sourceRow: index + 2 }))
      .filter(({ row }) => toNumber(cell(row, 0)) != null)
      .map(({ row, sourceRow }) => parseChina13Line({
        importWorkbookPath,
        orderCode: config.orderCode,
        sourceSheet: config.sourceSheet,
        sourceRow,
        row,
        headers,
        supplierCode,
      }));
  }

  throw new Error(`Unsupported import sheet: ${config.sourceSheet}`);
}

const shipmentFromOverview = (orderCode, row, index) => ({
  shipmentKey: `${orderCode}:${index + 1}`,
  orderCode,
  shipmentRef: row.forwarderShipmentNo || `${orderCode}-${index + 1}`,
  containersText: row.containersText || null,
  orderedDate: row.orderedDate,
  shippedDate: row.shippedDate,
  etaBrno: row.etaBrno,
  trackingUrl: row.trackingUrl || null,
  status: row.shippedDate ? 'shipped' : (row.orderedDate ? 'objednano' : 'navrh'),
  rawRow: row.rawRow,
});

const shipmentFromKnTracking = (orderCode, shipment) => ({
  shipmentKey: `${orderCode}:${shipment.keySuffix || shipment.knTrackingNumber || shipment.shipmentRef}`,
  orderCode,
  shipmentRef: shipment.shipmentRef || shipment.knTrackingNumber || null,
  knTrackingNumber: shipment.knTrackingNumber || shipment.billOfLading || null,
  billOfLading: shipment.billOfLading || shipment.knTrackingNumber || null,
  commercialInvoiceNo: shipment.commercialInvoiceNo || null,
  supplierOrderCodes: shipment.supplierOrderCodes || null,
  containersText: shipment.containersText || null,
  containerCount: shipment.containerCount ?? null,
  loadingMethod: shipment.loadingMethod || null,
  palletized: shipment.palletized ?? null,
  loadingSummary: shipment.loadingSummary || null,
  loadingPhotos: shipment.loadingPhotos || [],
  status: shipment.status || 'shipped',
  orderedDate: shipment.orderedDate || null,
  portDepartureDate: shipment.portDepartureDate || shipment.shippedDate || null,
  shippedDate: shipment.shippedDate || shipment.portDepartureDate || null,
  etaPort: shipment.etaPort || null,
  etaHamburg: shipment.etaHamburg || shipment.etaPort || null,
  etaBrno: shipment.etaBrno || null,
  trackingUrl: shipment.trackingUrl || null,
  portOfLoading: shipment.portOfLoading || null,
  portOfTransshipment: shipment.portOfTransshipment || null,
  portOfDischarge: shipment.portOfDischarge || null,
  vesselName: shipment.vesselName || null,
  voyageNo: shipment.voyageNo || null,
  allocatedQuantity: shipment.allocatedQuantity ?? null,
  allocatedAmount: shipment.allocatedAmount ?? null,
  allocatedCurrency: shipment.allocatedCurrency || null,
  allocationNote: shipment.allocationNote || null,
  rawRow: {
    source: shipment.source || (shipment.knTrackingNumber || shipment.billOfLading ? 'myKN_tracking_manual' : 'manual_import_shipment'),
    bill_of_lading: shipment.billOfLading || shipment.knTrackingNumber || null,
    supplier_order_codes: shipment.supplierOrderCodes || null,
    commercial_invoice_no: shipment.commercialInvoiceNo || null,
    port_of_loading: shipment.portOfLoading || null,
    port_of_transshipment: shipment.portOfTransshipment || null,
    port_of_discharge: shipment.portOfDischarge || null,
    route_legs: shipment.routeLegs || [],
    allocated_quantity: shipment.allocatedQuantity ?? null,
    allocated_amount: shipment.allocatedAmount ?? null,
    allocated_currency: shipment.allocatedCurrency || null,
    allocation_note: shipment.allocationNote || null,
    container_count: shipment.containerCount ?? null,
    loading_method: shipment.loadingMethod || null,
    palletized: shipment.palletized ?? null,
    loading_summary: shipment.loadingSummary || null,
    loading_photos: shipment.loadingPhotos || [],
    note: shipment.rawNote || null,
  },
});

const manualOrderMeta = (config) => {
  if (config.sourceType === 'manual_leagle_pdf_pi_0611e370') {
    const sourceWorkbook = path.basename(config.proformaPath);
    return {
      sourceWorkbook,
      supplierOrderCode: config.supplierOrderCode || null,
      status: config.status || 'objednano',
      orderedDate: config.orderedDate || null,
      totalPcs: config.totalPcs ?? null,
      goodsDescription: 'Leagle proforma 26ML0611E370: 1800x900x400, 5 polic, galvanised + black painting, with pallets.',
      shelfDescription: `${config.containersText || '2x40HC'}, zdroj proforma ${sourceWorkbook}.`,
      auditSummaryExtra: {
        proforma_invoice_no: config.supplierOrderCode || null,
        proforma_total_amount: config.totalAmount ?? null,
        proforma_currency: 'USD',
        delivery_time: config.deliveryTime || null,
        shipped_in: config.containersText || null,
        source_of_truth: sourceWorkbook,
        fob: 'Qingdao',
      },
      rawOverviewRows: [{
        source: sourceWorkbook,
        proforma_invoice_no: config.supplierOrderCode || null,
        proforma_date: config.orderedDate || null,
        delivery_time: config.deliveryTime || null,
        shipped_in: config.containersText || null,
        amount: config.totalAmount ?? null,
        currency: 'USD',
        fob: 'Qingdao',
        payment_term: '100% against the copy of original B/L',
      }],
      documents: [{
        documentKey: `${config.orderCode}:supplier_proforma:${config.supplierOrderCode}`,
        localPath: config.proformaPath,
        fileName: sourceWorkbook,
        documentType: 'supplier_proforma',
        amount: config.totalAmount ?? null,
        currency: 'USD',
        documentDate: config.orderedDate || null,
        notes: `Proforma ${config.supplierOrderCode}, delivery time ${config.deliveryTime || 'neuvedeno'}, ${config.containersText || 'kontejnery neuvedeny'}.`,
        extractionStatus: 'parsed',
        extractedJson: {
          parser: 'manual_leagle_pdf_pi_0611e370_v1',
          proforma_invoice_no: config.supplierOrderCode || null,
          issue_date: config.orderedDate || null,
          delivery_time: config.deliveryTime || null,
          total_quantity: config.totalPcs ?? null,
          total_amount: config.totalAmount ?? null,
          currency: 'USD',
          containers_text: config.containersText || null,
          fob: 'Qingdao',
          payment_term: '100% against the copy of original B/L',
          lines: LEAGLE_0611E370_PI_LINES.map((row) => ({
            source_row: row.sourceRow,
            spec_mm: row.spec,
            layers: row.layer,
            finish: row.finish,
            quantity: row.quantity,
            unit_purchase_price: row.unitPurchasePrice,
            amount: row.amount,
          })),
        },
      }],
    };
  }

  if (config.sourceType === 'manual_leagle_inlay_quotation') {
    const sourceWorkbook = path.basename(config.quotationPath);
    return {
      sourceWorkbook,
      supplierOrderCode: null,
      status: config.status || 'objednano',
      orderedDate: config.orderedDate || null,
      totalPcs: config.totalPcs ?? null,
      goodsDescription: 'Leagle quotation: heavy version butterfly rackshelves, INLAY model, painting, without pallets.',
      shelfDescription: `${config.containersText || 'odhad kontejnerů neuveden'}, zdroj quotation screenshot ${sourceWorkbook}.`,
      auditSummaryExtra: {
        quotation_reference: config.quotationReference || null,
        quotation_date: config.orderedDate || null,
        quotation_total_amount: config.totalAmount ?? null,
        quotation_currency: 'USD',
        quoted_container_estimate: config.containersText || null,
        source_of_truth: sourceWorkbook,
        official_document_warning: 'Quotation screenshot only; official order/proforma/invoice, KN tracking and B/L are not available yet.',
      },
      rawOverviewRows: [{
        source: sourceWorkbook,
        source_type: 'supplier_quotation_screenshot',
        quotation_reference: config.quotationReference || null,
        quotation_date: config.orderedDate || null,
        shipped_in_estimate: config.containersText || null,
        amount: config.totalAmount ?? null,
        currency: 'USD',
        total_quantity: config.totalPcs ?? null,
        loading_method: 'floor_loaded',
        palletized: false,
        loading_summary: 'without pallets according to quotation',
      }],
      documents: [{
        documentKey: `${config.orderCode}:quotation_snapshot:2026-04-30-inlay`,
        localPath: config.quotationPath,
        fileName: sourceWorkbook,
        documentType: 'other',
        amount: config.totalAmount ?? null,
        currency: 'USD',
        documentDate: config.orderedDate || null,
        notes: 'Quotation screenshot for Čína 16 INLAY model. Not official PI, invoice, packing list, BL or KN invoice.',
        extractionStatus: 'parsed',
        extractedJson: {
          parser: 'manual_quotation_screenshot_v1',
          quotation_title: 'Quotation for heavy version butterfly rackshelves - INLAY model',
          quotation_date: config.orderedDate || null,
          total_quantity: config.totalPcs ?? null,
          total_amount: config.totalAmount ?? null,
          currency: 'USD',
          containers_text_estimate: config.containersText || null,
          official_document_warning: 'quotation screenshot only',
          lines: CHINA16_INLAY_QUOTATION_LINES.map((row) => ({
            source_row: row.sourceRow,
            dimensions_mm: [row.heightMm, row.widthMm, row.depthMm],
            layers: row.layer,
            capacity: row.capacity,
            quantity: row.quantity,
            unit_purchase_price: row.unitPurchasePrice,
            amount: Math.round(row.quantity * row.unitPurchasePrice * 100) / 100,
          })),
        },
      }],
    };
  }

  if (config.sourceType === 'leagle_xlsx_proforma') {
    const sourceWorkbook = path.basename(config.proformaPath);
    return {
      sourceWorkbook,
      supplierOrderCode: config.supplierOrderCode || null,
      status: config.status || 'objednano',
      orderedDate: config.orderedDate || null,
      totalPcs: config.totalPcs ?? null,
      goodsDescription: `Leagle proforma ${config.supplierOrderCode}: regály 0.6 mm / MDF 6 mm, 200 kg, ${config.containersText || 'kontejnery neuvedeny'}.`,
      shelfDescription: `${config.containersText || '4x40GP'}, zdroj proforma ${sourceWorkbook}.`,
      auditSummaryExtra: {
        proforma_invoice_no: config.supplierOrderCode || null,
        proforma_total_amount: config.totalAmount ?? null,
        proforma_currency: 'USD',
        proforma_total_cbm: config.totalCbm ?? null,
        proforma_total_weight_kg: config.totalWeightKg ?? null,
        delivery_time: config.deliveryTime || null,
        shipped_in: config.containersText || null,
        source_of_truth: sourceWorkbook,
      },
      rawOverviewRows: [{
        source: sourceWorkbook,
        proforma_invoice_no: config.supplierOrderCode || null,
        proforma_date: config.orderedDate || null,
        delivery_time: config.deliveryTime || null,
        shipped_in: config.containersText || null,
        amount: config.totalAmount ?? null,
        currency: 'USD',
        total_cbm: config.totalCbm ?? null,
        total_weight_kg: config.totalWeightKg ?? null,
      }],
      documents: [{
        documentKey: `${config.orderCode}:supplier_proforma:${config.supplierOrderCode}`,
        localPath: config.proformaPath,
        fileName: sourceWorkbook,
        documentType: 'supplier_proforma',
        amount: config.totalAmount ?? null,
        currency: 'USD',
        documentDate: config.orderedDate || null,
        notes: `Proforma ${config.supplierOrderCode}, delivery time ${config.deliveryTime || 'neuvedeno'}, ${config.containersText || 'kontejnery neuvedeny'}.`,
        extractionStatus: 'parsed',
        extractedJson: {
          parser: 'leagle_xlsx_proforma_v1',
          proforma_invoice_no: config.supplierOrderCode || null,
          issue_date: config.orderedDate || null,
          delivery_time: config.deliveryTime || null,
          total_quantity: config.totalPcs ?? null,
          total_amount: config.totalAmount ?? null,
          currency: 'USD',
          containers_text: config.containersText || null,
          total_cbm: config.totalCbm ?? null,
          total_weight_kg: config.totalWeightKg ?? null,
        },
      }],
    };
  }

  if (config.sourceType !== 'manual_leagle_ci_224e') return {};
  return {
    sourceWorkbook: LEAGLE_224E_SOURCE_WORKBOOK,
    supplierOrderCode: '25ML1206E665',
    status: 'shipped',
    orderedDate: '2026-04-20',
    shippedDate: '2026-04-26',
    etaBrno: '2026-07-03',
    totalPcs: 3903,
    goodsDescription: 'Leagle CI 26ML224E sample order: shelves and packing machines.',
    shelfDescription: '2x40HC, source of truth CI/PL 26ML224E.',
    auditSummaryExtra: {
      commercial_invoice_no: '26ML224E',
      bill_of_lading: '1073423125',
      source_of_truth: LEAGLE_224E_SOURCE_WORKBOOK,
      total_amount: 61591.36,
      currency: 'USD',
      fob: 'Qingdao',
    },
    rawOverviewRows: [{
      source: LEAGLE_224E_SOURCE_WORKBOOK,
      commercial_invoice_no: '26ML224E',
      supplier_order_code: '25ML1206E665',
      bill_of_lading: '1073423125',
      shipped_in: '2x40HC',
      loading_method: 'floor_loaded',
      palletized: false,
      loading_summary: '2x40HC bez palet, kartony floor-loaded podle fotek 26ML224E.',
      etd: '2026-04-24',
      kn_port_departure: '2026-04-26',
      eta_port: '2026-06-19',
      eta_brno_estimated: '2026-07-03',
      amount: 61591.36,
      currency: 'USD',
    }],
    documents: [
      {
        documentKey: 'Čína 6:supplier_invoice:26ML224E',
        localPath: LEAGLE_224E_SOURCE_PATH,
        fileName: LEAGLE_224E_SOURCE_WORKBOOK,
        documentType: 'supplier_invoice',
        amount: 61591.36,
        currency: 'USD',
        documentDate: '2026-04-20',
        notes: 'Commercial Invoice 26ML224E / P-I 25ML1206E665, FOB Qingdao, shipped in 2x40HC.',
        extractionStatus: 'parsed',
        extractedJson: {
          parser: 'manual_leagle_ci_pl_224e_v1',
          commercial_invoice_no: '26ML224E',
          supplier_order_code: '25ML1206E665',
          issue_date: '2026-04-20',
          total_amount: 61591.36,
          currency: 'USD',
          fob: 'Qingdao',
          bill_of_lading: '1073423125',
          containers: [
            { container_no: 'MSCU5459597', seal_no: 'FX47269017' },
            { container_no: 'FFAU2929604', seal_no: 'FX46181725' },
          ],
        },
      },
      {
        documentKey: 'Čína 6:packing_list:26ML224E',
        localPath: LEAGLE_224E_SOURCE_PATH,
        fileName: LEAGLE_224E_SOURCE_WORKBOOK,
        documentType: 'packing_list',
        documentDate: '2026-04-20',
        notes: 'CI/PL workbook 26ML224E includes container and seal breakdown for 2x40HC.',
        extractionStatus: 'parsed',
        extractedJson: {
          parser: 'manual_leagle_ci_pl_224e_v1',
          commercial_invoice_no: '26ML224E',
          supplier_order_code: '25ML1206E665',
          bill_of_lading: '1073423125',
          shipped_in: '2x40HC',
          containers: [
            { container_no: 'MSCU5459597', seal_no: 'FX47269017' },
            { container_no: 'FFAU2929604', seal_no: 'FX46181725' },
          ],
        },
      },
      {
        documentKey: 'Čína 6:bl_tracking:telex-release-26ML224E',
        localPath: LEAGLE_224E_TELEX_RELEASE_PATH,
        fileName: 'Telex Cargo Release Order--26ML224E.pdf',
        documentType: 'bl_tracking',
        documentDate: '2026-06-12',
        notes: 'Kuehne+Nagel Telex Cargo Release Order for tracking 1073423125 / CI 26ML224E.',
        extractionStatus: 'parsed',
        extractedJson: {
          parser: 'manual_kn_telex_release_26ml224e_v1',
          tracking_no: '1073423125',
          kn_accounting_no: '1073423125-0749',
          release_date: '2026-06-12',
          shipper: 'QINGDAO LEAGLE INDUSTRY CO., LTD.',
          consignee: 'REGAL MASTER S.R.O.',
          vessel_name: 'MSC LIVORNO',
          voyage: 'GA617W',
          port_of_loading: 'Qingdao',
          port_of_discharge: 'Bremerhaven',
          place_of_delivery: 'Brno',
          etd_atd: '2026-04-26',
          eta_ata: '2026-06-19',
          containers: [
            {
              container_no: 'FFAU2929604',
              type: "40' HC",
              seal_no: 'FX46181725',
              packages: 1507,
              weight_kg: 22830,
              volume_cbm: 60.3,
            },
            {
              container_no: 'MSCU5459597',
              type: "40' HC",
              seal_no: 'FX47269017',
              packages: 2396,
              weight_kg: 27000,
              volume_cbm: 59.5,
            },
          ],
          total_weight_kg: 49830,
          total_volume_cbm: 119.8,
        },
      },
    ],
  };
};

export async function readImportOrders(importWorkbookPath) {
  const overview = await readImportOverview(importWorkbookPath);

  const orders = [];
  for (const config of CURRENT_IMPORT_ORDER_CONFIG) {
    const overviewRows = overview.get(config.orderCode) || [];
    const meta = manualOrderMeta(config);
    const supplier = supplierForCode(config.supplierCode);
    const lines = await readImportOrderLines(importWorkbookPath, config);
    const lineQty = lines.reduce((sum, line) => sum + (toNumber(line.quantity) || 0), 0);
    const overviewQty = overviewRows.find((row) => row.overviewTotalPcs != null)?.overviewTotalPcs ?? null;
    const configuredShipments = IMPORT_KN_TRACKING_SHIPMENTS[config.orderCode] || [];
    const hasConfiguredShipments = configuredShipments.length > 0;
    const shipments = hasConfiguredShipments
      ? configuredShipments.map(shipmentFromKnTracking.bind(null, config.orderCode))
      : (overviewRows.length ? overviewRows.map(shipmentFromOverview.bind(null, config.orderCode)) : []);
    const firstShipment = shipments[0] || null;

    orders.push({
      orderCode: config.orderCode,
      supplierOrderCode: meta.supplierOrderCode || config.supplierOrderCode || null,
      sourceWorkbook: meta.sourceWorkbook || path.basename(importWorkbookPath),
      sourceSheet: config.sourceSheet,
      supplierCode: config.supplierCode,
      supplierKey: supplier.supplierKey,
      supplierName: supplier.name,
      status: meta.status || config.status || firstShipment?.status || (!hasConfiguredShipments ? statusFromOverview(overviewRows) : 'navrh'),
      orderedDate: meta.orderedDate || firstShipment?.orderedDate || (!hasConfiguredShipments ? overviewRows.find((row) => row.orderedDate)?.orderedDate : null) || null,
      shippedDate: meta.shippedDate || firstShipment?.shippedDate || (!hasConfiguredShipments ? overviewRows.find((row) => row.shippedDate)?.shippedDate : null) || null,
      etaBrno: meta.etaBrno || firstShipment?.etaBrno || (!hasConfiguredShipments ? overviewRows.find((row) => row.etaBrno)?.etaBrno : null) || null,
      totalPcs: meta.totalPcs ?? overviewQty ?? (lineQty || null),
      goodsDescription: meta.goodsDescription || overviewRows.map((row) => row.goodsDescription).filter(Boolean).join(' / '),
      shelfDescription: meta.shelfDescription || overviewRows.map((row) => row.shelfDescription).filter(Boolean).join(' / '),
      shipments,
      lines,
      auditSummaryExtra: meta.auditSummaryExtra || null,
      rawOverviewRows: meta.rawOverviewRows || overviewRows.map((row) => row.rawRow),
      documents: meta.documents || [],
    });
  }

  return orders;
}

async function readChina13Proforma(proformaPath) {
  if (!proformaPath) return null;
  try {
    const buffer = await fs.readFile(proformaPath);
    const { parsed } = await parseSupplierProformaPdf(buffer);
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function applyChina13Proforma(orders, parsedProforma) {
  if (!parsedProforma?.items?.length) return orders;
  return orders.map((order) => {
    if (order.orderCode !== 'Čína 13') return order;
    const itemsByPosition = new Map(parsedProforma.items.map((item) => [item.position, item]));
    const lines = order.lines.map((line) => {
      const position = toNumber(line.position ?? line.rawRow?.['Pos.'] ?? line.sourceRow - 1);
      const item = itemsByPosition.get(position);
      if (!item) return line;
      return {
        ...line,
        quantity: item.quantity,
        unitPurchasePrice: item.unitPurchasePrice,
        purchaseCurrency: item.purchaseCurrency || parsedProforma.currency || 'USD',
        rawRow: {
          ...(line.rawRow || {}),
          proforma: {
            invoice_no: parsedProforma.invoiceNo,
            supplier_order_code: parsedProforma.supplierOrderCode,
            item_no: item.itemNo,
            quantity: item.quantity,
            unit_purchase_price: item.unitPurchasePrice,
            currency: item.purchaseCurrency || parsedProforma.currency || 'USD',
            extended_price: item.extendedPrice,
          },
        },
      };
    });

    return {
      ...order,
      supplierOrderCode: parsedProforma.supplierOrderCode || order.supplierOrderCode || null,
      orderedDate: order.orderedDate || parsedProforma.issueDate,
      status: order.status === 'navrh' ? 'objednano' : order.status,
      totalPcs: parsedProforma.totalQuantity || lines.reduce((sum, line) => sum + (toNumber(line.quantity) || 0), 0),
      auditSummaryExtra: {
        proforma_invoice_no: parsedProforma.invoiceNo,
        proforma_total_amount: parsedProforma.totalAmount,
        proforma_currency: parsedProforma.currency,
        proforma_parser: parsedProforma.parser,
      },
      lines,
    };
  });
}

function applySupplementalProformaPrices(orders, proformaPricesByOrder) {
  return orders.map((order) => {
    const priceRows = proformaPricesByOrder.get(order.orderCode) || [];
    if (!priceRows.length) return order;

    const lines = order.lines.map((line, index) => {
      const priceRow = priceRows[index];
      if (!priceRow) return line;
      return {
        ...line,
        unitPurchasePrice: priceRow.unitPurchasePrice,
        purchaseCurrency: 'USD',
        rawRow: {
          ...(line.rawRow || {}),
          proforma: {
            source_file: priceRow.sourceFile,
            source_row: priceRow.sourceRow,
            supplier_order_code: priceRow.supplierOrderCode,
            unit_purchase_price: priceRow.unitPurchasePrice,
            currency: 'USD',
            extended_price: priceRow.amount,
          },
        },
      };
    });

    const supplierOrderCode = priceRows.find((row) => row.supplierOrderCode)?.supplierOrderCode || order.supplierOrderCode || null;
    return {
      ...order,
      supplierOrderCode,
      lines,
      auditSummaryExtra: {
        ...(order.auditSummaryExtra || {}),
        supplemental_proforma_source: priceRows[0]?.sourceFile || null,
        supplemental_proforma_code: supplierOrderCode,
      },
    };
  });
}

export async function readProductMaster(masterWorkbookPath) {
  const main = await readSheet(masterWorkbookPath, 'MAIN');
  const produkty = await readSheet(masterWorkbookPath, 'Produkty');
  const rows = [];

  main.slice(3).forEach((row, index) => {
    const code = normalizeCode(cell(row, 3));
    const ean = normalizeEan(cell(row, 4));
    if (!code && !ean) return;
    rows.push({
      code,
      ean,
      title: normalizeText(cell(row, 2)),
      oldCode: normalizeText(cell(row, 1)),
      weightKg: toNumber(cell(row, 5)),
      activeEshop: cell(row, 6),
      sourceSheet: 'MAIN',
      sourceRow: index + 4,
      rawRow: rawRowFromHeaders(main[1] || [], row),
    });
  });

  produkty.slice(1).forEach((row, index) => {
    const code = normalizeCode(cell(row, 1));
    const ean = normalizeEan(cell(row, 4));
    if (!code && !ean) return;
    rows.push({
      code,
      ean,
      title: normalizeText(cell(row, 6)),
      oldCode: normalizeText(cell(row, 2)),
      weightKg: null,
      activeEshop: cell(row, 5),
      sourceSheet: 'Produkty',
      sourceRow: index + 2,
      rawRow: rawRowFromHeaders(produkty[0] || [], row),
    });
  });

  return rows;
}

export async function buildImportLogisticsDataset({
  importWorkbookPath,
  masterWorkbookPath,
  china13ProformaPath,
  leagleProformaPriceFiles = DEFAULT_LEAGLE_PROFORMA_PRICE_FILES,
} = {}) {
  if (!importWorkbookPath) throw new Error('Missing importWorkbookPath');
  if (!masterWorkbookPath) throw new Error('Missing masterWorkbookPath');

  const [orders, masterRows, china13Proforma, supplementalPriceEntries] = await Promise.all([
    readImportOrders(importWorkbookPath),
    readProductMaster(masterWorkbookPath),
    readChina13Proforma(china13ProformaPath),
    Promise.all(Object.entries(leagleProformaPriceFiles || {}).map(async ([orderCode, filePath]) => ([
      orderCode,
      await readSupplementalProformaPrices(orderCode, filePath),
    ]))),
  ]);
  const proformaPricesByOrder = new Map(supplementalPriceEntries);
  const pricedOrders = applySupplementalProformaPrices(applyChina13Proforma(orders, china13Proforma), proformaPricesByOrder);
  const enrichedOrders = enrichImportOrdersWithMatches(pricedOrders, masterRows);
  const audit = auditImportOrders(enrichedOrders);
  const auditFailures = validateExpectedAudit(audit);

  return {
    orders: enrichedOrders,
    masterRows,
    audit,
    auditFailures,
  };
}
