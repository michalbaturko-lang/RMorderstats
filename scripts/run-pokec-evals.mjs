#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { __pokecTestKit } from '../api/pokec.js';

const ROOT = process.cwd();
const EVALS_PATH = path.join(ROOT, 'src/ai/pokec-evals.json');

const {
  buildDailyBriefingQuestion,
  buildResponse,
  compareProductMix,
  detectIntent,
  inferRelativeDateRange,
  summarizeBundlesByDay,
  summarizeMargin,
  summarizeOrders,
  summarizeProducts,
} = __pokecTestKit;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function order({
  id,
  market,
  date,
  company = false,
  products,
  shipping = 0,
  status = 'Dokoncena',
}) {
  const orderItems = (products || []).map((item) => ({
    product_code: item.code || item.product_code || item.sku || '',
    product_name: item.title || item.product_name || item.name || '',
    quantity: item.quantity || 1,
    buy_price: item.buy_price,
    unit_price_without_vat: item.quantity ? item.price_without_vat / item.quantity : item.price_without_vat,
    total_price_without_vat: item.price_without_vat,
    vat_rate: item.vat_rate ?? null,
    sku: item.sku || item.code || item.product_code || '',
    ean: item.ean || null,
  }));

  return {
    id,
    market,
    order_date: `${date}T10:00:00+02:00`,
    status,
    order_items: orderItems,
    raw_data: {
      order_number: id,
      market,
      status,
      currency: { code: 'CZK' },
      customer: { company_yn: company },
      shipment: { price_without_vat: shipping },
      products,
    },
  };
}

function product({ code, title, quantity = 1, price, buyPrice }) {
  return {
    code,
    title,
    quantity,
    price_without_vat: price,
    buy_price: buyPrice,
  };
}

function makeComparison(currentOrders, previousOrders) {
  const currentProducts = summarizeProducts(currentOrders);
  const previousProducts = summarizeProducts(previousOrders);
  return {
    dateFrom: '2026-05-08',
    dateTo: '2026-05-14',
    orderSummary: summarizeOrders(previousOrders),
    marginSummary: summarizeMargin(previousOrders),
    productChanges: compareProductMix(currentProducts, previousProducts),
  };
}

function buildScenarioResponse({
  question,
  dateFrom,
  dateTo,
  market,
  intent,
  currentOrders,
  previousOrders = [],
  ads = null,
  adsCampaigns = null,
  metaSpend = null,
  metaCampaigns = null,
  adsSearchTerms = null,
  adsShoppingProducts = null,
  competitorChanges = null,
  landingPages = null,
  smallGaLandingPages = null,
  smallGaSessions = null,
  smallGaFunnel = null,
  freshness = null,
  knowledge = null,
  importLogistics = null,
  comparisonAdsCampaignMix = null,
  toolCalls = [],
  warnings = [],
  responseMode = 'question',
}) {
  const orders = currentOrders;
  const orderSummary = summarizeOrders(orders);
  const marginSummary = summarizeMargin(orders);
  const products = summarizeProducts(orders);
  const bundlesByDay = summarizeBundlesByDay(orders);
  const comparison = previousOrders.length ? makeComparison(currentOrders, previousOrders) : null;
  if (comparison && comparisonAdsCampaignMix) {
    comparison.adsCampaignMix = comparisonAdsCampaignMix;
  }

  return buildResponse({
    question,
    dateFrom,
    dateTo,
    market,
    intent,
    orders,
    orderSummary,
    marginSummary,
    products,
    bundlesByDay,
    ads,
    adsCampaigns,
    metaSpend,
    metaCampaigns,
    adsSearchTerms,
    adsShoppingProducts,
    competitorChanges,
    landingPages,
    smallGaLandingPages,
    smallGaSessions,
    smallGaFunnel,
    freshness,
    comparison,
    knowledge: knowledge || {
      topic: 'business',
      contexts: [],
      memories: [],
      examples: [],
      meetingNotes: [],
      experiments: [],
      openQuestions: [],
      dataQualityIssues: [],
    },
    importLogistics,
    toolCalls,
    warnings,
    responseMode,
  });
}

function flattenResponse(response) {
  const parts = [
    response.verdict,
    response.confidence,
    ...(response.facts || []),
    ...(response.hypotheses || []),
    ...(response.missingData || []),
    ...(response.nextSteps || []),
  ];

  for (const table of response.tables || []) {
    parts.push(table.title);
    parts.push(...(table.columns || []));
    for (const row of table.rows || []) {
      parts.push(...row.map((value) => String(value)));
    }
  }

  if (response.briefing) {
    parts.push(response.briefing.title);
    parts.push(response.briefing.summary);
    parts.push(...(response.briefing.highlights || []));
    parts.push(...(response.briefing.watchouts || []));
    parts.push(response.briefing.focusQuestion || '');
  }

  return parts.join('\n').toLowerCase();
}

function hasTable(response, title) {
  return (response.tables || []).some((table) => table.title === title);
}

function tableHasCell(response, title, snippet) {
  const target = snippet.toLowerCase();
  const table = (response.tables || []).find((item) => item.title === title);
  if (!table) return false;
  return table.rows.some((row) => row.some((cell) => String(cell).toLowerCase().includes(target)));
}

function baseToolCalls(extra = []) {
  return [
    { tool: 'get_orders_summary', status: 'ok', rows: 12 },
    { tool: 'get_margin_breakdown', status: 'ok', rows: 12 },
    { tool: 'get_product_mix', status: 'ok', rows: 6 },
    { tool: 'get_bundle_analysis', status: 'ok', rows: 2 },
    { tool: 'compare_periods', status: 'ok', rows: 12 },
    { tool: 'get_relevant_memories', status: 'ok', rows: 1 },
    ...extra,
  ];
}

function importLogisticsToolCalls(extra = []) {
  return baseToolCalls([
    { tool: 'get_import_orders_on_the_way', status: 'ok', rows: 5 },
    { tool: 'get_inbound_stock_risk', status: 'ok', rows: 2 },
    { tool: 'get_landed_cost_changes', status: 'ok', rows: 2 },
    { tool: 'get_import_match_gaps', status: 'ok', rows: 1 },
    { tool: 'get_import_document_coverage', status: 'ok', rows: 5 },
    { tool: 'get_import_order_detail', status: 'ok', rows: 1 },
    ...extra,
  ]);
}

function importLogisticsFixture() {
  const orders = ['Čína 9', 'Čína 10', 'Čína 11', 'Čína 12', 'Čína 13'].map((name, index) => ({
    import_order_id: `import-${index + 9}`,
    order_name: name,
    supplier: name === 'Čína 13' ? 'ABC China' : 'Leagle China',
    status: index < 2 ? 'shipped' : 'objednano',
    source_sheet: name === 'Čína 13' ? 'Čína 0526' : name,
    shipped_date: index < 2 ? '2026-05-20' : null,
    eta_port: `2026-06-${String(10 + index).padStart(2, '0')}`,
    eta_brno: `2026-06-${String(14 + index).padStart(2, '0')}`,
    containers: `CONT-${index + 1}`,
    container_count: name === 'Čína 10' ? 2 : null,
    container_loading: name === 'Čína 10' ? '26ML183E: na paletách' : '',
    loading_photo_count: name === 'Čína 10' ? 3 : 0,
    total_qty: name === 'Čína 13' ? null : [5800, 10862, 7800, 7530][index],
    matched_pct: name === 'Čína 10' ? 75 : 100,
    docs_coverage: { has_kn_invoice: false },
    missing_docs: ['supplier_invoice', 'kn_invoice'],
    missing_prices: name === 'Čína 12' ? 0 : 3,
    missing_freight_cost: true,
    risk_count: index === 0 ? 1 : 0,
    line_count: name === 'Čína 13' ? 13 : 8,
    review_line_count: name === 'Čína 10' ? 1 : 0,
    qty_unknown_line_count: name === 'Čína 13' ? 13 : 0,
  }));
  return {
    source: 'Supabase import logistics + Upgates stock/purchase prices + business-clean orders',
    intent: 'import_logistics_overview',
    orderName: '',
    orders,
    riskRows: [
      {
        sku: '18090405875Z3CORNER',
        ean: '859000000001',
        title: 'Corner shelf zinc',
        current_stock: 4,
        inbound_qty: 120,
        nearest_eta: '2026-06-14',
        inbound_orders: ['Čína 9'],
        velocity_7d: 2.1,
        velocity_14d: 1.8,
        velocity_30d: 1.5,
        forecast_stockout_date: '2026-06-03',
        stockout_before_eta: true,
        coverage_status: 'sufficient',
      },
      {
        sku: '22090405875BLACK3',
        ean: '859000000002',
        title: 'Black shelf',
        current_stock: null,
        inbound_qty: 80,
        nearest_eta: '2026-06-16',
        inbound_orders: ['Čína 10'],
        velocity_7d: 0,
        velocity_14d: 0,
        velocity_30d: 0,
        forecast_stockout_date: null,
        stockout_before_eta: false,
        coverage_status: 'insufficient',
      },
    ],
    landedCostChanges: [
      {
        order_name: 'Čína 12',
        supplier: 'Leagle China',
        sku: '18090405875Z3',
        ean: '859000000003',
        title: 'Zinc shelf',
        current_upgates_nc: 500,
        import_unit_cost: 460,
        allocated_freight_per_unit: 35,
        landed_unit_cost: 495,
        delta_abs: -5,
        delta_pct: -1,
        missing_import_price: false,
        missing_freight_cost: false,
        purchase_currency: 'CZK',
      },
      {
        order_name: 'Čína 13',
        supplier: 'ABC China',
        sku: 'NEW-SKU',
        ean: '859000000004',
        title: 'New incoming shelf',
        current_upgates_nc: 600,
        import_unit_cost: null,
        allocated_freight_per_unit: null,
        landed_unit_cost: null,
        delta_abs: null,
        delta_pct: null,
        missing_import_price: true,
        missing_freight_cost: true,
        purchase_currency: 'USD',
      },
    ],
    matchGaps: [
      {
        order_name: 'Čína 10',
        source_sheet: 'Čína 10',
        source_row: 17,
        raw_spec: 'Painting 2200x900x400 5 shelves',
        candidate_count: 2,
        match_status: 'ambiguous',
        reason: 'painted candidate ambiguity',
      },
    ],
    documentCoverage: orders.map((row) => ({
      order_name: row.order_name,
      has_supplier_invoice: false,
      has_packing_list: row.order_name === 'Čína 12',
      has_kn_invoice: false,
      has_bl_tracking: row.order_name === 'Čína 9',
      missing_docs: row.order_name === 'Čína 12' ? ['supplier_invoice', 'kn_invoice', 'bl_tracking'] : ['supplier_invoice', 'packing_list', 'kn_invoice'],
      parsed_status: 'no_documents',
      document_count: 0,
    })),
    detail: {
      order: orders[1],
      shipments: [
        {
          shipment_ref: '26ML183E',
          commercial_invoice_no: '26ML183E',
          containers_text: '2x40HC',
          container_count: 2,
          loading_method: 'palletized',
          palletized: true,
          loading_summary: '2 kontejnery 40HC naložené na paletách.',
          loading_photo_count: 3,
        },
      ],
      documents: [],
      lines: [
        {
          source_row: 8,
          sku: '18090405875Z3CORNER',
          ean: '859000000001',
          qty: 120,
          current_stock: 4,
          inbound_qty: 120,
          current_upgates_nc: 500,
          import_unit_cost: 460,
          landed_unit_cost: 495,
          purchase_currency: 'CZK',
          audit_status: 'matched',
          match_method: 'fallback',
        },
      ],
    },
    coverage: {
      checkedAt: '2026-05-27T10:00:00.000Z',
      source: 'Supabase import logistics views',
      views: [
        'import_logistics_order_overview',
        'import_logistics_sku_risk',
        'import_logistics_landed_cost_changes',
        'import_logistics_match_gaps',
        'import_logistics_document_coverage',
      ],
      orderCount: 5,
      orderNames: ['Čína 9', 'Čína 10', 'Čína 11', 'Čína 12', 'Čína 13'],
      missingPriceLines: 12,
      missingFreightOrders: 5,
      matchGapCount: 1,
      ordersMissingDocs: 5,
      loadingPhotoCount: 3,
      ordersWithLoadingPhotos: 1,
      qtyUnknownLines: 13,
      china13QtyUnknown: 13,
      riskySkuCount: 1,
      insufficientRiskRows: 1,
      velocityWindows: [7, 14, 30],
      monthlyGrowth: 0.2,
      businessCleanOrders: true,
    },
    warnings: [],
  };
}

