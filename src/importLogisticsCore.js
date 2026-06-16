import { isExcludedBusinessOrder } from './businessOrderStatus.js';
import { FX_RATES_TO_CZK, normalizeCurrency } from './currencyRates.js';

export const IMPORT_ORDER_STATUSES = ['navrh', 'objednano', 'shipped', 'v_pristavu', 'naskladneno'];
export const IN_TRANSIT_IMPORT_STATUSES = ['navrh', 'objednano', 'shipped', 'v_pristavu'];
export const IMPORT_GROWTH_MONTHLY = 0.2;

export const IMPORT_SUPPLIERS = {
  1: { supplierKey: 'abc-china', supplierCode: 1, name: 'ABC China' },
  3: { supplierKey: 'leagle-china', supplierCode: 3, name: 'Leagle China' },
};

export const getImportCurrencyRateToCzk = (currency) => {
  const normalized = normalizeCurrency(currency || 'CZK');
  return FX_RATES_TO_CZK[normalized] || null;
};

export const convertImportUnitCostToCzk = (unitPurchasePrice, currency = 'CZK') => {
  const price = toNumber(unitPurchasePrice);
  if (price == null) return null;
  const rate = getImportCurrencyRateToCzk(currency);
  return rate == null ? null : price * rate;
};

export const CURRENT_IMPORT_ORDER_CONFIG = [
  { orderCode: 'Čína 6', sourceSheet: 'CI PL-26ML224E', supplierCode: 3, sourceType: 'manual_leagle_ci_224e' },
  { orderCode: 'Čína 9', sourceSheet: 'Čína 9', supplierCode: 3, supplierOrderCode: '25ML0121E035' },
  { orderCode: 'Čína 10', sourceSheet: 'Čína 10', supplierCode: 3, supplierOrderCode: '26ML0210E093' },
  { orderCode: 'Čína 11', sourceSheet: 'Čína 11', supplierCode: 3, supplierOrderCode: '26ML0320E160', status: 'objednano' },
  { orderCode: 'Čína 12', sourceSheet: 'Čína 12', supplierCode: 3, supplierOrderCode: '26ML0429E246', status: 'objednano' },
  { orderCode: 'Čína 13', sourceSheet: 'Čína 0526', supplierCode: 1 },
  {
    orderCode: 'Čína 14',
    sourceSheet: 'PI 26ML0528E306',
    supplierCode: 3,
    supplierOrderCode: '26ML0528E306',
    sourceType: 'leagle_xlsx_proforma',
    proformaPath: '/Users/mbo/Downloads/PI---26ML0528E306 2.xlsx',
    orderedDate: '2026-05-28',
    deliveryTime: '2026-06-30',
    containerCount: 4,
    containersText: '4x40GP',
    totalPcs: 6400,
    totalAmount: 76764,
    totalCbm: 194.96,
    totalWeightKg: 111536,
    status: 'objednano',
  },
  {
    orderCode: 'Čína 15',
    sourceSheet: 'PI 26ML0611E370',
    supplierCode: 3,
    supplierOrderCode: '26ML0611E370',
    sourceType: 'manual_leagle_pdf_pi_0611e370',
    proformaPath: '/Users/mbo/Downloads/PI--26ML0611E370-Sheet1 2.pdf',
    orderedDate: '2026-06-11',
    deliveryTime: '2026-07-15',
    containerCount: 2,
    containersText: '2x40HC',
    totalPcs: 4284,
    totalAmount: 34914.6,
    status: 'objednano',
  },
  {
    orderCode: 'Čína 16',
    sourceSheet: 'Quotation 2026-04-30 INLAY',
    supplierCode: 3,
    quotationReference: 'Quotation Apr.30 2026',
    sourceType: 'manual_leagle_inlay_quotation',
    quotationPath: '/Users/mbo/Desktop/Image_20260611112915_488_5.png',
    orderedDate: '2026-04-30',
    containerCount: 2,
    containersText: 'odhad 2x40GP',
    totalPcs: 1860,
    totalAmount: 47721,
    status: 'objednano',
  },
];

export const KN_TRACKING_SEARCH_URL = 'https://mykn.kuehne-nagel.com/public-tracking/shipments';

const knTrackingUrl = (trackingNumber) => `${KN_TRACKING_SEARCH_URL}?query=${encodeURIComponent(trackingNumber)}`;