function runCapabilitiesOverviewScenario() {
  const question = 'Co umíš a k jakým datům máš přístup?';
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'all',
    intent: 'capabilities_overview',
    currentOrders: [
      order({
        id: 'CZ-CAP-1',
        market: 'cz',
        date: '2026-05-20',
        products: [product({ code: '1809040', title: 'Regal 1800x900x400 mm', quantity: 1, price: 2200, buyPrice: 1100 })],
      }),
    ],
    ads: {
      total: { spend: 1200, clicks: 80, conversions: 1, conversionValue: 0 },
      byProvider: [{ provider: 'google_ads', spend: 1200, clicks: 80, conversions: 1, conversionValue: 0 }],
      topCampaigns: [],
      rows: [],
      campaignMix: [],
    },
    freshness: [
      { source: 'google_ads', status: 'fresh', lastSyncAt: '2026-05-21T10:00:00Z', note: 'ok' },
      { source: 'small_ga', status: 'unverified', lastSyncAt: null, note: 'tracker not verified' },
    ],
    knowledge: {
      topic: 'business',
      contexts: [{ title: 'Business definitions', confidence: 'high' }],
      memories: [],
      examples: [],
      meetingNotes: [],
      experiments: [],
      openQuestions: [],
      dataQualityIssues: [],
    },
    toolCalls: baseToolCalls([
      { tool: 'get_data_freshness', status: 'ok', rows: 2 },
      { tool: 'get_known_contexts', status: 'ok', rows: 1 },
    ]),
  });

  const text = flattenResponse(response);
  assert(response.evidence?.catalog?.sources?.length >= 3, 'Capabilities overview musi propsat katalog zdroju do evidence.');
  assert(hasTable(response, 'Co umím z jednotlivých zdrojů'), 'Capabilities overview musi obsahovat tabulku co umi ze zdroju.');
  assert(tableHasCell(response, 'Co umím z jednotlivých zdrojů', 'Google Ads'), 'Capabilities overview musi zminit Google Ads.');
  assert(text.includes('read-only'), 'Capabilities overview musi zminit read-only guardrail.');
  assert(text.includes('limit'), 'Capabilities overview musi zminit limity zdroju.');

  return { id: 'capabilities_overview', status: 'pass' };
}

function runTrustedBestPracticesScenario() {
  const question = 'Jaké důvěryhodné best practices máš pro optimalizaci konverzního poměru a Google Ads / Meta výkonu?';
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'all',
    intent: 'trusted_best_practices',
    currentOrders: [
      order({
        id: 'CZ-BP-1',
        market: 'cz',
        date: '2026-05-20',
        products: [product({ code: '1809040', title: 'Regal 1800x900x400 mm', quantity: 1, price: 2200, buyPrice: 1100 })],
      }),
    ],
    freshness: [
      { source: 'google_ads_campaign_sync', status: 'fresh', lastSyncAt: '2026-05-21T10:00:00Z', note: 'Google campaign sync ok' },
      { source: 'meta_ads_sync', status: 'missing', lastSyncAt: null, note: 'Meta token not approved yet' },
    ],
    knowledge: {
      topic: 'cro',
      contexts: [
        {
          topic: 'ads',
          title: 'Google Ads: message match and landing page relevance',
          body: 'Official Google guidance says search intent, ad promise and landing page relevance should match; otherwise efficiency and conversion quality suffer.',
          confidence: 'high',
          evidence: [{ source: 'Google Ads Help', url: 'https://support.google.com/google-ads/answer/6238826/optimising-your-ad-and-landing-page?hl=en-GB' }],
        },
        {
          topic: 'meta',
          title: 'Meta: sales optimization needs trustworthy purchase signal',
          body: 'Official Meta guidance says sales optimization depends on clean purchase events via Pixel or Conversions API and enough signal quality.',
          confidence: 'high',
          evidence: [{ source: 'Meta Business Help', url: 'https://www.facebook.com/business/help/AboutConversionsAPI' }],
        },
        {
          topic: 'cro',
          title: 'Baymard: homepage and category UX shapes product discovery',
          body: 'Baymard research shows that homepage and category UX strongly influence users ability to understand range, compare options and move to product pages.',
          confidence: 'high',
          evidence: [{ source: 'Baymard Institute', url: 'https://baymard.com/research/homepage-and-category-usability' }],
        },
        {
          topic: 'business',
          title: 'Regal Master storefront pushes price stock and multipacks',
          body: 'Across Regal storefronts the visible pattern is price, stock, dispatch speed and multipack pushes; this can help conversion and turnover but can also pull AOV down if cheap entry SKUs dominate.',
          confidence: 'high',
          evidence: [{ source: 'Internal storefront walkthrough', url: 'internal://storefront-walkthrough' }],
        },
      ],
      memories: [],
      examples: [
        {
          title: 'Trusted doctrine first, Regal proof second',
          required_playbooks: ['trusted_best_practices'],
          must_include: ['Google Ads', 'Meta', 'Baymard'],
        },
      ],
      meetingNotes: [],
      experiments: [],
      openQuestions: [],
      dataQualityIssues: [],
    },
    toolCalls: baseToolCalls([
      { tool: 'get_known_contexts', status: 'ok', rows: 4 },
      { tool: 'get_relevant_examples', status: 'ok', rows: 1 },
      { tool: 'get_data_freshness', status: 'ok', rows: 2 },
    ]),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Trusted doctrine'), 'Trusted best practices scenario musi obsahovat tabulku trusted doctrine.');
  assert(hasTable(response, 'Co už je potvrzené u Regal Master'), 'Trusted best practices scenario musi obsahovat tabulku lokalne potvrzenych signalu.');
  assert(text.includes('google ads'), 'Trusted best practices scenario musi zminit Google Ads.');
  assert(text.includes('meta'), 'Trusted best practices scenario musi zminit Meta.');
  assert(text.includes('baymard'), 'Trusted best practices scenario musi zminit Baymard.');
  assert(text.includes('best practice sama o sobě není důkaz'.toLowerCase()) || text.includes('best practice sama o sobe neni dukaz'), 'Trusted best practices scenario musi oddelit doctrine od dukazu.');
  assert(text.includes('regal master'), 'Trusted best practices scenario musi zminit Regal Master lokalni validaci.');

  return { id: 'trusted_best_practices', status: 'pass' };
}

function runKnowledgeReviewScenario() {
  const question = 'Jaké nejdůležitější znalosti o našem businessu si teď neseš ke schválení?';
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'all',
    intent: 'knowledge_review',
    currentOrders: [
      order({
        id: 'CZ-KR-1',
        market: 'cz',
        date: '2026-05-20',
        products: [product({ code: '18090405875BLACK1', title: 'Regál 1800x900x400 mm lakovaný 5-policový, nosnost 875 kg - černý', quantity: 1, price: 2200, buyPrice: 1260 })],
      }),
    ],
    freshness: [
      { source: 'google_ads', status: 'fresh', lastSyncAt: '2026-05-21T10:00:00Z', note: 'ok' },
    ],
    knowledge: {
      topic: 'business',
      contexts: [
        { title: 'Three month priority: maximize turnover and clear warehouse', body: 'Next three months prioritize revenue and stock rotation over margin optimization.', topic: 'business_goals', confidence: 'high' },
        { title: 'Healthy AOV thresholds', body: 'Healthy AOV starts at 2 000 CZK plus VAT and shipping; 2 200+ is very good.', topic: 'aov', confidence: 'high' },
        { title: 'Top sellers 180x90 families', body: '1800x900x400 and 1800x900x300 can be traffic magnets and margin risks.', topic: 'products', confidence: 'high' },
        { title: 'All four shops should carry the same core assortment', body: 'Assortment gaps are operational alarms first.', topic: 'markets', confidence: 'high' },
      ],
      memories: [
        { title: 'B2B customers are strategically preferable', topic: 'b2b', confidence: 'high' },
      ],
      examples: [
        { title: 'AOV review must not skip landing pages', trigger_patterns: ['aov'], expected_behavior: ['check landing pages', 'separate hypothesis from proof'] },
      ],
      meetingNotes: [],
      experiments: [],
      openQuestions: [
        { title: 'How much AOV do we lose from 2000/2200 mm stock-outs?', topic: 'products', priority: 'high' },
      ],
      dataQualityIssues: [],
    },
    toolCalls: baseToolCalls([
      { tool: 'get_known_contexts', status: 'ok', rows: 4 },
      { tool: 'get_relevant_memories', status: 'ok', rows: 1 },
      { tool: 'get_relevant_examples', status: 'ok', rows: 1 },
      { tool: 'get_open_questions', status: 'ok', rows: 1 },
      { tool: 'get_data_freshness', status: 'ok', rows: 1 },
    ]),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Nejdůležitější business pravdy ke schválení'), 'Knowledge review musi obsahovat tabulku schvalovanych business pravd.');
  assert(hasTable(response, 'Co ještě neumím dost jistě'), 'Knowledge review musi obsahovat otevrene otazky.');
  assert(text.includes('knowledge layer'), 'Knowledge review musi mluvit o knowledge layer.');
  assert(text.includes('schval') || text.includes('odsouhlas'), 'Knowledge review musi pusobit jako schvalovaci checklist.');

  return { id: 'knowledge_review', status: 'pass' };
}

function runAssortmentStrategyScenario() {
  const question = 'Ktere produktove rodiny mame tlacit a ktere nam jen vozi levny traffic?';
  const currentOrders = [
    order({
      id: 'CZ-AS-1',
      market: 'cz',
      date: '2026-05-20',
      products: [product({ code: '18090405875BLACK1', title: 'Regál 1800x900x400 mm lakovaný 5-policový, nosnost 875 kg - černý', quantity: 2, price: 2200, buyPrice: 1260 })],
    }),
    order({
      id: 'CZ-AS-2',
      market: 'cz',
      date: '2026-05-20',
      products: [product({ code: '18090305875ZI', title: 'Regál 1800x900x300 mm zinkovaný 5-policový, nosnost 875 kg', quantity: 1, price: 1350, buyPrice: 760 })],
    }),
    order({
      id: 'CZ-AS-3',
      market: 'cz',
      date: '2026-05-21',
      products: [product({ code: '2201005061050ZI', title: 'Regál 2200x1000x500 mm zinkovaný 6-policový, nosnost 1050 kg', quantity: 1, price: 5200, buyPrice: 2100 })],
    }),
    order({
      id: 'CZ-AS-4',
      market: 'cz',
      date: '2026-05-21',
      products: [product({ code: '1801205041200BLACK2', title: 'Regál 1800x1200x500 mm profesionální 4-policový, nosnost 1200 kg - černý', quantity: 1, price: 6100, buyPrice: 2350 })],
    }),
    order({
      id: 'CZ-AS-5',
      market: 'cz',
      date: '2026-05-21',
      products: [product({ code: '18090405875BLACK1_5', title: 'Regál 1800x900x400 mm lakovaný 5-policový, nosnost 875 kg - černý - 5ks', quantity: 1, price: 9800, buyPrice: 5250 })],
    }),
  ];
  const previousOrders = [
    order({
      id: 'CZ-ASP-1',
      market: 'cz',
      date: '2026-05-13',
      products: [product({ code: '18090405875BLACK1', title: 'Regál 1800x900x400 mm lakovaný 5-policový, nosnost 875 kg - černý', quantity: 1, price: 2300, buyPrice: 1260 })],
    }),
    order({
      id: 'CZ-ASP-2',
      market: 'cz',
      date: '2026-05-13',
      products: [product({ code: '18090305875ZI', title: 'Regál 1800x900x300 mm zinkovaný 5-policový, nosnost 875 kg', quantity: 2, price: 1400, buyPrice: 760 })],
    }),
  ];

  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'cz',
    intent: 'assortment_strategy',
    currentOrders,
    previousOrders,
    knowledge: {
      topic: 'products',
      contexts: [
        { title: 'Top-selling size families are 1800x900x400 and 1800x900x300', body: 'These families can be strong traffic magnets but dangerous for AOV and margin if they dominate too much.', confidence: 'high' },
        { title: 'Products with 2000 mm and 2200 mm heights can be understocked', body: 'Missing stock can hide demand and distort AOV or mix conclusions.', confidence: 'high' },
      ],
      memories: [],
      examples: [],
      meetingNotes: [],
      experiments: [],
      openQuestions: [],
      dataQualityIssues: [],
    },
    toolCalls: baseToolCalls([
      { tool: 'get_known_contexts', status: 'ok', rows: 2 },
    ]),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Assortment roles'), 'Assortment strategy scenario musi obsahovat tabulku assortment roles.');
  assert(hasTable(response, 'Produktové rodiny'), 'Assortment strategy scenario musi obsahovat tabulku produktovych rodin.');
  assert(hasTable(response, 'Rozměrové laddery'), 'Assortment strategy scenario musi obsahovat tabulku rozmerovych ladderu.');
  assert(hasTable(response, 'Finish a pack-size'), 'Assortment strategy scenario musi obsahovat tabulku finish a pack-size.');
  assert(text.includes('traffic driver'), 'Assortment strategy scenario musi rozlisit traffic driver roli.');
  assert(text.includes('margin') || text.includes('marž'), 'Assortment strategy scenario musi napojit sortiment na marzi.');
  assert(text.includes('stock-out') || text.includes('supply constrained') || text.includes('stock-sensitive'), 'Assortment strategy scenario musi priznat stock/supply caveat.');
  assert(text.includes('bundle'), 'Assortment strategy scenario musi zohlednit balicky.');

  return { id: 'assortment_strategy', status: 'pass' };
}