const LEAGLE_26ML215E_LOADING_PHOTOS = [
  {
    localPath: '/Users/mbo/Downloads/26ML215E/7个柜093和035发货明细/第一个柜明细/98674d350db57020860952efada23d98.jpg',
    fileName: '26ML215E kontejner 1 - zajisteni-nakladu.jpg',
    caption: '26ML215E kontejner 1 - zbozi nalozene bez palet, zajistene siti u dveri.',
  },
  {
    localPath: '/Users/mbo/Downloads/26ML215E/7个柜093和035发货明细/第三个柜/bc4cc5a63faa372aedce0a63fb33b3d6.jpg',
    fileName: '26ML215E kontejner 3 - vnitrni-skladba.jpg',
    caption: '26ML215E kontejner 3 - kartony floor-loaded, vrstvene primo na podlaze kontejneru.',
  },
  {
    localPath: '/Users/mbo/Downloads/26ML215E/7个柜093和035发货明细/第4个柜/23239bb5aa2eacea6fcc9b873b0b5a36.jpg',
    fileName: '26ML215E kontejner 4 - dvere-TGBU986099.jpg',
    caption: '26ML215E kontejner 4 - uzavreny kontejner TGBU986099.',
  },
  {
    localPath: '/Users/mbo/Downloads/26ML215E/7个柜093和035发货明细/第4个柜/fec04e17aa48794258a91bcc4a0af776.jpg',
    fileName: '26ML215E kontejner 4 - vnitrni-skladba.jpg',
    caption: '26ML215E kontejner 4 - pohled do kontejneru na bloky kartonu bez palet.',
  },
  {
    localPath: '/Users/mbo/Downloads/26ML215E/7个柜093和035发货明细/第5个柜 -/3f697cd1b67f6950fd7c3f8bba4762ea.jpg',
    fileName: '26ML215E kontejner 5 - nakladka.jpg',
    caption: '26ML215E kontejner 5 - prubeh nakladky s kartony stohovanymi bez palet.',
  },
  {
    localPath: '/Users/mbo/Downloads/26ML215E/7个柜093和035发货明细/第5个柜 -/78dab9e0de4d6795daa7251ebd09492d.jpg',
    fileName: '26ML215E kontejner 5 - predni-bloky.jpg',
    caption: '26ML215E kontejner 5 - predni bloky dlouhych kartonu nalozene primo na podlaze.',
  },
  {
    localPath: '/Users/mbo/Downloads/26ML215E/7个柜093和035发货明细/第6个柜 -/5c762bf30a796cd94fe3b2d72365b84b.jpg',
    fileName: '26ML215E kontejner 6 - zajisteni-nakladu.jpg',
    caption: '26ML215E kontejner 6 - plne nalozeny kontejner, naklad zajisteny siti.',
  },
  {
    localPath: '/Users/mbo/Downloads/26ML215E/7个柜093和035发货明细/第6个柜 -/806859384ec5da3cfc47bb724f198c7e.jpg',
    fileName: '26ML215E kontejner 6 - dvere-MSBU703927.jpg',
    caption: '26ML215E kontejner 6 - uzavreny kontejner MSBU703927.',
  },
  {
    localPath: '/Users/mbo/Downloads/26ML215E/7个柜093和035发货明细/第6个柜 -/cca23fcc8c11f39d2306629466fa0233.jpg',
    fileName: '26ML215E kontejner 6 - zadni-blok.jpg',
    caption: '26ML215E kontejner 6 - zadni blok kartonu pred dokoncenim nakladky.',
  },
  {
    localPath: '/Users/mbo/Downloads/26ML215E/7个柜093和035发货明细/第6个柜 -/e45c470e5d23b9e044d93655271152f8.jpg',
    fileName: '26ML215E kontejner 6 - stredni-bloky.jpg',
    caption: '26ML215E kontejner 6 - stredni bloky kartonu nalozene bez palet.',
  },
  {
    localPath: '/Users/mbo/Downloads/26ML215E/7个柜093和035发货明细/第七个/36e4403d8d78cb564ed942820b6a14e6.jpg',
    fileName: '26ML215E kontejner 7 - zajisteni-nakladu.jpg',
    caption: '26ML215E kontejner 7 - plne nalozeny kontejner, naklad zajisteny siti.',
  },
];

export const IMPORT_KN_TRACKING_SHIPMENTS = {
  'Čína 6': [
    {
      keySuffix: '26ML224E',
      shipmentRef: '26ML224E',
      billOfLading: '1073423125',
      knTrackingNumber: '1073423125',
      commercialInvoiceNo: '26ML224E',
      supplierOrderCodes: '25ML1206E665',
      containersText: '2x40HC (MSCU5459597, FFAU2929604)',
      containerCount: 2,
      loadingMethod: 'floor_loaded',
      palletized: false,
      loadingSummary: '2 kontejnery 40HC naložené bez palet: kartony jsou floor-loaded, vrstvené do bloků přímo na podlahu kontejneru podle fotek 26ML224E.',
      loadingPhotos: [
        {
          localPath: '/Users/mbo/Downloads/26ML224E 1.jpg',
          fileName: '26ML224E 1.jpg',
          caption: '26ML224E bez palet - zadní bloky kartonů naložené přímo na podlahu.',
        },
        {
          localPath: '/Users/mbo/Downloads/26ML224E 2.jpg',
          fileName: '26ML224E 2.jpg',
          caption: '26ML224E bez palet - dlouhé kartony vrstvené do bloků uvnitř kontejneru.',
        },
        {
          localPath: '/Users/mbo/Downloads/26ML224E 3.jpg',
          fileName: '26ML224E 3.jpg',
          caption: '26ML224E bez palet - doplněné bloky kartonů a fixační dřevěná přepážka.',
        },
      ],
      status: 'shipped',
      orderedDate: '2026-04-20',
      portDepartureDate: '2026-04-26',
      shippedDate: '2026-04-26',
      etaPort: '2026-06-19',
      etaBrno: '2026-07-03',
      trackingUrl: knTrackingUrl('1073423125'),
      portOfLoading: 'Qingdao/CNTAO',
      portOfTransshipment: 'Ningbo/CNNGB',
      portOfDischarge: 'Bremerhaven/DEBRV',
      vesselName: 'MSC LIVORNO',
      voyageNo: 'GA617W',
      allocatedQuantity: 3903,
      allocatedAmount: 61591.36,
      allocatedCurrency: 'USD',
      allocationNote: 'Source of truth: CI/PL 26ML224E and Telex Cargo Release Order 26ML224E. ETA Brno is an internal +14d estimate from KN ETA/ATA 19.06.2026.',
      routeLegs: [
        {
          vessel: 'MSC GENOVA',
          voyage: 'GL617W',
          from: 'Qingdao/CNTAO',
          to: 'Ningbo/CNNGB',
          departure: '2026-04-26',
          arrival: '2026-04-29',
        },
        {
          vessel: 'MSC LIVORNO',
          voyage: 'GA617W',
          from: 'Ningbo/CNNGB',
          to: 'Bremerhaven/DEBRV',
          departure: '2026-05-05',
          arrival: '2026-06-19',
        },
      ],
    },
  ],
  'Čína 9': [
    {
      keySuffix: '26ML215E-cina9',
      shipmentRef: '26ML215E',
      billOfLading: '1073423126',
      knTrackingNumber: '1073423126',
      commercialInvoiceNo: '26ML215E',
      supplierOrderCodes: '25ML0121E035',
      containersText: '7x40HC (sdíleno s Čína 10)',
      containerCount: 7,
      loadingMethod: 'floor_loaded',
      palletized: false,
      loadingSummary: 'Součást 7 kontejnerů 40HC CI 26ML215E: kartony jsou naložené bez palet, vrstvené přímo na podlahu a zajištěné sítí podle fotek.',
      loadingPhotos: LEAGLE_26ML215E_LOADING_PHOTOS,
      status: 'shipped',
      portDepartureDate: '2026-04-19',
      shippedDate: '2026-04-19',
      etaPort: '2026-06-12',
      etaBrno: '2026-06-26',
      trackingUrl: knTrackingUrl('1073423126'),
      portOfLoading: 'Qingdao/CNTAO',
      portOfTransshipment: 'Ningbo/CNNGB',
      portOfDischarge: 'Bremerhaven/DEBRV',
      vesselName: 'MSC PERLE',
      voyageNo: 'GA616W',
      allocatedQuantity: 5800,
      allocatedAmount: 61905,
      allocatedCurrency: 'USD',
      allocationNote: 'Celá Čína 9 je v CI 26ML215E; stejný B/L veze i část Čína 10.',
      routeLegs: [
        {
          vessel: 'MSC ROME',
          voyage: 'GL616W',
          from: 'Qingdao/CNTAO',
          to: 'Ningbo/CNNGB',
          departure: '2026-04-19',
          arrival: '2026-04-22',
        },
        {
          vessel: 'MSC PERLE',
          voyage: 'GA616W',
          from: 'Ningbo/CNNGB',
          to: 'Bremerhaven/DEBRV',
          departure: '2026-04-28',
          arrival: '2026-06-12',
        },
      ],
    },
  ],
  'Čína 10': [
    {
      keySuffix: '26ML183E',
      shipmentRef: '26ML183E',
      billOfLading: '1073422970',
      knTrackingNumber: '1073422970',
      commercialInvoiceNo: '26ML183E',
      supplierOrderCodes: '26ML0210E093',
      containersText: '2x40HC',
      containerCount: 2,
      loadingMethod: 'palletized',
      palletized: true,
      loadingSummary: '2 kontejnery 40HC naložené na paletách: paletové bloky jsou fóliované, páskované a stažené kurty podle fotek 26ML183E.',
      loadingPhotos: [
        {
          localPath: '/Users/mbo/Downloads/26ML183E,with pallets 1.jpg',
          fileName: '26ML183E,with pallets 1.jpg',
          caption: '26ML183E s paletami - čtyři paletové bloky u dveří, fóliované a páskované.',
        },
        {
          localPath: '/Users/mbo/Downloads/26ML183E,with pallets 2.jpg',
          fileName: '26ML183E,with pallets 2.jpg',
          caption: '26ML183E s paletami - palety ve dvou sloupcích a dvou úrovních u dveří.',
        },
        {
          localPath: '/Users/mbo/Downloads/26ML183E,with pallets 3.jpg',
          fileName: '26ML183E,with pallets 3.jpg',
          caption: '26ML183E s paletami - pohled dovnitř na paletové bloky v zadní části kontejneru.',
        },
      ],
      status: 'shipped',
      portDepartureDate: '2026-04-05',
      shippedDate: '2026-04-05',
      etaPort: '2026-06-16',
      etaBrno: '2026-06-30',
      trackingUrl: knTrackingUrl('1073422970'),
      portOfLoading: 'Qingdao/CNTAO',
      portOfTransshipment: 'Ningbo/CNNGB',
      portOfDischarge: 'Bremerhaven/DEBRV',
      vesselName: 'MSC VICTORINE',
      voyageNo: 'FW615W',
      allocatedQuantity: 4862,
      allocatedAmount: 38537.3,
      allocatedCurrency: 'USD',
      allocationNote: 'První část Čína 10 podle CI/PL 26ML183E. ETA Brno je interní +14d odhad z KN port ETA.',
      routeLegs: [
        {
          vessel: 'MSC GIOIA TAURO',
          voyage: 'GL614W',
          from: 'Qingdao/CNTAO',
          to: 'Ningbo/CNNGB',
          departure: '2026-04-05',
          arrival: '2026-04-09',
        },
        {
          vessel: 'MSC VICTORINE',
          voyage: 'FW615W',
          from: 'Ningbo/CNNGB',
          to: 'Bremerhaven/DEBRV',
          departure: '2026-04-18',
          arrival: '2026-06-16',
        },
      ],
    },
    {
      keySuffix: '26ML215E-cina10',
      shipmentRef: '26ML215E',
      billOfLading: '1073423126',
      knTrackingNumber: '1073423126',
      commercialInvoiceNo: '26ML215E',
      supplierOrderCodes: '26ML0210E093',
      containersText: '7x40HC (část sdílené zásilky s Čína 9)',
      containerCount: 7,
      loadingMethod: 'floor_loaded',
      palletized: false,
      loadingSummary: 'Část 7 kontejnerů 40HC CI 26ML215E: kartony jsou naložené bez palet, vrstvené přímo na podlahu a zajištěné sítí podle fotek.',
      loadingPhotos: LEAGLE_26ML215E_LOADING_PHOTOS,
      status: 'shipped',
      portDepartureDate: '2026-04-19',
      shippedDate: '2026-04-19',
      etaPort: '2026-06-12',
      etaBrno: '2026-06-26',
      trackingUrl: knTrackingUrl('1073423126'),
      portOfLoading: 'Qingdao/CNTAO',
      portOfTransshipment: 'Ningbo/CNNGB',
      portOfDischarge: 'Bremerhaven/DEBRV',
      vesselName: 'MSC PERLE',
      voyageNo: 'GA616W',
      allocatedQuantity: 6000,
      allocatedAmount: 65967,
      allocatedCurrency: 'USD',
      allocationNote: 'Zbytek Čína 10 v CI 26ML215E; stejný B/L veze i celou Čína 9.',
      routeLegs: [
        {
          vessel: 'MSC ROME',
          voyage: 'GL616W',
          from: 'Qingdao/CNTAO',
          to: 'Ningbo/CNNGB',
          departure: '2026-04-19',
          arrival: '2026-04-22',
        },
        {
          vessel: 'MSC PERLE',
          voyage: 'GA616W',
          from: 'Ningbo/CNNGB',
          to: 'Bremerhaven/DEBRV',
          departure: '2026-04-28',
          arrival: '2026-06-12',
        },
      ],
    },
  ],
  'Čína 11': [
    {
      keySuffix: '26ML0320E160',
      shipmentRef: '26ML0320E160',
      supplierOrderCodes: '26ML0320E160',
      containersText: '4x40GP',
      containerCount: 4,
      status: 'objednano',
      orderedDate: '2026-03-20',
      allocatedQuantity: 7800,
      allocatedAmount: 78404,
      allocatedCurrency: 'USD',
      allocationNote: 'Zdroj: proforma PI--26ML0320E160 2.xlsx. KN tracking ani B/L zatím nejsou k dispozici.',
      source: 'supplier_proforma_manual',
      portOfLoading: 'Qingdao, China',
      portOfDischarge: 'Czech Republic',
      rawNote: 'Delivery time APR.10,2026; SHIPPED IN 4*40GP.',
    },
  ],
  'Čína 12': [
    {
      keySuffix: '26ML0429E246',
      shipmentRef: '26ML0429E246',
      supplierOrderCodes: '26ML0429E246',
      containersText: '4x40GP',
      containerCount: 4,
      status: 'objednano',
      orderedDate: '2026-04-30',
      allocatedQuantity: 7530,
      allocatedAmount: 77543.5,
      allocatedCurrency: 'USD',
      allocationNote: 'Zdroj: proforma PI--light version butterfly-26ML0429E246.xls. KN tracking ani B/L zatím nejsou k dispozici.',
      source: 'supplier_proforma_manual',
      portOfLoading: 'Qingdao, China',
      portOfDischarge: 'Czech Republic',
      rawNote: 'Delivery time MAY 25,2026; SHIPPED IN 4*40GP.',
    },
  ],
  'Čína 14': [
    {
      keySuffix: '26ML0528E306',
      shipmentRef: '26ML0528E306',
      supplierOrderCodes: '26ML0528E306',
      containersText: '4x40GP',
      containerCount: 4,
      status: 'objednano',
      orderedDate: '2026-05-28',
      allocatedQuantity: 6400,
      allocatedAmount: 76764,
      allocatedCurrency: 'USD',
      allocationNote: 'Zdroj: proforma PI---26ML0528E306 2.xlsx. KN tracking, B/L, CI ani packing list zatím nejsou k dispozici.',
      source: 'supplier_proforma_manual',
      portOfLoading: 'Qingdao, China',
      portOfDischarge: 'Czech Republic',
      rawNote: 'Delivery time JUNE 30,2026; SHIPPED IN 4*40GP.',
    },
  ],
  'Čína 15': [
    {
      keySuffix: '26ML0611E370',
      shipmentRef: '26ML0611E370',
      supplierOrderCodes: '26ML0611E370',
      containersText: '2x40HC',
      containerCount: 2,
      loadingMethod: 'palletized',
      palletized: true,
      loadingSummary: 'Na paletách podle proformy: Unit price, with pallets. KN tracking, B/L ani CI zatím nejsou k dispozici.',
      status: 'objednano',
      orderedDate: '2026-06-11',
      allocatedQuantity: 4284,
      allocatedAmount: 34914.6,
      allocatedCurrency: 'USD',
      allocationNote: 'Zdroj: proforma PI--26ML0611E370-Sheet1 2.pdf. Delivery time July 15, 2026; SHIPPED IN 2*40HC.',
      source: 'supplier_proforma_manual',
      portOfLoading: 'Qingdao, China',
      portOfDischarge: 'Czech Republic',
      rawNote: 'Delivery time July.15,2026; SHIPPED IN 2*40HC; FOB Qingdao.',
    },
  ],
  'Čína 16': [
    {
      keySuffix: 'quotation-2026-04-30-inlay',
      shipmentRef: 'Quotation Apr.30 2026',
      containersText: 'odhad 2x40GP',
      containerCount: 2,
      loadingMethod: 'floor_loaded',
      palletized: false,
      loadingSummary: 'Bez palet podle quotation: FOB painting price without pallets. Odhad 2x40GP vychází ze součtu qty / container loading qty per 40GP.',
      status: 'objednano',
      orderedDate: '2026-04-30',
      allocatedQuantity: 1860,
      allocatedAmount: 47721,
      allocatedCurrency: 'USD',
      allocationNote: 'Zdroj: screenshot quotation Image_20260611112915_488_5.png. KN tracking, B/L, CI/PI, packing list ani invoice zatím nejsou k dispozici.',
      source: 'supplier_quotation_manual',
      rawNote: 'Quotation for heavy version butterfly rackshelves - INLAY model; narrow upright 35+35mm, splitted upright; FOB painting price without pallets.',
    },
  ],
};