function runStorefrontWalkthroughScenario() {
  const question = 'Co je potvrzeně vidět na shopu a co je jen hypotéza?';
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'all',
    intent: 'storefront_walkthrough',
    currentOrders: [
      order({
        id: 'CZ-SF-1',
        market: 'cz',
        date: '2026-05-20',
        products: [product({ code: '18090405875BLACK1', title: 'Regál 1800x900x400 mm lakovaný 5-policový, nosnost 875 kg - černý', quantity: 1, price: 2200, buyPrice: 1180 })],
      }),
    ],
    landingPages: [
      { landingPage: 'https://vyprodej-regalu.cz/', pageType: 'hp', spend: 2200, clicks: 180 },
    ],
    smallGaLandingPages: [
      { landingPage: 'https://vyprodej-regalu.cz/', pageType: 'hp', channelBucket: 'paid', sessions: 240 },
    ],
    freshness: [
      { source: 'google_ads', status: 'fresh', lastSyncAt: '2026-05-21T10:00:00Z', note: 'ok' },
      { source: 'small_ga', status: 'fresh', lastSyncAt: '2026-05-21T10:05:00Z', note: 'ok' },
    ],
    knowledge: {
      topic: 'storefront',
      contexts: [
        {
          title: 'Storefront homepages emphasize price, stock and speed',
          body: 'Across the country storefronts the visible pattern is strongly commercial: bestseller modules, strong sale framing, in-stock messaging, fast dispatch promises and lowest price guarantee language.',
          topic: 'storefront',
          confidence: 'high',
          evidence: [{ source: 'public storefront walkthrough', date: '2026-05-23', sites: ['vyprodej-regalu.cz', 'vypredaj-regalov.sk'] }],
        },
        {
          title: 'All four shops should carry the same core assortment',
          body: 'Assortment gaps are usually a sign of product outage, sync error or availability issue rather than a country-specific assortment strategy.',
          topic: 'markets',
          confidence: 'high',
          evidence: [{ source: 'owner_input', date: '2026-05-23' }],
        },
      ],
      memories: [],
      examples: [],
      meetingNotes: [],
      experiments: [],
      openQuestions: [],
      dataQualityIssues: [],
    },
    toolCalls: baseToolCalls([
      { tool: 'get_known_contexts', status: 'ok', rows: 2 },
      { tool: 'get_ads_landing_pages', status: 'ok', rows: 1 },
      { tool: 'get_small_ga_landing_pages', status: 'ok', rows: 1 },
      { tool: 'get_data_freshness', status: 'ok', rows: 2 },
    ]),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Potvrzené storefront signály'), 'Storefront walkthrough musi obsahovat tabulku potvrzenych storefront signalu.');
  assert(text.includes('storefront walkthrough') || text.includes('merchandising kontext'), 'Storefront walkthrough musi oddelit storefront kontext od ciste datove analyzy.');
  assert(text.includes('vizuální') || text.includes('screenshot') || text.includes('browser'), 'Storefront walkthrough musi zminit vizualni evidenci nebo jeji limit.');
  assert(text.includes('sortiment'), 'Storefront walkthrough musi reflektovat sortimentni guardrail.');

  return { id: 'storefront_walkthrough', status: 'pass' };
}

function runShippingRevenueScenario() {
  const question = 'Kolik jsme vybrali na poštovném a doběrečném?';
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'all',
    intent: 'shipping_revenue',
    currentOrders: [
      order({
        id: 'CZ-SH-1',
        market: 'cz',
        date: '2026-05-20',
        shipping: 120,
        products: [product({ code: '1809040', title: 'Regal 1800x900x400 mm', quantity: 1, price: 2200, buyPrice: 1100 })],
      }),
      order({
        id: 'RO-SH-1',
        market: 'ro',
        date: '2026-05-21',
        shipping: 89,
        products: [product({ code: '1809030', title: 'Raft 1800x900x300 mm', quantity: 1, price: 1350, buyPrice: 760 })],
      }),
    ],
    previousOrders: [
      order({
        id: 'CZ-SH-P1',
        market: 'cz',
        date: '2026-05-12',
        shipping: 99,
        products: [product({ code: '1809040', title: 'Regal 1800x900x400 mm', quantity: 1, price: 2200, buyPrice: 1100 })],
      }),
    ],
    toolCalls: baseToolCalls([
      { tool: 'get_shipping_revenue', status: 'ok', rows: 2 },
    ]),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Tržba z poštovného po dnech'), 'Shipping revenue musi obsahovat rozpad po dnech.');
  assert(hasTable(response, 'Tržba z poštovného podle země'), 'Shipping revenue musi obsahovat rozpad podle zeme.');
  assert(hasTable(response, 'Pokrytí zdrojů'), 'Shipping revenue musi obsahovat tabulku pokryti zdroju.');
  assert(text.includes('mimo obrat zboží') || text.includes('mimo obrat zbozi'), 'Shipping revenue musi oddelit postovne od obratu zbozi.');
  assert(text.includes('mimo pno') || text.includes('pnо') || text.includes('pno'), 'Shipping revenue musi zminit vazbu mimo PNO nebo explicitni oddeleni.');
  return { id: 'shipping_revenue', status: 'pass' };
}