export const IMPORT_REFERENCE_KN_TRACKING = [
  {
    shipmentRef: '26ML224E',
    billOfLading: '1073423125',
    knTrackingNumber: '1073423125',
    supplierOrderCodes: '25ML1206E665',
    containersText: '2x40HC',
    etaPort: '2026-06-18',
    portOfLoading: 'Qingdao/CNTAO',
    portOfTransshipment: 'Ningbo/CNNGB',
    portOfDischarge: 'Bremerhaven/DEBRV',
    vesselName: 'MSC LIVORNO',
    voyageNo: 'GA617W',
    note: 'Samostatná Leagle sample/machine zásilka vedená jako Čína 6.',
  },
];

export const EXPECTED_IMPORT_AUDIT = {
  'Čína 6': { rows: 32, totalQty: 3903, missingPrices: 0 },
  'Čína 9': { rows: 32, totalQty: 5800 },
  'Čína 10': { rows: 24, totalQty: 10862 },
  'Čína 11': { rows: 39, totalQty: 7800, exactMatches: 39 },
  'Čína 12': { rows: 8, totalQty: 7530, exactMatches: 8 },
  'Čína 13': { rows: 13, totalQty: 2600, exactMatches: 13, qtyUnknown: 0, missingPrices: 0 },
  'Čína 14': { rows: 32, totalQty: 6400, missingPrices: 0, reviewRows: 32 },
  'Čína 15': { rows: 2, totalQty: 4284, missingPrices: 0, reviewRows: 0 },
  'Čína 16': { rows: 6, totalQty: 1860, missingPrices: 0, reviewRows: 6 },
};

export const MANUAL_IMPORT_LINE_MATCHES = {
  'Čína 10:6': '20090505875BLACK3',
  'Čína 10:14': '200120505875BLACK3',
  'Čína 10:23': '18090305875Z3',
  'Čína 10:24': '18090305875BLACK3',
  'Čína 10:25': '18090405875Z3',
  'Čína 10:26': '18090405875BLACK3',
  'Čína 15:1': '18090405875Z3',
  'Čína 15:2': '18090405875BLACK3',
};

const COLOR_TOKENS = ['BLACK', 'WHITE', 'BLUE', 'RED', 'BO', 'Z'];
const MARKET_ORDER = ['cz', 'sk', 'hu', 'ro'];

export const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value)
    .trim()
    .replace(/[^\d,.\-]/g, '')
    .replace(',', '.');
  if (!normalized || normalized === '-' || normalized === '.') return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

export const normalizeText = (value) => String(value ?? '').trim();

export const normalizeLookupText = (value) => normalizeText(value)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

export const normalizeCode = (value) => normalizeText(value)
  .toUpperCase()
  .replace(/\s+/g, '');

export const normalizeEan = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  const text = normalizeText(value);
  if (/^\d+\.0+$/.test(text)) return text.replace(/\.0+$/, '');
  return text.replace(/\s+/g, '');
};

export const normalizeOrderCode = (value) => {
  const text = normalizeText(value);
  if (normalizeLookupText(text) === normalizeLookupText('Čína 0526')) return 'Čína 13';
  return text;
};

export const supplierForCode = (supplierCode) => IMPORT_SUPPLIERS[Number(supplierCode)] || {
  supplierKey: `supplier-${supplierCode || 'unknown'}`,
  supplierCode: supplierCode == null ? null : Number(supplierCode),
  name: supplierCode ? `Dodavatel ${supplierCode}` : 'Neznámý dodavatel',
};

export const parseDimensions = (value) => {
  const raw = normalizeText(value);
  const numbers = [...raw.matchAll(/\d+(?:[.,]\d+)?/g)]
    .map((match) => toNumber(match[0]))
    .filter((number) => number != null);
  if (numbers.length < 3) return null;

  const hasCornerShape = raw.includes('/') && numbers.length >= 5;
  const picked = hasCornerShape
    ? [numbers[0], numbers[1], numbers[3]]
    : numbers.slice(0, 3);
  const multiplier = Math.max(...picked) <= 300 ? 10 : 1;
  const [heightMm, widthMm, depthMm] = picked.map((number) => Math.round(number * multiplier));

  return {
    heightMm,
    widthMm,
    depthMm,
    isCorner: hasCornerShape,
    raw,
  };
};

const parseCapacityAndShape = (numeric) => {
  for (const capacityLength of [4, 3]) {
    const widthLength = numeric.length - 3 - 2 - 1 - capacityLength;
    if (widthLength < 2 || widthLength > 3) continue;

    const heightMm = Number(numeric.slice(0, 3)) * 10;
    const widthMm = Number(numeric.slice(3, 3 + widthLength)) * 10;
    const depthStart = 3 + widthLength;
    const depthMm = Number(numeric.slice(depthStart, depthStart + 2)) * 10;
    const shelfCount = Number(numeric.slice(depthStart + 2, depthStart + 3));
    const capacityKg = Number(numeric.slice(-capacityLength));

    if (
      heightMm >= 1000
      && heightMm <= 3000
      && widthMm >= 300
      && widthMm <= 1600
      && depthMm >= 200
      && depthMm <= 1000
      && shelfCount >= 2
      && shelfCount <= 8
      && capacityKg >= 100
    ) {
      return { heightMm, widthMm, depthMm, shelfCount, capacityKg };
    }
  }

  return {};
};

export const parseRmCode = (value) => {
  const originalCode = normalizeCode(value);
  if (!originalCode) return null;

  let code = originalCode;
  const isCorner = code.endsWith('CORNER');
  if (isCorner) code = code.slice(0, -'CORNER'.length);

  const numericMatch = code.match(/^(\d+)/);
  if (!numericMatch) {
    return {
      code: originalCode,
      isCorner,
      color: null,
      supplierSuffix: null,
      parseStatus: 'no_numeric_prefix',
    };
  }

  const numeric = numericMatch[1];
  const rest = code.slice(numeric.length);
  const color = COLOR_TOKENS.find((token) => rest.includes(token)) || null;
  const supplierSuffixMatch = rest.match(/([123])(?=[A-Z]*$)/);
  const supplierSuffix = supplierSuffixMatch ? Number(supplierSuffixMatch[1]) : null;
  const parsedShape = parseCapacityAndShape(numeric);

  return {
    code: originalCode,
    ...parsedShape,
    color,
    supplierSuffix,
    isCorner,
    parseStatus: parsedShape.heightMm ? 'parsed' : 'shape_unknown',
  };
};

export const finishMatchRule = (value) => {
  const text = normalizeLookupText(value);
  if (!text) return { kind: 'unknown', color: null, label: '' };
  if (text.includes('galv') || text.includes('zink') || text === 'z') {
    return { kind: 'exact_color', color: 'Z', label: 'zinkované' };
  }
  if (text.includes('blue') && text.includes('orange')) {
    return { kind: 'exact_color', color: 'BO', label: 'modro-oranžové' };
  }
  if (text.includes('white') || text.includes('bile') || text.includes('bila')) {
    return { kind: 'exact_color', color: 'WHITE', label: 'bílé' };
  }
  if (text.includes('black') || text.includes('cerne') || text.includes('cerna')) {
    return { kind: 'exact_color', color: 'BLACK', label: 'černé' };
  }
  if (text.includes('paint') || text.includes('powder') || text.includes('lak')) {
    return { kind: 'painted', color: null, label: 'lakované/powder coated' };
  }
  return { kind: 'unknown', color: null, label: normalizeText(value) };
};