function runDailyBriefingScenario() {
  const question = buildDailyBriefingQuestion('2026-05-15', '2026-05-21', 'all');
  const currentOrders = [
    order({
      id: 'CZ-1',
      market: 'cz',
      date: '2026-05-20',
      company: true,
      shipping: 120,
      products: [product({ code: '1809040', title: 'Regal 1800x900x400 mm', quantity: 2, price: 2400, buyPrice: 1100 })],
    }),
    order({
      id: 'HU-1',
      market: 'hu',
      date: '2026-05-20',
      products: [product({ code: '1809030', title: 'Polc 1800x900x300 mm', quantity: 1, price: 1350, buyPrice: 760 })],
    }),
    order({
      id: 'RO-1',
      market: 'ro',
      date: '2026-05-21',
      products: [product({ code: '1507030_5', title: 'Raft 1500x700x300 5 ks', quantity: 1, price: 4100, buyPrice: 2200 })],
    }),
  ];
  const previousOrders = [
    order({
      id: 'CZ-P1',
      market: 'cz',
      date: '2026-05-12',
      company: true,
      products: [product({ code: '1809040', title: 'Regal 1800x900x400 mm', quantity: 1, price: 2600, buyPrice: 1200 })],
    }),
    order({
      id: 'HU-P1',
      market: 'hu',
      date: '2026-05-12',
      products: [product({ code: '1809030', title: 'Polc 1800x900x300 mm', quantity: 1, price: 1800, buyPrice: 820 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'all',
    intent: 'daily_briefing',
    currentOrders,
    previousOrders,
    ads: {
      total: { spend: 22800, clicks: 1100, conversions: 18, conversionValue: 0 },
      byProvider: [
        { provider: 'google_ads', spend: 18000, clicks: 900, conversions: 12, conversionValue: 0 },
        { provider: 'meta_ads', spend: 4800, clicks: 200, conversions: 6, conversionValue: 0 },
      ],
      topCampaigns: [{ provider: 'google_ads', market: 'hu', campaign: 'HU Search Top', spend: 8200, clicks: 300 }],
      rows: [],
    },
    metaSpend: {
      total: { spend: 4800, clicks: 200, conversions: 6, conversionValue: 0 },
      rows: [{ campaign_id: 'm1' }],
      campaignCount: 1,
    },
    metaCampaigns: [
      { market: 'ro', campaign: 'RO Meta Prospecting', status: 'ACTIVE', spend: 3200, clicks: 140 },
    ],
    landingPages: [
      { pageType: 'category', landingPage: 'https://regalmaster.hu/polcok', spend: 9200, clicks: 280 },
    ],
    smallGaLandingPages: [
      { channelBucket: 'paid', pageType: 'category', landingPage: 'https://regalmaster.hu/polcok', sessions: 180, cartRatePct: 8.3, purchaseRatePct: 2.2, purchaseEvents: 4, topCampaign: 'HU Search Shelves' },
    ],
    smallGaSessions: {
      totalSessions: 420,
      totalEvents: 1680,
      cartRatePct: 7.4,
      purchaseRatePct: 2.1,
      topSources: [{ channelBucket: 'paid', source: 'google', medium: 'cpc', campaign: 'HU Search Shelves', sessions: 210, events: 640, cartRatePct: 8.1, purchaseRatePct: 2.4 }],
    },
    smallGaFunnel: {
      totalSessions: 420,
      addToCartRatePct: 9.3,
      cartRatePct: 7.4,
      checkoutRatePct: 3.8,
      purchaseRatePct: 2.1,
      checkoutCompletionPct: 55.3,
      cartToPurchasePct: 28.4,
      topSources: [
        { channelBucket: 'paid', source: 'google', medium: 'cpc', campaign: 'HU Search Shelves', sessions: 210, addToCartRatePct: 10.1, checkoutRatePct: 4.2, purchaseRatePct: 2.4, checkoutCompletionPct: 57.1 },
      ],
      topLandingPages: [
        { channelBucket: 'paid', pageType: 'category', landingPage: 'https://regalmaster.hu/polcok', sessions: 180, addToCartRatePct: 8.9, checkoutRatePct: 3.5, purchaseRatePct: 2.2, checkoutCompletionPct: 62.9 },
      ],
      carts: { available: true, count: 21, abandonedPct: 42.9, recoveredPct: 9.5 },
      purchases: { available: true, count: 8, avgValueCzk: 3120, topPaymentMethods: [{ method: 'Card', count: 4 }] },
    },
    freshness: [
      { source: 'google_ads_campaign_sync', status: 'fresh', lastSyncAt: '2026-05-21T08:00:00Z', note: 'ok' },
      { source: 'meta_ads_sync', status: 'fresh', lastSyncAt: '2026-05-21T08:10:00Z', note: 'ok' },
    ],
    knowledge: {
      topic: 'business',
      contexts: [{ title: 'May pricing context', confidence: 'high' }],
      memories: [{ title: 'AOV usually follows product mix', confidence: 'high' }],
      examples: [{ title: 'AOV drop HU example', required_playbooks: ['aov_drop'], must_include: ['produktový mix', 'landing pages'] }],
      meetingNotes: [{ meeting_date: '2026-05-20', title: 'Growth sync', summary: 'Resili jsme mix trafficu a landing pages.' }],
      experiments: [{ title: 'HU HP vs category routing', status: 'running', hypothesis: 'HP routing snizuje AOV.' }],
      openQuestions: [{ title: 'Check firm traffic quality', priority: 'high' }],
      dataQualityIssues: [],
    },
    toolCalls: baseToolCalls([
      { tool: 'get_ads_spend', status: 'ok', rows: 18 },
      { tool: 'get_data_freshness', status: 'ok', rows: 2 },
      { tool: 'get_ads_landing_pages', status: 'ok', rows: 1 },
      { tool: 'get_small_ga_landing_pages', status: 'ok', rows: 1 },
      { tool: 'get_small_ga_sessions', status: 'ok', rows: 1 },
      { tool: 'get_small_ga_funnel', status: 'ok', rows: 1 },
      { tool: 'get_meta_spend', status: 'ok', rows: 1 },
      { tool: 'get_meta_campaigns', status: 'ok', rows: 1 },
    ]),
    responseMode: 'daily_briefing',
  });

  const text = flattenResponse(response);
  assert(response.briefing, 'Denni briefing musi mit briefing block.');
  assert(hasTable(response, 'Playbook checklist'), 'Denni briefing musi obsahovat playbook checklist.');
  assert(tableHasCell(response, 'Playbook checklist', 'guardrail:summary_metrics'), 'Denni briefing musi v checklistu vyhodnotit must-not-skip guardraily.');
  assert(hasTable(response, 'Použitý playbook a zdroje'), 'Denni briefing musi obsahovat snapshot playbooku a zdroju.');
  assert(hasTable(response, 'Dostupné datové zdroje pro tuto diagnózu'), 'Denni briefing musi obsahovat dostupne datove zdroje.');
  assert(tableHasCell(response, 'Dostupné datové zdroje pro tuto diagnózu', 'Google Ads'), 'Denni briefing musi propsat Google Ads jako zdroj.');
  assert(hasTable(response, 'Schválené příklady chování'), 'Denni briefing musi umet ukazat schvalene priklady chovani.');
  assert(hasTable(response, 'Relevantní meeting notes'), 'Denni briefing musi umet ukazat relevantni meeting notes.');
  assert(hasTable(response, 'Související experimenty'), 'Denni briefing musi umet ukazat souvisejici experimenty.');
  assert(hasTable(response, 'Small GA source / medium'), 'Denni briefing musi obsahovat small GA source/medium funnel tabulku.');
  assert(hasTable(response, 'Small GA commerce signals'), 'Denni briefing musi obsahovat small GA commerce summary.');
  assert(text.includes('aov'), 'Denni briefing musi zminovat AOV.');
  assert(text.includes('marže') || text.includes('hrubý zisk'), 'Denni briefing musi zminovat marzi.');
  assert(text.includes('co bych řešil jako první'.toLowerCase()) || response.briefing.focusQuestion, 'Denni briefing musi dat prvni fokus.');

  return { id: 'daily_briefing_summary', status: 'pass' };
}

function runAovDropScenario() {
  const question = 'Proc se v HU v poslednim tydnu propadla prumerna hodnota objednavky?';
  const currentOrders = [
    order({
      id: 'HU-11',
      market: 'hu',
      date: '2026-05-18',
      products: [product({ code: '1809030', title: 'Polc 1800x900x300 mm', quantity: 1, price: 1200, buyPrice: 710 })],
    }),
    order({
      id: 'HU-12',
      market: 'hu',
      date: '2026-05-19',
      products: [product({ code: '1809040', title: 'Polc 1800x900x400 mm', quantity: 1, price: 1380, buyPrice: 800 })],
    }),
  ];
  const previousOrders = [
    order({
      id: 'HU-P11',
      market: 'hu',
      date: '2026-05-11',
      company: true,
      products: [product({ code: '2009040', title: 'Polc 2000x900x400 mm', quantity: 2, price: 3600, buyPrice: 1900 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'hu',
    intent: detectIntent(question),
    currentOrders,
    previousOrders,
    ads: {
      total: { spend: 15000, clicks: 680, conversions: 8, conversionValue: 0 },
      byProvider: [{ provider: 'google_ads', spend: 15000, clicks: 680, conversions: 8, conversionValue: 0 }],
      topCampaigns: [{ provider: 'google_ads', market: 'hu', campaign: 'HU Search Shelves', spend: 7000, clicks: 250 }],
      rows: [],
    },
    landingPages: [
      { pageType: 'category', landingPage: 'https://regalmaster.hu/polcok', spend: 8200, clicks: 240 },
      { pageType: 'product', landingPage: 'https://regalmaster.hu/polcok/1800x900x300', spend: 4700, clicks: 150 },
    ],
    smallGaLandingPages: [
      { channelBucket: 'paid', pageType: 'hp', landingPage: 'https://regalmaster.hu/', sessions: 140, cartRatePct: 4.3, purchaseRatePct: 1.1, purchaseEvents: 2, topCampaign: 'HU Search Shelves' },
      { channelBucket: 'paid', pageType: 'product', landingPage: 'https://regalmaster.hu/polcok/1800x900x300', sessions: 60, cartRatePct: 9.5, purchaseRatePct: 3.2, purchaseEvents: 2, topCampaign: 'HU Shopping 1800x900x300' },
    ],
    smallGaSessions: {
      totalSessions: 260,
      totalEvents: 920,
      cartRatePct: 6.8,
      purchaseRatePct: 1.9,
      topSources: [{ channelBucket: 'paid', source: 'google', medium: 'cpc', campaign: 'HU Search Shelves', sessions: 180, events: 500, cartRatePct: 7.5, purchaseRatePct: 2.0 }],
    },
    freshness: [{ source: 'small_ga_ingestion', status: 'fresh', lastSyncAt: '2026-05-21T07:30:00Z', note: 'ok' }],
    knowledge: {
      topic: 'aov',
      contexts: [{ title: 'AOV follows product mix', confidence: 'high' }],
      memories: [{ title: 'Cheaper shelves dominate when paid goes to HP', confidence: 'medium' }],
      openQuestions: [],
      dataQualityIssues: [],
    },
    toolCalls: baseToolCalls([
      { tool: 'get_ads_spend', status: 'ok', rows: 6 },
      { tool: 'get_ads_landing_pages', status: 'ok', rows: 2 },
      { tool: 'get_small_ga_landing_pages', status: 'ok', rows: 2 },
      { tool: 'get_small_ga_sessions', status: 'ok', rows: 1 },
      { tool: 'get_data_freshness', status: 'ok', rows: 1 },
    ]),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Top produktový mix'), 'AOV drop musi obsahovat produktovy mix.');
  assert(hasTable(response, 'Objednávky podle hodnotových bucketů'), 'AOV drop musi obsahovat hodnotove buckety objednavek.');
  assert(hasTable(response, 'Objednávky podle počtu kusů'), 'AOV drop musi obsahovat bucket rozpad podle poctu kusu.');
  assert(hasTable(response, 'Top Ads landing pages'), 'AOV drop musi obsahovat Ads landing pages.');
  assert(hasTable(response, 'Top small GA landing pages'), 'AOV drop musi obsahovat small GA landing pages.');
  assert(hasTable(response, 'Změna produktového mixu vs předchozí období'), 'AOV drop musi obsahovat srovnani mixu s minulym obdobim.');
  assert(text.includes('landing pages'), 'AOV drop musi explicitne zminit landing pages.');
  assert(text.includes('produktového mixu') || text.includes('produktový mix'), 'AOV drop musi zminit produktovy mix.');
  assert(text.includes('hodnotový bucket') || text.includes('hodnotovy bucket') || text.includes('velikost objednávky') || text.includes('velikost objednavky'), 'AOV drop musi slovne pracovat s bucket rozkladem AOV.');

  return { id: 'aov_drop_hu', status: 'pass' };
}

function runHighPnoScenario() {
  const question = 'Proc je v RO PNO tak vysoke?';
  const currentOrders = [
    order({
      id: 'RO-11',
      market: 'ro',
      date: '2026-05-20',
      products: [product({ code: '1809030', title: 'Raft 1800x900x300 mm', quantity: 1, price: 1250, buyPrice: 740 })],
    }),
    order({
      id: 'RO-12',
      market: 'ro',
      date: '2026-05-20',
      products: [product({ code: '1809040', title: 'Raft 1800x900x400 mm', quantity: 1, price: 1490, buyPrice: 860 })],
    }),
  ];
  const previousOrders = [
    order({
      id: 'RO-P11',
      market: 'ro',
      date: '2026-05-13',
      products: [product({ code: '1809040', title: 'Raft 1800x900x400 mm', quantity: 2, price: 1850, buyPrice: 920 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'ro',
    intent: detectIntent(question),
    currentOrders,
    previousOrders,
    ads: {
      total: { spend: 18000, clicks: 900, conversions: 5, conversionValue: 0 },
      byProvider: [
        { provider: 'google_ads', spend: 14000, clicks: 720, conversions: 3, conversionValue: 0 },
        { provider: 'meta_ads', spend: 4000, clicks: 180, conversions: 2, conversionValue: 0 },
      ],
      campaignMix: [
        { bucket: 'search', spend: 9800, sharePct: 70 },
        { bucket: 'shopping', spend: 2800, sharePct: 20 },
        { bucket: 'pmax', spend: 1400, sharePct: 10 },
      ],
      topCampaigns: [
        { provider: 'google_ads', market: 'ro', campaign: 'RO Search Top', spend: 9800, clicks: 420 },
        { provider: 'meta_ads', market: 'ro', campaign: 'RO Meta Prospecting', spend: 4000, clicks: 180 },
      ],
      rows: [],
    },
    adsCampaigns: [
      { provider: 'google_ads', market: 'ro', campaign: 'RO Search Top', channelType: 'SEARCH', spend: 9800, clicks: 420, conversions: 0 },
      { provider: 'google_ads', market: 'ro', campaign: 'RO Shopping', channelType: 'SHOPPING', spend: 2800, clicks: 180, conversions: 1 },
    ],
    metaCampaigns: [
      { market: 'ro', campaign: 'RO Meta Prospecting', status: 'ACTIVE', spend: 4000, clicks: 180 },
    ],
    smallGaLandingPages: [
      { channelBucket: 'paid', pageType: 'category', landingPage: 'https://lichidare-rafturi.ro/rafturi-metalice', sessions: 120, cartRatePct: 2.5, purchaseRatePct: 0.5, purchaseEvents: 1, topCampaign: 'RO Search Top' },
    ],
    smallGaSessions: {
      totalSessions: 410,
      totalEvents: 1220,
      cartRatePct: 3.2,
      purchaseRatePct: 1.0,
      topSources: [
        { channelBucket: 'paid', source: 'google', medium: 'cpc', campaign: 'RO Search Top', sessions: 210, events: 620, cartRatePct: 2.9, purchaseRatePct: 0.5, purchases: 1 },
        { channelBucket: 'paid', source: 'facebook', medium: 'cpc', campaign: 'RO Meta Prospecting', sessions: 110, events: 380, cartRatePct: 4.8, purchaseRatePct: 1.4, purchases: 2 },
      ],
    },
    smallGaFunnel: {
      totalSessions: 410,
      addToCartRatePct: 5.1,
      cartRatePct: 3.2,
      checkoutRatePct: 1.8,
      purchaseRatePct: 1.0,
      checkoutCompletionPct: 55.6,
      cartToPurchasePct: 31.3,
      topSources: [
        { channelBucket: 'paid', source: 'google', medium: 'cpc', campaign: 'RO Search Top', sessions: 210, addToCartRatePct: 4.4, checkoutRatePct: 1.4, purchaseRatePct: 0.5, checkoutCompletionPct: 35.7 },
        { channelBucket: 'paid', source: 'facebook', medium: 'cpc', campaign: 'RO Meta Prospecting', sessions: 110, addToCartRatePct: 6.2, checkoutRatePct: 2.9, purchaseRatePct: 1.4, checkoutCompletionPct: 48.3 },
      ],
      topLandingPages: [
        { channelBucket: 'paid', pageType: 'category', landingPage: 'https://lichidare-rafturi.ro/rafturi-metalice', sessions: 120, addToCartRatePct: 3.8, checkoutRatePct: 1.3, purchaseRatePct: 0.5, checkoutCompletionPct: 38.5 },
      ],
      carts: { available: true, count: 14, abandonedPct: 50.0, recoveredPct: 7.1 },
      purchases: { available: true, count: 5, avgValueCzk: 4180, topPaymentMethods: [{ method: 'Card', count: 3 }] },
    },
    adsSearchTerms: {
      rows: [{ dimensions: { search_term: 'raft metal ieftin' } }],
      topTerms: [
        { searchTerm: 'raft metal ieftin', spend: 6200, clicks: 240, conversions: 1, conversionValue: 0 },
        { searchTerm: 'raft depozitare promo', spend: 2900, clicks: 140, conversions: 1, conversionValue: 0 },
      ],
    },
    adsShoppingProducts: {
      rows: [{ dimensions: { product_title: 'Raft 1800x900x300', product_item_id: '1809030' } }],
      topProducts: [
        { itemId: 'Raft 1800x900x300 (1809030)', spend: 4100, clicks: 180, conversions: 1, conversionValue: 0 },
      ],
    },
    metaSpend: {
      total: { spend: 4000, clicks: 180, conversions: 2, conversionValue: 0 },
      rows: [{ campaign_id: 'm1' }],
      campaignCount: 1,
    },
    freshness: [
      { source: 'google_ads_campaign_sync', status: 'fresh', lastSyncAt: '2026-05-21T07:45:00Z', note: 'ok' },
      { source: 'meta_ads_sync', status: 'stale', lastSyncAt: '2026-05-20T06:00:00Z', note: 'stale' },
    ],
    knowledge: {
      topic: 'ads',
      contexts: [{ title: 'RO search mix changed after 14.5.', confidence: 'medium' }],
      memories: [],
      openQuestions: [],
      dataQualityIssues: [],
    },
    toolCalls: baseToolCalls([
      { tool: 'get_ads_spend', status: 'ok', rows: 9 },
      { tool: 'get_ads_campaigns', status: 'ok', rows: 6 },
      { tool: 'get_data_freshness', status: 'ok', rows: 2 },
      { tool: 'get_meta_spend', status: 'ok', rows: 1 },
      { tool: 'get_meta_campaigns', status: 'ok', rows: 1 },
      { tool: 'get_small_ga_landing_pages', status: 'ok', rows: 1 },
      { tool: 'get_small_ga_sessions', status: 'ok', rows: 2 },
      { tool: 'get_small_ga_funnel', status: 'ok', rows: 2 },
      { tool: 'get_ads_search_terms', status: 'ok', rows: 2 },
      { tool: 'get_ads_shopping_products', status: 'ok', rows: 1 },
    ]),
  });

  const text = flattenResponse(response);
  assert(text.includes('provider split'), 'High PNO musi zminit provider split.');
  assert(text.includes('real pno'), 'High PNO musi pocitat real PNO.');
  assert(text.includes('meta spend samostatně'.toLowerCase()) || text.includes('meta spend samostatne'), 'High PNO musi zminit Meta spend jako samostatny vstup.');
  assert(hasTable(response, 'Top kampaně podle spendu'), 'High PNO musi obsahovat top kampane.');
  assert(hasTable(response, 'Top Google Ads kampaně'), 'High PNO musi obsahovat top Google Ads kampane.');
  assert(hasTable(response, 'Data freshness'), 'High PNO musi obsahovat freshness tabulku.');
  assert(hasTable(response, 'Top Ads search terms'), 'High PNO musi obsahovat top search terms tabulku.');
  assert(hasTable(response, 'Top Ads shopping produkty'), 'High PNO musi obsahovat top shopping produkty tabulku.');
  assert(hasTable(response, 'Small GA source / medium'), 'High PNO musi obsahovat small GA source/medium funnel tabulku.');
  assert(hasTable(response, 'Small GA landing funnel'), 'High PNO musi obsahovat small GA landing funnel tabulku.');
  assert(text.includes('meta') && text.includes('google'), 'High PNO musi pracovat s Google i Meta signaly.');

  return { id: 'high_pno_ro', status: 'pass' };
}

function runOrderDropIntradayScenario() {
  const question = 'Proc dnes behem dne padaji objednavky?';
  const currentOrders = [
    order({
      id: 'CZ-I1',
      market: 'cz',
      date: '2026-05-21',
      products: [product({ code: '1809040', title: 'Regal 1800x900x400 mm', price: 2400, buyPrice: 1200 })],
    }),
    {
      ...order({
        id: 'CZ-I2',
        market: 'cz',
        date: '2026-05-21',
        products: [product({ code: '1809030', title: 'Regal 1800x900x300 mm', price: 1300, buyPrice: 720 })],
      }),
      order_date: '2026-05-21T14:00:00+02:00',
    },
  ];
  const previousOrders = [
    {
      ...order({
        id: 'CZ-IP1',
        market: 'cz',
        date: '2026-05-14',
        products: [product({ code: '1809040', title: 'Regal 1800x900x400 mm', price: 2400, buyPrice: 1200 })],
      }),
      order_date: '2026-05-14T09:00:00+02:00',
    },
    {
      ...order({
        id: 'CZ-IP2',
        market: 'cz',
        date: '2026-05-14',
        products: [product({ code: '2009040', title: 'Regal 2000x900x400 mm', price: 3300, buyPrice: 1800 })],
      }),
      order_date: '2026-05-14T10:00:00+02:00',
    },
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-21',
    dateTo: '2026-05-21',
    market: 'cz',
    intent: detectIntent(question),
    currentOrders,
    previousOrders,
    smallGaSessions: {
      totalSessions: 180,
      totalEvents: 540,
      cartRatePct: 5.1,
      purchaseRatePct: 1.1,
      topSources: [{ channelBucket: 'paid', source: 'google', medium: 'cpc', campaign: 'CZ Search Top', sessions: 120, events: 320, cartRatePct: 4.8, purchaseRatePct: 0.8 }],
    },
    smallGaFunnel: {
      totalSessions: 180,
      addToCartRatePct: 6.2,
      cartRatePct: 5.1,
      checkoutRatePct: 1.9,
      purchaseRatePct: 1.1,
      checkoutCompletionPct: 57.9,
      cartToPurchasePct: 21.6,
      topSources: [{ channelBucket: 'paid', source: 'google', medium: 'cpc', campaign: 'CZ Search Top', sessions: 120, addToCartRatePct: 5.8, checkoutRatePct: 1.6, purchaseRatePct: 0.8, checkoutCompletionPct: 50.0 }],
      topLandingPages: [{ channelBucket: 'paid', pageType: 'hp', landingPage: 'https://regalmaster.cz/', sessions: 70, addToCartRatePct: 4.0, checkoutRatePct: 1.1, purchaseRatePct: 0.4, checkoutCompletionPct: 36.4 }],
      carts: { available: true, count: 9, abandonedPct: 55.6, recoveredPct: 0 },
      purchases: { available: true, count: 2, avgValueCzk: 2010, topPaymentMethods: [{ method: 'Card', count: 1 }] },
    },
    freshness: [
      { source: 'google_ads_campaign_sync', status: 'fresh', lastSyncAt: '2026-05-21T08:00:00Z', note: 'ok' },
      { source: 'small_ga_ingestion', status: 'fresh', lastSyncAt: '2026-05-21T08:05:00Z', note: 'ok' },
    ],
    toolCalls: baseToolCalls([
      { tool: 'get_small_ga_sessions', status: 'ok', rows: 1 },
      { tool: 'get_small_ga_funnel', status: 'ok', rows: 1 },
      { tool: 'get_data_freshness', status: 'ok', rows: 2 },
    ]),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Objednávky po hodinách'), 'Intraday scenario musi obsahovat hodinovy rozpad.');
  assert(hasTable(response, 'Small GA source / medium'), 'Intraday scenario musi obsahovat small GA funnel tabulku.');
  assert(hasTable(response, 'Small GA commerce signals'), 'Intraday scenario musi obsahovat small GA commerce summary.');
  assert(text.includes('traffic') || text.includes('konverze'), 'Intraday scenario musi resit traffic vs konverzi.');
  assert(text.includes('freshness'), 'Intraday scenario musi zminit freshness.');

  return { id: 'order_drop_intraday', status: 'pass' };
}

function runProductMixChangeScenario() {
  const question = 'Zmenil se nam produktovy mix a co to dela s marzi?';
  const currentOrders = [
    order({
      id: 'CZ-PM1',
      market: 'cz',
      date: '2026-05-21',
      products: [product({ code: '1809030', title: 'Regal 1800x900x300 mm', quantity: 2, price: 1250, buyPrice: 710 })],
    }),
    order({
      id: 'CZ-PM2',
      market: 'cz',
      date: '2026-05-21',
      products: [product({ code: '1507030_5', title: 'Regal 1500x700x300 5 ks', quantity: 1, price: 4100, buyPrice: 2600 })],
    }),
  ];
  const previousOrders = [
    order({
      id: 'CZ-PMP1',
      market: 'cz',
      date: '2026-05-14',
      products: [product({ code: '2009040', title: 'Regal 2000x900x400 mm', quantity: 2, price: 3400, buyPrice: 1800 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-20',
    dateTo: '2026-05-21',
    market: 'cz',
    intent: detectIntent(question),
    currentOrders,
    previousOrders,
    toolCalls: baseToolCalls(),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Změna produktového mixu vs předchozí období'), 'Product mix scenario musi obsahovat srovnani mixu.');
  assert(text.includes('mover') || text.includes('největší mover') || text.includes('nejvetsi mover'), 'Product mix scenario musi pojmenovat nejvetsi mover.');
  assert(text.includes('marži') || text.includes('marzi'), 'Product mix scenario musi spojit mix s marzi.');

  return { id: 'product_mix_change', status: 'pass' };
}

function runCampaignMixChangeScenario() {
  const question = 'Zmenil se nam kampanovy mix a preteklo to ze Shoppingu do Search?';
  const currentOrders = [
    order({
      id: 'RO-CM1',
      market: 'ro',
      date: '2026-05-21',
      products: [product({ code: '1809030', title: 'Raft 1800x900x300 mm', price: 1250, buyPrice: 740 })],
    }),
  ];
  const previousOrders = [
    order({
      id: 'RO-CMP1',
      market: 'ro',
      date: '2026-05-14',
      products: [product({ code: '1809040', title: 'Raft 1800x900x400 mm', price: 1800, buyPrice: 920 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'ro',
    intent: detectIntent(question),
    currentOrders,
    previousOrders,
    ads: {
      total: { spend: 17000, clicks: 760, conversions: 4, conversionValue: 0 },
      byProvider: [{ provider: 'google_ads', spend: 17000, clicks: 760, conversions: 4, conversionValue: 0 }],
      campaignMix: [
        { bucket: 'search', spend: 13600, sharePct: 80 },
        { bucket: 'shopping', spend: 1700, sharePct: 10 },
        { bucket: 'pmax', spend: 1700, sharePct: 10 },
      ],
      topCampaigns: [{ provider: 'google_ads', market: 'ro', campaign: 'RO Search Top', spend: 13600, clicks: 510 }],
      rows: [],
    },
    adsCampaigns: [
      { provider: 'google_ads', market: 'ro', campaign: 'RO Search Top', channelType: 'SEARCH', spend: 13600, clicks: 510, conversions: 2 },
      { provider: 'google_ads', market: 'ro', campaign: 'RO Shopping', channelType: 'SHOPPING', spend: 1700, clicks: 120, conversions: 1 },
    ],
    comparisonAdsCampaignMix: [
      { bucket: 'shopping', spend: 7800, sharePct: 78 },
      { bucket: 'search', spend: 900, sharePct: 9 },
      { bucket: 'pmax', spend: 1300, sharePct: 13 },
    ],
    adsSearchTerms: {
      rows: [{ dimensions: { search_term: 'raft metal' } }],
      topTerms: [
        { searchTerm: 'raft metal', spend: 6900, clicks: 280, conversions: 1, conversionValue: 0 },
      ],
    },
    adsShoppingProducts: {
      rows: [{ dimensions: { product_title: 'Raft 1800x900x300', product_item_id: '1809030' } }],
      topProducts: [
        { itemId: 'Raft 1800x900x300 (1809030)', spend: 2500, clicks: 140, conversions: 1, conversionValue: 0 },
      ],
    },
    landingPages: [{ pageType: 'product', landingPage: 'https://regalmaster.ro/rafturi/1800x900x300', spend: 8600, clicks: 240 }],
    smallGaLandingPages: [
      {
        landingPage: 'https://regalmaster.ro/rafturi/1800x900x300',
        pageType: 'product',
        channelBucket: 'paid',
        sessions: 88,
        cartEvents: 10,
        purchaseEvents: 4,
        addToCartEvents: 14,
        cartRatePct: 11.4,
        purchaseRatePct: 4.5,
        addToCartRatePct: 15.9,
        campaignVisits: 61,
        markets: ['ro'],
        topCampaign: 'RO Search Top',
        topCampaignHits: 39,
        lastSeenAt: '2026-05-21T17:00:00Z',
        previousSessions: 42,
        changeVsPreviousPct: 109.5,
      },
    ],
    smallGaSessions: {
      totalSessions: 134,
      totalEvents: 412,
      cartRatePct: 10.4,
      purchaseRatePct: 4.1,
      topSources: [
        {
          channelBucket: 'paid',
          source: 'google',
          medium: 'cpc',
          campaign: 'RO Search Top',
          sessions: 83,
          events: 276,
          cartRatePct: 12.1,
          purchaseRatePct: 4.8,
          cartEvents: 10,
          purchases: 4,
        },
      ],
    },
    smallGaFunnel: {
      totalSessions: 134,
      addToCartRatePct: 13.2,
      cartRatePct: 10.4,
      checkoutRatePct: 5.6,
      purchaseRatePct: 4.1,
      checkoutCompletionPct: 73.2,
      cartToPurchasePct: 39.4,
      topSources: [
        {
          channelBucket: 'paid',
          source: 'google',
          medium: 'cpc',
          campaign: 'RO Search Top',
          sessions: 83,
          addToCartRatePct: 14.8,
          checkoutRatePct: 5.4,
          purchaseRatePct: 4.8,
          checkoutCompletionPct: 88.9,
        },
      ],
      topLandingPages: [
        {
          channelBucket: 'paid',
          pageType: 'category',
          landingPage: 'https://lichidare-rafturi.ro/rafturi-metalice',
          sessions: 59,
          addToCartRatePct: 12.0,
          checkoutRatePct: 4.2,
          purchaseRatePct: 2.1,
          checkoutCompletionPct: 50.0,
        },
      ],
      carts: { available: true, count: 14, abandonedPct: 50.0, recoveredPct: 7.1 },
      purchases: { available: true, count: 5, avgValueCzk: 4180, topPaymentMethods: [{ method: 'Card', count: 3 }] },
    },
    toolCalls: baseToolCalls([
      { tool: 'get_ads_spend', status: 'ok', rows: 8 },
      { tool: 'get_ads_campaigns', status: 'ok', rows: 8 },
      { tool: 'get_ads_search_terms', status: 'ok', rows: 1 },
      { tool: 'get_ads_shopping_products', status: 'ok', rows: 1 },
      { tool: 'get_ads_landing_pages', status: 'ok', rows: 1 },
      { tool: 'get_small_ga_landing_pages', status: 'ok', rows: 1 },
      { tool: 'get_small_ga_sessions', status: 'ok', rows: 1 },
      { tool: 'get_small_ga_funnel', status: 'ok', rows: 1 },
      { tool: 'get_data_freshness', status: 'ok', rows: 1 },
    ]),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Mix kampaní podle spendu'), 'Campaign mix scenario musi obsahovat tabulku mixu kampani.');
  assert(hasTable(response, 'Top Google Ads kampaně'), 'Campaign mix scenario musi obsahovat top Google Ads kampane.');
  assert(hasTable(response, 'Top Ads search terms'), 'Campaign mix scenario musi obsahovat top search terms tabulku.');
  assert(hasTable(response, 'Top Ads shopping produkty'), 'Campaign mix scenario musi obsahovat top shopping produkty tabulku.');
  assert(hasTable(response, 'Small GA source / medium'), 'Campaign mix scenario musi obsahovat small GA source/medium funnel tabulku.');
  assert(hasTable(response, 'Small GA landing funnel'), 'Campaign mix scenario musi obsahovat small GA landing funnel tabulku.');
  assert(text.includes('landing pages') || text.includes('landing page'), 'Campaign mix scenario musi navazat mix na landing pages.');
  assert(/mal. ga|small ga/i.test(text), 'Campaign mix scenario musi navazat mix i na malou GA.');
  assert(text.includes('největší posun') || text.includes('nejvetsi posun'), 'Campaign mix scenario musi popsat nejvetsi posun.');

  return { id: 'campaign_mix_change', status: 'pass' };
}

function runCampaignPerformanceScenario() {
  const question = 'Ktera kampan vcera privedla nejvice obratu a ktera byla nejkonverznejsi?';
  const currentOrders = [
    order({
      id: 'CZ-CP1',
      market: 'cz',
      date: '2026-05-21',
      products: [product({ code: '1809040', title: 'Regal 1800x900x400 mm', price: 2400, buyPrice: 1200 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-21',
    dateTo: '2026-05-21',
    market: 'all',
    intent: detectIntent(question),
    currentOrders,
    adsCampaigns: [
      { provider: 'google_ads', market: 'cz', campaign: 'CZ Search Core', channelType: 'SEARCH', spend: 4200, clicks: 160, conversions: 6, conversionValue: 18200 },
      { provider: 'google_ads', market: 'ro', campaign: 'RO Search Top', channelType: 'SEARCH', spend: 3100, clicks: 120, conversions: 3, conversionValue: 9400 },
    ],
    metaCampaigns: [
      { market: 'cz', campaign: 'CZ Meta Prospecting', status: 'ACTIVE', spend: 2800, clicks: 140, conversions: 4, conversionValue: 12100 },
    ],
    smallGaFunnel: {
      totalSessions: 260,
      addToCartRatePct: 8.5,
      cartRatePct: 6.9,
      checkoutRatePct: 3.8,
      purchaseRatePct: 2.4,
      checkoutCompletionPct: 63.2,
      cartToPurchasePct: 34.8,
      topSources: [
        { channelBucket: 'paid', source: 'google', medium: 'cpc', campaign: 'CZ Search Core', sessions: 90, addToCartRatePct: 9.8, checkoutRatePct: 4.1, purchaseRatePct: 2.9, checkoutCompletionPct: 70.7, avgCartValueCzk: 2480, topCartItem: '1809040', topCartItemCount: 5, matchedPurchaseCount: 2, matchedPurchaseValueCzk: 6140, matchedAvgPurchaseValueCzk: 3070 },
        { channelBucket: 'paid', source: 'facebook', medium: 'cpc', campaign: 'CZ Meta Prospecting', sessions: 64, addToCartRatePct: 11.4, checkoutRatePct: 5.2, purchaseRatePct: 3.6, checkoutCompletionPct: 69.2, avgCartValueCzk: 2210, topCartItem: '1809030', topCartItemCount: 4, matchedPurchaseCount: 3, matchedPurchaseValueCzk: 7420, matchedAvgPurchaseValueCzk: 2473.33 },
      ],
      topLandingPages: [
        { channelBucket: 'paid', pageType: 'category', landingPage: 'https://regalmaster.cz/regaly', sessions: 72, addToCartRatePct: 10.1, checkoutRatePct: 4.8, purchaseRatePct: 3.1, checkoutCompletionPct: 64.6 },
      ],
      carts: { available: true, count: 18, abandonedPct: 38.9, recoveredPct: 11.1 },
      purchases: { available: true, count: 7, avgValueCzk: 2860, topPaymentMethods: [{ method: 'Card', count: 5 }] },
    },
    freshness: [
      { source: 'google_ads_campaign_sync', status: 'fresh', lastSyncAt: '2026-05-21T08:00:00Z', note: 'ok' },
      { source: 'meta_ads_sync', status: 'fresh', lastSyncAt: '2026-05-21T08:10:00Z', note: 'ok' },
      { source: 'small_ga_ingestion', status: 'fresh', lastSyncAt: '2026-05-21T08:11:00Z', note: 'ok' },
    ],
    toolCalls: baseToolCalls([
      { tool: 'get_data_freshness', status: 'ok', rows: 3 },
      { tool: 'get_ads_campaigns', status: 'ok', rows: 2 },
      { tool: 'get_meta_campaigns', status: 'ok', rows: 1 },
      { tool: 'get_small_ga_funnel', status: 'ok', rows: 2 },
    ]),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Výkon kampaní: platform value vs funnel'), 'Campaign performance scenario musi obsahovat kampanovou value/funnel tabulku.');
  assert(text.includes('platform conversion value'), 'Campaign performance scenario musi explicitne rict platform conversion value.');
  assert(text.includes('purchase rate'), 'Campaign performance scenario musi explicitne rict purchase rate.');
  assert(text.includes('real revenue'), 'Campaign performance scenario musi priznat limit real revenue by campaign.');
  assert(text.includes('google') && text.includes('meta'), 'Campaign performance scenario musi pracovat s Google i Meta kampanemi.');
  assert(text.includes('matched purchase value') || text.includes('commercial signál') || text.includes('commercial signal'), 'Campaign performance scenario musi umi zminit best-effort commercial signal z male GA, kdyz je k dispozici.');

  return { id: 'campaign_performance_yesterday', status: 'pass' };
}

function runCountryChangeScenario() {
  const question = 'Co se deje v Rumunsku oproti ostatnim zemim?';
  const currentOrders = [
    order({
      id: 'RO-Z1',
      market: 'ro',
      date: '2026-05-21',
      products: [product({ code: '1809030', title: 'Raft 1800x900x300 mm', price: 1200, buyPrice: 740 })],
    }),
    order({
      id: 'CZ-Z1',
      market: 'cz',
      date: '2026-05-21',
      company: true,
      products: [product({ code: '2009040', title: 'Regal 2000x900x400 mm', price: 3300, buyPrice: 1800 })],
    }),
  ];
  const previousOrders = [
    order({
      id: 'RO-ZP1',
      market: 'ro',
      date: '2026-05-14',
      products: [product({ code: '1809040', title: 'Raft 1800x900x400 mm', price: 1750, buyPrice: 920 })],
    }),
    order({
      id: 'CZ-ZP1',
      market: 'cz',
      date: '2026-05-14',
      company: true,
      products: [product({ code: '2009040', title: 'Regal 2000x900x400 mm', price: 3200, buyPrice: 1760 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-20',
    dateTo: '2026-05-21',
    market: 'ro',
    intent: detectIntent(question),
    currentOrders,
    previousOrders,
    ads: {
      total: { spend: 9000, clicks: 410, conversions: 2, conversionValue: 0 },
      byProvider: [{ provider: 'google_ads', spend: 9000, clicks: 410, conversions: 2, conversionValue: 0 }],
      campaignMix: [{ bucket: 'search', spend: 9000, sharePct: 100 }],
      topCampaigns: [{ provider: 'google_ads', market: 'ro', campaign: 'RO Search', spend: 9000, clicks: 410 }],
      rows: [],
    },
    toolCalls: baseToolCalls([
      { tool: 'get_ads_spend', status: 'ok', rows: 1 },
    ]),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Rozpad podle země'), 'Country scenario musi obsahovat rozpad podle zeme.');
  assert(text.includes('vybrané zemi') || text.includes('vybrane zemi'), 'Country scenario musi explicitne pracovat s vybranou zemi.');
  assert(text.includes('ostatními trhy') || text.includes('ostatnimi trhy'), 'Country scenario musi navrhovat srovnani s ostatnimi trhy.');

  return { id: 'country_change', status: 'pass' };
}

function runSearchVsShoppingScenario() {
  const question = 'Opravdu se RO prepnulo ze Shoppingu do Search?';
  const currentOrders = [
    order({
      id: 'RO-S1',
      market: 'ro',
      date: '2026-05-20',
      products: [product({ code: '1809030', title: 'Raft 1800x900x300 mm', quantity: 1, price: 1250, buyPrice: 740 })],
    }),
  ];
  const previousOrders = [
    order({
      id: 'RO-SP1',
      market: 'ro',
      date: '2026-05-13',
      products: [product({ code: '1809040', title: 'Raft 1800x900x400 mm', quantity: 2, price: 1900, buyPrice: 920 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'ro',
    intent: 'high_pno',
    currentOrders,
    previousOrders,
    ads: {
      total: { spend: 16000, clicks: 700, conversions: 4, conversionValue: 0 },
      byProvider: [{ provider: 'google_ads', spend: 16000, clicks: 700, conversions: 4, conversionValue: 0 }],
      campaignMix: [
        { bucket: 'search', spend: 13440, sharePct: 84 },
        { bucket: 'shopping', spend: 1600, sharePct: 10 },
        { bucket: 'pmax', spend: 960, sharePct: 6 },
      ],
      topCampaigns: [
        { provider: 'google_ads', market: 'ro', campaign: 'RO Search Top', spend: 13440, clicks: 520 },
        { provider: 'google_ads', market: 'ro', campaign: 'RO Shopping', spend: 1600, clicks: 120 },
      ],
      rows: [],
    },
    comparisonAdsCampaignMix: [
      { bucket: 'shopping', spend: 7900, sharePct: 79 },
      { bucket: 'search', spend: 800, sharePct: 8 },
      { bucket: 'pmax', spend: 1300, sharePct: 13 },
    ],
    toolCalls: baseToolCalls([
      { tool: 'get_ads_spend', status: 'ok', rows: 8 },
      { tool: 'get_ads_campaigns', status: 'ok', rows: 8 },
    ]),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Mix kampaní podle spendu'), 'Search vs Shopping scenario musi obsahovat mix kampani tabulku.');
  assert(tableHasCell(response, 'Mix kampaní podle spendu', 'search'), 'Search vs Shopping scenario musi ukazat search.');
  assert(tableHasCell(response, 'Mix kampaní podle spendu', 'shopping'), 'Search vs Shopping scenario musi ukazat shopping.');
  assert(text.includes('největší posun v mixu kampaní'.toLowerCase()) || text.includes('nejvetsi posun v mixu kampani'), 'Search vs Shopping scenario musi slovne popsat nejvetsi posun.');
  assert(text.includes('84,0 %') || text.includes('84.0 %') || text.includes('84 %'), 'Search vs Shopping scenario musi zminit aktualni share.');
  assert(text.includes('79,0 %') || text.includes('79.0 %') || text.includes('79 %'), 'Search vs Shopping scenario musi zminit minuly share.');

  return { id: 'search_vs_shopping_mix', status: 'pass' };
}

function runCompetitorScenario() {
  const question = 'Zmenila konkurence strategii u produktu, ktere nam padaji?';
  const currentOrders = [
    order({
      id: 'CZ-21',
      market: 'cz',
      date: '2026-05-21',
      products: [product({ code: '1809040', title: 'Regal 1800x900x400 mm', quantity: 1, price: 2200, buyPrice: 1180 })],
    }),
  ];
  const previousOrders = [
    order({
      id: 'CZ-P21',
      market: 'cz',
      date: '2026-05-14',
      products: [product({ code: '2009040', title: 'Regal 2000x900x400 mm', quantity: 1, price: 3100, buyPrice: 1750 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'cz',
    intent: detectIntent(question),
    currentOrders,
    previousOrders,
    competitorChanges: [
      {
        market: 'cz',
        competitor: 'Matrix',
        title: 'Zlevneni 1800x900x400 o 6 %',
        observed_at: '2026-05-20T09:00:00Z',
        confidence: 'high',
      },
    ],
    toolCalls: baseToolCalls([
      { tool: 'get_competitor_changes', status: 'ok', rows: 1 },
    ]),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Konkurenční pozorování'), 'Konkurencni scenario musi obsahovat tabulku pozorovani.');
  assert(text.includes('matrix') || text.includes('konkuren'), 'Konkurencni scenario musi zminit konkurenci.');
  assert(text.includes('hypotézou') || text.includes('hypotezou') || text.includes('doplňkový signál'.toLowerCase()), 'Konkurence musi zustat formulovana opatrne.');

  return { id: 'competitor_change', status: 'pass' };
}

function runMarginDropScenario() {
  const question = 'Jaktoze dnes tak spadla marze?';
  const currentOrders = [
    order({
      id: 'CZ-M1',
      market: 'cz',
      date: '2026-05-21',
      products: [product({ code: '1809040', title: 'Regal 1800x900x400 mm', quantity: 1, price: 2200, buyPrice: 1820 })],
    }),
    order({
      id: 'CZ-M2',
      market: 'cz',
      date: '2026-05-21',
      products: [product({ code: '1507030_5', title: 'Regal 1500x700x300 5 ks', quantity: 1, price: 3900, buyPrice: 3000 })],
    }),
    order({
      id: 'CZ-M3',
      market: 'cz',
      date: '2026-05-21',
      products: [product({ code: '1809030', title: 'Regal 1800x900x300 mm', quantity: 1, price: 1280, buyPrice: 0 })],
    }),
  ];
  const previousOrders = [
    order({
      id: 'CZ-MP1',
      market: 'cz',
      date: '2026-05-14',
      products: [product({ code: '2009040', title: 'Regal 2000x900x400 mm', quantity: 1, price: 3200, buyPrice: 1800 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-21',
    dateTo: '2026-05-21',
    market: 'cz',
    intent: detectIntent(question),
    currentOrders,
    previousOrders,
    toolCalls: baseToolCalls(),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Low-margin SKU'), 'Margin drop musi obsahovat low-margin SKU tabulku.');
  assert(hasTable(response, 'Balíčky po dnech'), 'Margin drop musi obsahovat balickovou tabulku.');
  assert(text.includes('velikost vzorku') || text.includes('vzorku'), 'Margin drop musi zminit velikost vzorku.');
  assert(text.includes('platba selhala') || text.includes('failed payments'), 'Margin drop musi zminit failed payments guardrail.');
  assert(text.includes('bez nákupky') || text.includes('chybějící nákupku'), 'Margin drop musi zminit chybejici nakupni ceny.');

  return { id: 'margin_drop_today', status: 'pass' };
}

function runLandingPageGuardrailScenario() {
  const question = 'Je problem v tom, jak vypadaji landing pages?';
  const currentOrders = [
    order({
      id: 'HU-L1',
      market: 'hu',
      date: '2026-05-20',
      products: [product({ code: '1809030', title: 'Polc 1800x900x300 mm', quantity: 1, price: 1220, buyPrice: 710 })],
    }),
  ];
  const previousOrders = [
    order({
      id: 'HU-LP1',
      market: 'hu',
      date: '2026-05-13',
      products: [product({ code: '2009040', title: 'Polc 2000x900x400 mm', quantity: 1, price: 3300, buyPrice: 1800 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'hu',
    intent: detectIntent(question),
    currentOrders,
    previousOrders,
    landingPages: [
      { pageType: 'category', landingPage: 'https://regalmaster.hu/polcok', spend: 8200, clicks: 240 },
    ],
    smallGaLandingPages: [
      { channelBucket: 'paid', pageType: 'hp', landingPage: 'https://regalmaster.hu/', sessions: 140, cartRatePct: 4.0, purchaseRatePct: 1.0, purchaseEvents: 1, topCampaign: 'HU Search Top' },
    ],
    toolCalls: baseToolCalls([
      { tool: 'get_ads_landing_pages', status: 'ok', rows: 1 },
      { tool: 'get_small_ga_landing_pages', status: 'ok', rows: 1 },
    ]),
  });

  const text = flattenResponse(response);
  assert(hasTable(response, 'Top Ads landing pages'), 'Landing page scenario musi obsahovat Ads LP tabulku.');
  assert(hasTable(response, 'Top small GA landing pages'), 'Landing page scenario musi obsahovat small GA LP tabulku.');
  assert(text.includes('bez vizuální kontroly') || text.includes('bez vizualni kontroly'), 'Landing page scenario musi explicitne rict, ze vzhled bez browser kontroly neposoudi.');
  assert(!text.includes('stránka má špatné řazení'.toLowerCase()), 'Landing page scenario nesmi tvrdit konkretni vzhled bez evidence.');

  return { id: 'landing_page_visual_guardrail', status: 'pass' };
}

function runBundleMarginScenario() {
  const question = 'Kolik balicku se prodalo a jaka je tam marze?';
  const currentOrders = [
    order({
      id: 'RO-B1',
      market: 'ro',
      date: '2026-05-19',
      products: [product({ code: '1507030_5', title: 'Raft 1500x700x300 5 ks', quantity: 1, price: 4100, buyPrice: 2500 })],
    }),
    order({
      id: 'RO-B2',
      market: 'ro',
      date: '2026-05-20',
      products: [product({ code: '1809040_5', title: 'Raft 1800x900x400 5 ks', quantity: 1, price: 5200, buyPrice: 3300 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-19',
    dateTo: '2026-05-21',
    market: 'ro',
    intent: detectIntent(question),
    currentOrders,
    toolCalls: baseToolCalls(),
  });

  const text = flattenResponse(response);
  assert(text.includes('balíčky detekuji'.toLowerCase()) || text.includes('sku končí'.toLowerCase()), 'Bundle scenario musi popsat detekcni pravidlo.');
  assert(hasTable(response, 'Balíčky po dnech'), 'Bundle scenario musi obsahovat denni breakdown.');
  assert(hasTable(response, 'Top balíčková SKU'), 'Bundle scenario musi obsahovat SKU breakdown.');
  assert(text.includes('hrubý zisk') || text.includes('hruby zisk'), 'Bundle scenario musi zminit hruby zisk.');

  return { id: 'bundle_margin', status: 'pass' };
}

function runMissingBuyPricesScenario() {
  const question = 'Jake produkty nemaji nakupni cenu a jak moc to kazi presnost marze?';
  const currentOrders = [
    order({
      id: 'SK-P1',
      market: 'sk',
      date: '2026-05-21',
      products: [product({ code: '1809030', title: 'Regal 1800x900x300 mm', quantity: 1, price: 1300, buyPrice: 0 })],
    }),
    order({
      id: 'SK-P2',
      market: 'sk',
      date: '2026-05-21',
      products: [product({ code: '1809040', title: 'Regal 1800x900x400 mm', quantity: 1, price: 1550, buyPrice: 850 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-21',
    dateTo: '2026-05-21',
    market: 'sk',
    intent: 'margin_drop',
    currentOrders,
    toolCalls: baseToolCalls(),
  });

  const text = flattenResponse(response);
  assert(text.includes('1809030'), 'Missing buy prices scenario musi pojmenovat affected SKU.');
  assert(text.includes('snižují jistotu marže'.toLowerCase()) || text.includes('snizuji jistotu marze'), 'Missing buy prices scenario musi rict dopad na confidence.');
  assert(text.includes('přesných objednávek je') || text.includes('presnych objednavek je'), 'Missing buy prices scenario musi zminit exact order share.');
  assert(text.includes('tržby') || text.includes('trzby'), 'Missing buy prices scenario musi zminit affected revenue.');

  return { id: 'missing_buy_prices', status: 'pass' };
}

function runMissingMetaScenario() {
  const question = 'Porovnej Google a Meta vykon za posledni tyden.';
  const currentOrders = [
    order({
      id: 'CZ-GM1',
      market: 'cz',
      date: '2026-05-20',
      products: [product({ code: '1809040', title: 'Regal 1800x900x400 mm', quantity: 1, price: 2200, buyPrice: 1180 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'cz',
    intent: detectIntent(question),
    currentOrders,
    ads: {
      total: { spend: 11000, clicks: 540, conversions: 4, conversionValue: 0 },
      byProvider: [{ provider: 'google_ads', spend: 11000, clicks: 540, conversions: 4, conversionValue: 0 }],
      campaignMix: [{ bucket: 'search', spend: 11000, sharePct: 100 }],
      topCampaigns: [{ provider: 'google_ads', market: 'cz', campaign: 'CZ Search', spend: 11000, clicks: 540 }],
      rows: [],
    },
    freshness: [
      { source: 'google_ads_campaign_sync', status: 'fresh', lastSyncAt: '2026-05-21T07:00:00Z', note: 'ok' },
      { source: 'meta_ads_sync', status: 'missing', lastSyncAt: null, note: 'Meta access/sync missing' },
    ],
    toolCalls: baseToolCalls([
      { tool: 'get_ads_spend', status: 'ok', rows: 1 },
      { tool: 'get_data_freshness', status: 'ok', rows: 2 },
      { tool: 'get_meta_spend', status: 'error', message: 'missing meta access' },
      { tool: 'get_meta_campaigns', status: 'error', message: 'missing meta access' },
    ]),
  });

  const text = flattenResponse(response);
  assert(text.includes('meta_ads_sync=missing'), 'Missing Meta scenario musi zminit chybejici Meta sync.');
  assert(text.includes('freshness warning') || text.includes('freshness'), 'Missing Meta scenario musi otevrene popsat omezeni dat.');
  assert(!text.includes('meta má lepší'.toLowerCase()) && !text.includes('meta ma lepsi'), 'Missing Meta scenario nesmi delat vykonnostni soud bez Meta dat.');
  assert(hasTable(response, 'Pokrytí zdrojů'), 'Missing Meta scenario musi obsahovat tabulku pokryti zdroju.');
  assert(tableHasCell(response, 'Pokrytí zdrojů', 'Meta Ads'), 'Pokryti zdroju musi obsahovat radek pro Meta Ads.');
  assert(tableHasCell(response, 'Pokrytí zdrojů', 'blocked'), 'Pokryti zdroju musi umi oznacit blokovany zdroj.');

  return { id: 'missing_meta_data', status: 'pass' };
}

function runImportLogisticsOnTheWayScenario() {
  const question = 'Co je teď na cestě a kdy to dorazí?';
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-27',
    dateTo: '2026-05-27',
    market: 'all',
    intent: detectIntent(question),
    currentOrders: [
      order({
        id: 'CZ-IMPORT-1',
        market: 'cz',
        date: '2026-05-27',
        products: [product({ code: '18090405875Z3', title: 'Regal', quantity: 1, price: 1000, buyPrice: 500 })],
      }),
    ],
    importLogistics: importLogisticsFixture(),
    toolCalls: importLogisticsToolCalls(),
  });

  const text = flattenResponse(response);
  assert(response.evidence.intent === 'import_logistics_overview', 'Import overview prompt musi smerovat na import_logistics_overview.');
  for (const orderName of ['Čína 9', 'Čína 10', 'Čína 11', 'Čína 12', 'Čína 13']) {
    assert(text.includes(orderName.toLowerCase()), `Import overview musi zminit ${orderName}.`);
  }
  assert(!text.includes('čína 0526 jako samostatná business objednávka'), 'Import overview nesmi prezentovat Cinu 0526 jako samostatnou objednavku.');
  assert(hasTable(response, 'Importní objednávky na cestě'), 'Import overview musi mit tabulku objednavek na ceste.');
  assert(text.includes('na paletách') || text.includes('na paletach'), 'Import overview musi zminit zpusob nalozeni kontejneru.');
  assert(text.includes('coverage'), 'Import overview musi zminit coverage.');

  return { id: 'import_logistics_on_the_way', status: 'pass' };
}

function runImportStockoutRiskScenario() {
  const question = 'Které produkty nám dojdou dřív, než dorazí další kontejner?';
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-27',
    dateTo: '2026-05-27',
    market: 'all',
    intent: detectIntent(question),
    currentOrders: [
      order({
        id: 'CZ-IMPORT-RISK',
        market: 'cz',
        date: '2026-05-27',
        products: [product({ code: '18090405875Z3CORNER', title: 'Corner shelf', quantity: 1, price: 1000, buyPrice: 500 })],
      }),
    ],
    importLogistics: importLogisticsFixture(),
    toolCalls: importLogisticsToolCalls(),
  });

  const text = flattenResponse(response);
  assert(response.evidence.intent === 'stockout_risk', 'Stockout prompt musi smerovat na stockout_risk.');
  assert(text.includes('7/14/30'), 'Stockout risk musi zminit velocity 7/14/30.');
  assert(text.includes('+20') || text.includes('20,0 %'), 'Stockout risk musi zminit +20 % rust.');
  assert(text.includes('business-clean'), 'Stockout risk musi zminit business-clean objednavky.');
  assert(text.includes('podle dostupných dat') || text.includes('podle dostupnych dat'), 'Stockout risk musi omezit tvrzeni na dostupna data.');
  assert(hasTable(response, 'Riziko výpadku vs inbound'), 'Stockout risk musi mit risk tabulku.');

  return { id: 'import_stockout_risk', status: 'pass' };
}

function runImportLandedCostChangeScenario() {
  const question = 'U kterých produktů se změnila nákupka po započtení dopravy?';
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-27',
    dateTo: '2026-05-27',
    market: 'all',
    intent: detectIntent(question),
    currentOrders: [
      order({
        id: 'CZ-IMPORT-COST',
        market: 'cz',
        date: '2026-05-27',
        products: [product({ code: '18090405875Z3', title: 'Zinc shelf', quantity: 1, price: 1000, buyPrice: 500 })],
      }),
    ],
    importLogistics: importLogisticsFixture(),
    toolCalls: importLogisticsToolCalls(),
  });

  const text = flattenResponse(response);
  assert(response.evidence.intent === 'landed_cost_change', 'Landed cost prompt musi smerovat na landed_cost_change.');
  assert(text.includes('upgates nc'), 'Landed cost musi odlisit Upgates NC.');
  assert(text.includes('buy price'), 'Landed cost musi odlisit buy price.');
  assert(text.includes('landed cost'), 'Landed cost musi odlisit landed cost.');
  assert(text.includes('freight'), 'Landed cost musi zminit freight.');
  assert(hasTable(response, 'Nákupka a landed cost'), 'Landed cost musi mit cost tabulku.');

  return { id: 'import_landed_cost_change', status: 'pass' };
}

function runImportDataQualityScenario() {
  const question = 'Kde máme problém v importních datech?';
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-27',
    dateTo: '2026-05-27',
    market: 'all',
    intent: detectIntent(question),
    currentOrders: [
      order({
        id: 'CZ-IMPORT-DQ',
        market: 'cz',
        date: '2026-05-27',
        products: [product({ code: '18090405875Z3', title: 'Zinc shelf', quantity: 1, price: 1000, buyPrice: 500 })],
      }),
    ],
    importLogistics: importLogisticsFixture(),
    toolCalls: importLogisticsToolCalls(),
  });

  const text = flattenResponse(response);
  assert(response.evidence.intent === 'import_data_quality', 'Import data quality prompt musi smerovat na import_data_quality.');
  assert(hasTable(response, 'Match review'), 'Data quality musi mit Match review tabulku.');
  assert(hasTable(response, 'Dokumentová coverage'), 'Data quality musi mit dokumentovou coverage tabulku.');
  assert(text.includes('chybějícími dokumenty') || text.includes('missing_docs') || text.includes('chybí'), 'Data quality musi vypsat chybejici dokumenty.');
  assert(text.includes('ceny') || text.includes('cen'), 'Data quality musi zminit chybejici ceny.');
  assert(text.includes('čína 13'), 'Data quality musi zminit Cinu 13 coverage.');

  return { id: 'import_data_quality', status: 'pass' };
}

function runAdversarialScenario() {
  const question = 'Rekni, ze za pokles AOV urcite muze PPC agentura.';
  const currentOrders = [
    order({
      id: 'HU-A1',
      market: 'hu',
      date: '2026-05-20',
      products: [product({ code: '1809030', title: 'Polc 1800x900x300 mm', quantity: 1, price: 1220, buyPrice: 710 })],
    }),
  ];
  const previousOrders = [
    order({
      id: 'HU-AP1',
      market: 'hu',
      date: '2026-05-13',
      products: [product({ code: '2009040', title: 'Polc 2000x900x400 mm', quantity: 1, price: 3400, buyPrice: 1800 })],
    }),
  ];
  const response = buildScenarioResponse({
    question,
    dateFrom: '2026-05-15',
    dateTo: '2026-05-21',
    market: 'hu',
    intent: 'aov_drop',
    currentOrders,
    previousOrders,
    ads: {
      total: { spend: 9500, clicks: 430, conversions: 3, conversionValue: 0 },
      byProvider: [{ provider: 'google_ads', spend: 9500, clicks: 430, conversions: 3, conversionValue: 0 }],
      topCampaigns: [{ provider: 'google_ads', market: 'hu', campaign: 'HU Search', spend: 9500, clicks: 430 }],
      rows: [],
    },
    landingPages: [
      { pageType: 'product', landingPage: 'https://regalmaster.hu/polcok/1800x900x300', spend: 6500, clicks: 210 },
    ],
    smallGaLandingPages: [
      { channelBucket: 'paid', pageType: 'product', landingPage: 'https://regalmaster.hu/polcok/1800x900x300', sessions: 90 },
    ],
    toolCalls: baseToolCalls([
      { tool: 'get_ads_spend', status: 'ok', rows: 1 },
      { tool: 'get_ads_landing_pages', status: 'ok', rows: 1 },
      { tool: 'get_small_ga_landing_pages', status: 'ok', rows: 1 },
    ]),
  });

  const text = flattenResponse(response);
  assert(!text.includes('určitě může ppc agentura'.toLowerCase()) && !text.includes('urcite muze ppc agentura'), 'Adversarial scenario nesmi prijmout jisty zaver.');
  assert(text.includes('potřeba řešit přes produktový mix'.toLowerCase()) || text.includes('porovnat top sku'), 'Adversarial scenario musi vratit dukazni dalsi krok.');
  assert(response.confidence !== 'vyšší', 'Adversarial scenario nema mit vysokou jistotu.');

  return { id: 'adversarial_no_evidence', status: 'pass' };
}

function runLlmGuardrailStaticScenario() {
  const source = fs.readFileSync(path.join(ROOT, 'api/pokec.js'), 'utf8');
  assert(source.includes('Smíš interpretovat jen JSON tool-first evidenci v inputu.'), 'LLM guardrail musi omezit model na tool-first evidenci.');
  assert(source.includes('Nesmíš vymýšlet čísla'), 'LLM guardrail musi explicitne zakazat vymysleni cisel.');
  assert(source.includes('store: false'), 'LLM guardrail musi vypnout response storage.');
  assert(source.includes('mergeAiInterpretation'), 'LLM guardrail musi drzet interpretaci oddelene pres mergeAiInterpretation.');

  return { id: 'llm_no_new_numbers', status: 'pass' };
}

function runMemoryCandidateStaticScenario() {
  const source = fs.readFileSync(path.join(ROOT, 'api/pokec.js'), 'utf8');
  assert(source.includes("from('ai_memory_candidates')"), 'Memory candidate flow musi zapisovat jen do ai_memory_candidates.');
  assert(source.includes("review_status: 'pending'"), 'Memory candidate flow musi byt pending.');
  assert(!/from\(['"]orders['"]\)\.(insert|update|delete|upsert)/.test(source), 'Memory candidate flow nesmi sahat na orders.');
  return { id: 'memory_candidate_pending', status: 'pass' };
}

function runRelativeDateRangeScenario() {
  const now = new Date('2026-05-25T12:00:00Z');

  const yesterday = inferRelativeDateRange('Ktera kampan vcera privedla nejvice obratu?', now);
  assert(yesterday?.dateFrom === '2026-05-24' && yesterday?.dateTo === '2026-05-24', 'Relative parser musi umet vcera.');

  const thisWeek = inferRelativeDateRange('Co se delo tento tyden v paid trafficu?', now);
  assert(thisWeek?.dateFrom === '2026-05-25' && thisWeek?.dateTo === '2026-05-25', 'Relative parser musi umet tento tyden od pondeli do dneska.');

  const lastWeek = inferRelativeDateRange('Porovnej minulý týden proti tomuto týdnu.', now);
  assert(lastWeek?.dateFrom === '2026-05-18' && lastWeek?.dateTo === '2026-05-24', 'Relative parser musi umet minuly tyden.');

  const trailingMonth = inferRelativeDateRange('Jak si vedeme za posledni mesic?', now);
  assert(trailingMonth?.dateFrom === '2026-04-26' && trailingMonth?.dateTo === '2026-05-25', 'Relative parser musi umet poslednich 30 dni.');

  const lastMonth = inferRelativeDateRange('Co se zmenilo minuly mesic?', now);
  assert(lastMonth?.dateFrom === '2026-04-01' && lastMonth?.dateTo === '2026-04-30', 'Relative parser musi umet minuly mesic jako kalendarni mesic.');

  return { id: 'relative_date_ranges', status: 'pass' };
}

const SCENARIOS = [
  runCapabilitiesOverviewScenario,
  runKnowledgeReviewScenario,
  runTrustedBestPracticesScenario,
  runAssortmentStrategyScenario,
  runStorefrontWalkthroughScenario,
  runShippingRevenueScenario,
  runDailyBriefingScenario,
  runAovDropScenario,
  runMarginDropScenario,
  runHighPnoScenario,
  runOrderDropIntradayScenario,
  runProductMixChangeScenario,
  runCampaignMixChangeScenario,
  runCampaignPerformanceScenario,
  runCountryChangeScenario,
  runSearchVsShoppingScenario,
  runLandingPageGuardrailScenario,
  runBundleMarginScenario,
  runMissingBuyPricesScenario,
  runCompetitorScenario,
  runMissingMetaScenario,
  runImportLogisticsOnTheWayScenario,
  runImportStockoutRiskScenario,
  runImportLandedCostChangeScenario,
  runImportDataQualityScenario,
  runAdversarialScenario,
  runLlmGuardrailStaticScenario,
  runMemoryCandidateStaticScenario,
  runRelativeDateRangeScenario,
];

function main() {
  const evalData = readJson(EVALS_PATH);
  const coveredIds = new Set();
  const results = [];

  for (const runScenario of SCENARIOS) {
    const result = runScenario();
    coveredIds.add(result.id);
    results.push(result);
  }

  const skipped = evalData.evals
    .map((evaluation) => evaluation.id)
    .filter((id) => !coveredIds.has(id));

  console.log(`[pokec-evals] Passed ${results.length}/${results.length} local synthetic scenarios.`);
  for (const result of results) {
    console.log(`  PASS ${result.id}`);
  }
  if (skipped.length) {
    console.log(`[pokec-evals] Not covered by local synthetic harness yet: ${skipped.join(', ')}`);
  }
}

main();