export const normalizeMasterProduct = (row) => {
  const code = normalizeCode(row.code);
  const parsedCode = parseRmCode(code);
  const dimensions = parseDimensions(row.spec || row.title);

  return {
    productKey: code || normalizeEan(row.ean),
    code,
    ean: normalizeEan(row.ean),
    title: normalizeText(row.title),
    activeEshop: row.activeEshop === true || row.activeEshop === 'TRUE' || row.activeEshop === 'true',
    weightKg: toNumber(row.weightKg),
    oldCode: normalizeText(row.oldCode),
    sourceSheet: normalizeText(row.sourceSheet),
    sourceRow: Number(row.sourceRow || 0) || null,
    heightMm: parsedCode?.heightMm ?? dimensions?.heightMm ?? null,
    widthMm: parsedCode?.widthMm ?? dimensions?.widthMm ?? null,
    depthMm: parsedCode?.depthMm ?? dimensions?.depthMm ?? null,
    shelfCount: parsedCode?.shelfCount ?? null,
    capacityKg: parsedCode?.capacityKg ?? null,
    color: parsedCode?.color ?? null,
    supplierSuffix: parsedCode?.supplierSuffix ?? null,
    isCorner: Boolean(parsedCode?.isCorner),
    rawRow: row.rawRow || {},
  };
};

const sourcePriority = (row) => {
  if (row.sourceSheet === 'MAIN') return 0;
  if (row.sourceSheet === 'Produkty') return 1;
  return 2;
};

const chooseBestMasterRow = (rows) => [...rows].sort((a, b) => {
  if (a.activeEshop !== b.activeEshop) return a.activeEshop ? -1 : 1;
  const sourceDiff = sourcePriority(a) - sourcePriority(b);
  if (sourceDiff !== 0) return sourceDiff;
  return (a.sourceRow || 999999) - (b.sourceRow || 999999);
})[0] || null;

const dedupeByCode = (rows) => {
  const byCode = new Map();
  for (const row of rows) {
    const key = row.code || row.ean || `${row.sourceSheet}:${row.sourceRow}`;
    if (!byCode.has(key)) byCode.set(key, []);
    byCode.get(key).push(row);
  }
  return Array.from(byCode.values()).map(chooseBestMasterRow).filter(Boolean);
};

export const buildProductMasterIndex = (masterRows = []) => {
  const normalizedRows = masterRows
    .map(normalizeMasterProduct)
    .filter((row) => row.code || row.ean);
  const byEanRows = new Map();
  const byCodeRows = new Map();

  for (const row of normalizedRows) {
    if (row.ean) {
      if (!byEanRows.has(row.ean)) byEanRows.set(row.ean, []);
      byEanRows.get(row.ean).push(row);
    }
    if (row.code) {
      if (!byCodeRows.has(row.code)) byCodeRows.set(row.code, []);
      byCodeRows.get(row.code).push(row);
    }
  }

  return {
    rows: normalizedRows,
    fallbackRows: dedupeByCode(normalizedRows),
    byEan: new Map(Array.from(byEanRows, ([ean, rows]) => [ean, chooseBestMasterRow(rows)])),
    byCode: new Map(Array.from(byCodeRows, ([code, rows]) => [code, chooseBestMasterRow(rows)])),
  };
};

const candidateSummary = (row) => ({
  code: row.code,
  ean: row.ean || null,
  title: row.title || null,
  sourceSheet: row.sourceSheet,
  sourceRow: row.sourceRow,
  color: row.color,
  capacityKg: row.capacityKg,
  activeEshop: row.activeEshop,
});

const makeMatch = ({ product = null, method, confidence, auditStatus = 'matched', reason = '', candidates = [] }) => ({
  matchedProduct: product,
  rmCode: product?.code || null,
  ean: product?.ean || null,
  method,
  confidence,
  auditStatus,
  reason,
  candidates: candidates.map(candidateSummary),
});

const fallbackCandidatesForLine = (line, masterIndex) => {
  const dims = line.dimensions || parseDimensions(line.spec);
  const shelfCount = toNumber(line.shelfCount);
  const supplierSuffix = line.supplierSuffix ?? line.supplierCode ?? null;
  if (!dims || !shelfCount || !supplierSuffix) return [];

  const steelThickness = toNumber(line.steelThicknessMm);
  const mdfThickness = toNumber(line.mdfThicknessMm);
  if (steelThickness != null && Math.abs(steelThickness - 0.55) > 0.001) return [];
  if (mdfThickness != null && Math.abs(mdfThickness - 4) > 0.001) return [];

  const finishRule = finishMatchRule(line.finish || line.color);
  let candidates = masterIndex.fallbackRows.filter((product) => (
    product.heightMm === dims.heightMm
    && product.widthMm === dims.widthMm
    && product.depthMm === dims.depthMm
    && product.shelfCount === shelfCount
    && product.supplierSuffix === Number(supplierSuffix)
    && Boolean(product.isCorner) === Boolean(dims.isCorner)
  ));

  if (finishRule.kind === 'exact_color') {
    candidates = candidates.filter((product) => product.color === finishRule.color);
  } else if (finishRule.kind === 'painted') {
    candidates = candidates.filter((product) => product.color && product.color !== 'Z');
  }

  return dedupeByCode(candidates);
};

export const normalizeImportLine = (line) => {
  const rmCode = normalizeCode(line.rmCode || line.code);
  const ean = normalizeEan(line.ean);
  const dimensions = line.dimensions || parseDimensions(line.spec || line.itemSpec);
  const parsedCode = parseRmCode(rmCode);

  return {
    ...line,
    rmCode,
    ean,
    dimensions,
    shelfCount: toNumber(line.shelfCount ?? line.layers ?? parsedCode?.shelfCount),
    steelThicknessMm: toNumber(line.steelThicknessMm ?? line.steelThickness),
    mdfThicknessMm: toNumber(line.mdfThicknessMm ?? line.mdfThickness),
    quantity: toNumber(line.quantity),
    unitPurchasePrice: toNumber(line.unitPurchasePrice),
    supplierSuffix: line.supplierSuffix ?? parsedCode?.supplierSuffix ?? line.supplierCode ?? null,
    finish: normalizeText(line.finish || line.color || line.surface),
  };
};

export const matchImportLine = (line, masterIndex) => {
  const normalizedLine = normalizeImportLine(line);

  if (normalizedLine.ean && masterIndex.byEan.has(normalizedLine.ean)) {
    return makeMatch({
      product: masterIndex.byEan.get(normalizedLine.ean),
      method: 'exact_ean',
      confidence: 1,
      reason: `EAN ${normalizedLine.ean} matched product master.`,
    });
  }

  if (normalizedLine.rmCode && masterIndex.byCode.has(normalizedLine.rmCode)) {
    return makeMatch({
      product: masterIndex.byCode.get(normalizedLine.rmCode),
      method: 'exact_rm_code',
      confidence: 0.98,
      reason: `RM code ${normalizedLine.rmCode} matched product master.`,
    });
  }

  if (!normalizedLine.allowFallbackMatch) {
    return makeMatch({
      method: 'unmatched',
      confidence: 0,
      auditStatus: 'review',
      reason: 'No exact EAN/RM code and fallback matching is disabled for this order.',
    });
  }

  const candidates = fallbackCandidatesForLine(normalizedLine, masterIndex);
  const dims = normalizedLine.dimensions;
  const dimLabel = dims ? `${dims.heightMm}x${dims.widthMm}x${dims.depthMm}` : 'unknown dimensions';
  const finishRule = finishMatchRule(normalizedLine.finish);

  if (candidates.length === 1) {
    return makeMatch({
      product: candidates[0],
      method: 'fallback_spec',
      confidence: 0.86,
      reason: `Fallback matched ${dimLabel}, ${normalizedLine.shelfCount} shelves, supplier suffix ${normalizedLine.supplierSuffix}, ${finishRule.label}.`,
      candidates,
    });
  }

  return makeMatch({
    method: candidates.length ? 'ambiguous_fallback' : 'unmatched_fallback',
    confidence: 0,
    auditStatus: 'review',
    reason: candidates.length
      ? `Fallback found ${candidates.length} candidates for ${dimLabel}; manual review required.`
      : `No product master candidate for ${dimLabel}, ${normalizedLine.shelfCount || '?'} shelves, supplier suffix ${normalizedLine.supplierSuffix || '?'}, ${finishRule.label || 'unknown finish'}.`,
    candidates,
  });
};

export const enrichImportOrdersWithMatches = (orders = [], masterRows = []) => {
  const masterIndex = buildProductMasterIndex(masterRows);
  return orders.map((order) => ({
    ...order,
    lines: (order.lines || []).map((line) => {
      const normalizedLine = normalizeImportLine({
        ...line,
        supplierCode: line.supplierCode ?? order.supplierCode,
        allowFallbackMatch: line.allowFallbackMatch ?? ['Čína 9', 'Čína 10'].includes(order.orderCode),
      });
      const manualMatchCode = MANUAL_IMPORT_LINE_MATCHES[`${order.orderCode}:${line.sourceRow}`];
      const manualProduct = manualMatchCode ? masterIndex.byCode.get(manualMatchCode) : null;
      const match = manualProduct
        ? makeMatch({
          product: manualProduct,
          method: 'manual_verified',
          confidence: 1,
          reason: `Manual logistics review selected ${manualMatchCode} for ${order.orderCode} row ${line.sourceRow}.`,
        })
        : matchImportLine(normalizedLine, masterIndex);
      return {
        ...normalizedLine,
        match,
        matchedProduct: match.matchedProduct,
        matchedCode: match.rmCode,
        matchedEan: match.ean,
        matchMethod: match.method,
        matchConfidence: match.confidence,
        auditStatus: normalizedLine.quantity == null && order.orderCode === 'Čína 13'
          ? 'qty_unknown'
          : match.auditStatus,
      };
    }),
  }));
};

export const auditImportOrders = (orders = []) => {
  const byOrder = {};

  for (const order of orders) {
    const lines = order.lines || [];
    const totalQty = lines.reduce((sum, line) => sum + (toNumber(line.quantity) || 0), 0);
    const qtyUnknown = lines.filter((line) => toNumber(line.quantity) == null).length;
    const matched = lines.filter((line) => line.match?.auditStatus === 'matched' || line.match?.matchedProduct).length;
    const exactMatches = lines.filter((line) => ['exact_ean', 'exact_rm_code'].includes(line.matchMethod || line.match?.method)).length;
    const fallbackMatches = lines.filter((line) => (line.matchMethod || line.match?.method) === 'fallback_spec').length;
    const reviewRows = lines.filter((line) => (line.match?.auditStatus || line.auditStatus) === 'review').length;
    const missingPrices = lines.filter((line) => toNumber(line.unitPurchasePrice) == null).length;

    byOrder[order.orderCode] = {
      orderCode: order.orderCode,
      sourceSheet: order.sourceSheet,
      rows: lines.length,
      totalQty: qtyUnknown === lines.length ? null : totalQty,
      qtyUnknown,
      matched,
      exactMatches,
      fallbackMatches,
      reviewRows,
      missingPrices,
      matchedPct: lines.length ? (matched / lines.length) * 100 : 0,
      expected: EXPECTED_IMPORT_AUDIT[order.orderCode] || null,
    };
  }

  return byOrder;
};

export const validateExpectedAudit = (audit) => {
  const failures = [];
  for (const [orderCode, expected] of Object.entries(EXPECTED_IMPORT_AUDIT)) {
    const actual = audit[orderCode];
    if (!actual) {
      failures.push(`${orderCode}: missing from audit`);
      continue;
    }
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (actual[key] !== expectedValue) {
        failures.push(`${orderCode}.${key}: expected ${expectedValue}, got ${actual[key]}`);
      }
    }
  }
  return failures;
};

export const allocateFreightByValue = (lines = [], totalFreight = 0) => {
  const freight = toNumber(totalFreight) || 0;
  const prepared = lines.map((line) => {
    const quantity = toNumber(line.quantity) || 0;
    const unitPurchasePrice = toNumber(line.unitPurchasePrice);
    const purchaseCurrency = line.purchaseCurrency || line.purchase_currency || line.currency || 'CZK';
    const unitPurchasePriceCzk = line.unitPurchasePriceCzk != null
      ? toNumber(line.unitPurchasePriceCzk)
      : convertImportUnitCostToCzk(unitPurchasePrice, purchaseCurrency);
    const lineGoodsValue = quantity > 0 && unitPurchasePriceCzk != null ? quantity * unitPurchasePriceCzk : null;
    return { ...line, quantity, unitPurchasePrice, purchaseCurrency, unitPurchasePriceCzk, lineGoodsValue };
  });
  const totalGoodsValue = prepared.reduce((sum, line) => sum + (line.lineGoodsValue || 0), 0);

  return prepared.map((line) => {
    if (!(line.quantity > 0) || !(line.lineGoodsValue > 0) || !(totalGoodsValue > 0)) {
      return {
        ...line,
        allocationShare: null,
        allocatedFreight: null,
        freightPerUnit: null,
        landedUnitCost: line.unitPurchasePriceCzk ?? null,
        landedUnitCostCzk: line.unitPurchasePriceCzk ?? null,
        landedCostStatus: line.unitPurchasePrice == null ? 'missing_purchase_price' : 'missing_fx_rate',
      };
    }

    const allocationShare = line.lineGoodsValue / totalGoodsValue;
    const allocatedFreight = freight * allocationShare;
    const freightPerUnit = allocatedFreight / line.quantity;
    return {
      ...line,
      allocationShare,
      allocatedFreight,
      freightPerUnit,
      landedUnitCost: line.unitPurchasePriceCzk + freightPerUnit,
      landedUnitCostCzk: line.unitPurchasePriceCzk + freightPerUnit,
      landedCostStatus: 'complete',
    };
  });
};

const getOrderMarket = (order) => String(order?.market || order?.raw_data?.language_id || 'unknown').toLowerCase();
const getOrderDate = (order) => order?.order_date || order?.created_at || order?.raw_data?.creation_time || null;

const addVelocityQuantity = (target, quantity, market) => {
  target.global += quantity;
  if (MARKET_ORDER.includes(market)) target.byMarket[market] += quantity;
};

export const buildSalesVelocity = (orders = [], { asOfDate = new Date(), windows = [7, 14, 30] } = {}) => {
  const asOf = new Date(asOfDate);
  const velocity = {};

  const ensureProduct = (identity) => {
    velocity[identity] ||= {};
    for (const days of windows) {
      velocity[identity][days] ||= {
        days,
        globalQty: 0,
        globalDaily: 0,
        byMarket: Object.fromEntries(MARKET_ORDER.map((market) => [market, { quantity: 0, daily: 0 }])),
      };
    }
    return velocity[identity];
  };

  for (const order of orders || []) {
    if (isExcludedBusinessOrder(order)) continue;
    const orderDateValue = getOrderDate(order);
    if (!orderDateValue) continue;
    const orderDate = new Date(orderDateValue);
    if (Number.isNaN(orderDate.getTime())) continue;
    const ageDays = Math.max(0, (asOf.getTime() - orderDate.getTime()) / 86400000);
    const market = getOrderMarket(order);

    for (const item of order.order_items || []) {
      const identity = normalizeCode(item.product_code || item.sku) || normalizeEan(item.ean);
      if (!identity) continue;
      const quantity = toNumber(item.quantity) || 0;
      if (!(quantity > 0)) continue;
      const productVelocity = ensureProduct(identity);
      for (const days of windows) {
        if (ageDays <= days) {
          productVelocity[days].globalQty += quantity;
          productVelocity[days].byMarket[market] ||= { quantity: 0, daily: 0 };
          productVelocity[days].byMarket[market].quantity += quantity;
        }
      }
    }
  }

  for (const productVelocity of Object.values(velocity)) {
    for (const days of windows) {
      const row = productVelocity[days];
      row.globalDaily = row.globalQty / days;
      for (const market of Object.keys(row.byMarket)) {
        row.byMarket[market].daily = row.byMarket[market].quantity / days;
      }
    }
  }

  return velocity;
};

export const growthAdjustedDailyDemand = (baseDailyDemand, dayIndex, monthlyGrowth = IMPORT_GROWTH_MONTHLY) => {
  const base = toNumber(baseDailyDemand) || 0;
  if (!(base > 0)) return 0;
  return base * ((1 + monthlyGrowth) ** (Math.max(0, dayIndex) / 30));
};

export const predictStockoutDate = ({
  currentStock = 0,
  inboundShipments = [],
  baseDailyDemand = 0,
  asOfDate = new Date(),
  monthlyGrowth = IMPORT_GROWTH_MONTHLY,
  horizonDays = 365,
} = {}) => {
  const asOf = new Date(asOfDate);
  let stock = toNumber(currentStock) || 0;
  const shipmentsByDay = new Map();

  for (const shipment of inboundShipments || []) {
    const qty = toNumber(shipment.quantity) || 0;
    if (!(qty > 0) || !shipment.etaDate) continue;
    const eta = new Date(shipment.etaDate);
    if (Number.isNaN(eta.getTime())) continue;
    const day = Math.max(0, Math.ceil((eta.getTime() - asOf.getTime()) / 86400000));
    shipmentsByDay.set(day, (shipmentsByDay.get(day) || 0) + qty);
  }

  for (let day = 0; day <= horizonDays; day += 1) {
    stock += shipmentsByDay.get(day) || 0;
    stock -= growthAdjustedDailyDemand(baseDailyDemand, day, monthlyGrowth);
    if (stock < 0) {
      const stockout = new Date(asOf);
      stockout.setDate(stockout.getDate() + day);
      return {
        date: stockout.toISOString().slice(0, 10),
        dayIndex: day,
        stockAtStockout: stock,
        monthlyGrowth,
      };
    }
  }

  return {
    date: null,
    dayIndex: null,
    stockAtStockout: stock,
    monthlyGrowth,
  };
};
