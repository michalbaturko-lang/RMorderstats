import { createClient } from '@supabase/supabase-js';
import { getCurrencyRateToCzk } from '../src/currencyRates.js';
import {
  IMPORT_GROWTH_MONTHLY as IMPORT_LOGISTICS_GROWTH_MONTHLY,
  normalizeOrderCode as normalizeImportOrderCode,
  predictStockoutDate as predictImportStockoutDate,
} from '../src/importLogisticsCore.js';
import {
  attachPurchasePriceLookup,
  buildPurchasePriceLookup,
  getOrderLineItems,
  getLineBuyPriceWithoutVat,
  getLineQuantity,
  getLineRevenueWithoutVat,
} from '../src/orderLineItems.js';
import { isExcludedBusinessOrder } from '../src/businessOrderStatus.js';
import { MODULE_IDS, canAccessModule, normalizeEmail } from '../src/userPermissions.js';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SUPABASE_URL = 'https://oonnawrfsbsbuijmfcqj.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vbm5hd3Jmc2JzYnVpam1mY3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMjA4ODcsImV4cCI6MjA4NTg5Njg4N30.d1jk1BYOc6eEx-KJzGpW3ekfDs4jxW10VgKmLef8f1Y';
const ALLOWED_DOMAINS = (process.env.AUTH_ALLOWED_EMAIL_DOMAINS || 'regalmaster.cz,smartbidding.cz')
  .split(',')
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean);
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const POKEC_AI_MODE = (process.env.POKEC_AI_MODE || 'tool_first').toLowerCase();
const POKEC_OPENAI_MODEL = process.env.POKEC_OPENAI_MODEL || 'gpt-5.2';
const MARKET_LABELS = { all: 'všechny země', cz: 'Česko', sk: 'Slovensko', hu: 'Maďarsko', ro: 'Rumunsko', unknown: 'neznámá země' };
const MARKET_ORDER = ['cz', 'sk', 'hu', 'ro', 'unknown'];
const EXCLUDED_STATUSES = ['STORNO', 'Platba selhala'];
const SUPPORTED_MARKETS = ['all', 'cz', 'sk', 'hu', 'ro', 'unknown'];
const MEMORY_TYPES = ['insight', 'decision', 'hypothesis', 'experiment', 'meeting_note', 'example', 'data_quality'];
const IMPORT_LOGISTICS_INTENTS = ['import_logistics_overview', 'stockout_risk', 'inbound_eta', 'landed_cost_change', 'import_data_quality'];
const IMPORT_LOGISTICS_VELOCITY_WINDOWS = [7, 14, 30];
const INTENT_TOPICS = {
  daily_briefing: 'business',
  capabilities_overview: 'business',
  knowledge_review: 'business',
  trusted_best_practices: 'cro',
  aov_drop: 'aov',
  assortment_strategy: 'products',
  product_lookup: 'products',
  storefront_walkthrough: 'storefront',
  shipping_revenue: 'shipping',
  margin_drop: 'margin',
  high_pno: 'ads',
  order_drop_intraday: 'orders',
  product_mix_change: 'products',
  campaign_mix_change: 'ads',
  campaign_performance: 'ads',
  country_change: 'markets',
  missing_data: 'business',
  bundle_diagnostics: 'bundles',
  landing_page_problem: 'landing_pages',
  competitor_change: 'competition',
  import_logistics_overview: 'import_logistics',
  stockout_risk: 'import_logistics',
  inbound_eta: 'import_logistics',
  landed_cost_change: 'import_logistics',
  import_data_quality: 'import_logistics',
};
const PLAYBOOK_HINTS = {
  daily_briefing: {
    title: 'Denní briefing',
    requiredTools: ['get_orders_summary', 'get_margin_breakdown', 'compare_periods', 'get_ads_spend', 'get_relevant_memories'],
    desirableSignals: ['top SKU posun', 'landing pages s nejvyšším spendem', 'small GA funnel / commerce', 'otevřené otázky z knowledge layer', 'data freshness'],
  },
  capabilities_overview: {
    title: 'Co umím a k jakým datům mám přístup',
    requiredTools: ['get_known_contexts', 'get_data_freshness'],
    desirableSignals: ['datový katalog', 'tool registry', 'read-only guardrails', 'známé limity zdrojů'],
  },
  knowledge_review: {
    title: 'Knowledge review',
    requiredTools: ['get_known_contexts', 'get_relevant_memories', 'get_relevant_examples', 'get_data_freshness'],
    desirableSignals: ['schválené business pravdy', 'produktový mozek', 'market heuristiky', 'otevřené otázky'],
  },
  trusted_best_practices: {
    title: 'Důvěryhodné best practices pro CRO / Google Ads / Meta',
    requiredTools: ['get_known_contexts', 'get_relevant_examples', 'get_meeting_notes', 'get_experiments', 'get_data_freshness'],
    desirableSignals: ['Google Ads official guidance', 'Meta official guidance', 'Baymard UX research', 'co už je potvrzené u Regal Master'],
  },
  assortment_strategy: {
    title: 'Sortiment a pricing strategy',
    requiredTools: ['get_product_mix', 'get_margin_breakdown', 'get_bundle_analysis', 'get_missing_buy_prices', 'compare_periods', 'get_known_contexts'],
    desirableSignals: ['traffic vs margin role', 'family taxonomy', 'stock-out caveat', 'bundle leverage'],
  },
  product_lookup: {
    title: 'Konkrétní produkt',
    requiredTools: ['get_product_mix', 'get_margin_breakdown', 'get_missing_buy_prices'],
    desirableSignals: ['kanonická UpGates nákupka', 'prodejní mix podle období', 'jednotková marže', 'market/currency rozpad'],
  },
  storefront_walkthrough: {
    title: 'Shop walkthrough memory',
    requiredTools: ['get_known_contexts', 'get_ads_landing_pages', 'get_small_ga_landing_pages', 'get_data_freshness'],
    desirableSignals: ['homepage signals', 'category framing', 'bundle visibility', 'visual evidence boundary'],
  },
  shipping_revenue: {
    title: 'Tržba z poštovného a doběrečného',
    requiredTools: ['get_orders_summary', 'get_shipping_revenue', 'compare_periods'],
    desirableSignals: ['rozpad po dnech', 'rozpad podle zemí', 'oddělení od obratu zboží', 'read-only definice'],
  },
  aov_drop: {
    title: 'Pokles AOV',
    requiredTools: ['get_orders_summary', 'get_product_mix', 'get_bundle_analysis', 'compare_periods', 'get_ads_spend', 'get_ads_landing_pages', 'get_relevant_memories'],
    desirableSignals: ['small_ga_landing_pages', 'cenové buckety objednávek', 'B2B/B2C změna', 'aktuální Matrix scrape'],
  },
  margin_drop: {
    title: 'Pokles marže',
    requiredTools: ['get_margin_breakdown', 'get_product_mix', 'get_bundle_analysis', 'compare_periods', 'get_ads_spend', 'get_relevant_memories'],
    desirableSignals: ['low-margin SKU proti referenci', 'chybějící buy_price', 'campaign/product linkage'],
  },
  high_pno: {
    title: 'Vysoké PNO',
    requiredTools: ['get_orders_summary', 'get_margin_breakdown', 'get_ads_spend', 'compare_periods'],
    desirableSignals: ['provider split Google/Meta', 'platform vs real ROAS', 'freshness spend syncu', 'spend bez objednávek', 'small GA source/campaign quality', 'small GA paid landing page funnel', 'small GA checkout / purchase completion'],
  },
  order_drop_intraday: {
    title: 'Propad objednávek během dne',
    requiredTools: ['get_orders_summary', 'compare_periods', 'get_data_freshness'],
    desirableSignals: ['hodinový rozpad objednávek', 'small GA sessions', 'small GA funnel rates', 'small GA checkout completion', 'Ads freshness', 'market split'],
  },
  product_mix_change: {
    title: 'Změna produktového mixu',
    requiredTools: ['get_product_mix', 'compare_periods', 'get_margin_breakdown'],
    desirableSignals: ['share point changes', 'low-margin movers', 'bundle share', 'market split'],
  },
  campaign_mix_change: {
    title: 'Změna kampanového mixu',
    requiredTools: ['get_ads_spend', 'get_ads_campaigns', 'compare_periods', 'get_data_freshness'],
    desirableSignals: ['search vs shopping share', 'provider split', 'landing pages', 'small GA source/campaign funnel', 'small GA landing funnel', 'spend without orders'],
  },
  campaign_performance: {
    title: 'Výkon kampaní',
    requiredTools: ['get_ads_campaigns', 'get_meta_campaigns', 'get_small_ga_funnel', 'get_data_freshness'],
    desirableSignals: ['platform conversion value', 'platform conversion rate', 'small GA purchase rate', 'provider split', 'missing real campaign revenue disclosure'],
  },
  country_change: {
    title: 'Změna v konkrétní zemi',
    requiredTools: ['get_orders_summary', 'get_margin_breakdown', 'get_ads_spend', 'compare_periods'],
    desirableSignals: ['market comparison', 'country-specific LP', 'country-specific campaign mix', 'B2B share'],
  },
  bundle_diagnostics: {
    title: 'Balíčky',
    requiredTools: ['get_bundle_analysis', 'get_margin_breakdown', 'get_product_mix', 'compare_periods'],
    desirableSignals: ['jasné pravidlo detekce balíčků', 'SKU breakdown', 'dopad na AOV i marži'],
  },
  landing_page_problem: {
    title: 'Landing pages',
    requiredTools: ['get_ads_landing_pages', 'get_product_mix', 'get_ads_spend', 'compare_periods'],
    desirableSignals: ['small_ga paid/organic landing pages', 'vizuální kontrola stránky', 'HP vs kategorie vs detail produktu'],
  },
  competitor_change: {
    title: 'Konkurence',
    requiredTools: ['get_product_mix', 'compare_periods', 'get_relevant_memories'],
    desirableSignals: ['aktuální Matrix scrape', 'změna cen', 'změna dostupnosti', 'nové produkty konkurence'],
  },
  import_logistics_overview: {
    title: 'Importní logistika: objednávky na cestě',
    requiredTools: ['get_import_orders_on_the_way', 'get_import_document_coverage', 'get_import_match_gaps'],
    desirableSignals: ['ETA Brno', 'containers', 'matched %', 'missing prices', 'missing KN/freight invoices', 'Čína 0526 jako Čína 13'],
  },
  stockout_risk: {
    title: 'Riziko výpadku proti inboundu',
    requiredTools: ['get_inbound_stock_risk', 'get_import_orders_on_the_way'],
    desirableSignals: ['7/14/30 velocity', '+20 % MoM forecast', 'business-clean orders', 'market split CZ/SK/HU/RO', 'coverage before stockout claim'],
  },
  inbound_eta: {
    title: 'ETA importů a kontejnerů',
    requiredTools: ['get_import_orders_on_the_way', 'get_import_order_detail'],
    desirableSignals: ['Čína 9/10/11/12/13', 'ETA port', 'ETA Brno', 'shipments', 'containers', 'unknown quantity disclosure'],
  },
  landed_cost_change: {
    title: 'Změna nákupky a landed cost',
    requiredTools: ['get_landed_cost_changes', 'get_import_document_coverage'],
    desirableSignals: ['Upgates NC', 'buy price', 'allocated freight per unit', 'landed unit cost', 'missing price/freight coverage'],
  },
  import_data_quality: {
    title: 'Kvalita importních dat',
    requiredTools: ['get_import_match_gaps', 'get_import_document_coverage', 'get_import_orders_on_the_way'],
    desirableSignals: ['unmatched rows', 'ambiguous matches', 'missing documents', 'missing prices', 'Čína 13 unknown quantities'],
  },
};
const AI_INTERPRETATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'confidence', 'interpretation', 'hypotheses', 'missingData', 'nextSteps', 'questionsToAsk', 'guardrailNotes'],
  properties: {
    verdict: { type: 'string' },
    confidence: { type: 'string', enum: ['nízká', 'střední', 'vyšší'] },
    interpretation: { type: 'string' },
    hypotheses: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    missingData: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    nextSteps: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    questionsToAsk: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    guardrailNotes: { type: 'array', items: { type: 'string' }, maxItems: 6 },
  },
};

const toNumber = (value) => {
  const number = Number(String(value ?? 0).replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
};
const round = (value, digits = 2) => Number(toNumber(value).toFixed(digits));
const formatNumber = (value) => Math.round(toNumber(value)).toLocaleString('cs-CZ');
const formatCurrency = (value) => `${formatNumber(value)} Kč`;
const formatPercent = (value) => `${round(value, 1).toLocaleString('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const formatCoverageAwareMargin = (row) => {
  if (toNumber(row?.exactRevenue) <= 0) return 'neúplné';
  if (toNumber(row?.incompleteRevenue) > 0 || toNumber(row?.missingBuyPriceQty) > 0) {
    return `${formatPercent(row.grossProfitPct)} · pokrytí ${formatPercent(row.marginCoveragePct)}`;
  }
  return formatPercent(row.grossProfitPct);
};
const getOrderNumber = (order) => order.raw_data?.order_number || order.order_number || order.id;
const getOrderCurrency = (order) => order.currency || order.raw_data?.currency_id || order.raw_data?.currency?.code || order.raw_data?.currency || 'CZK';
const getRate = (order) => getCurrencyRateToCzk(getOrderCurrency(order));
const getMarket = (order) => order.market || order.raw_data?.market || 'unknown';
const cleanText = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const isoDate = (date) => date.toISOString().slice(0, 10);
const clampText = (value, maxLength) => String(value || '').trim().slice(0, maxLength);
const hashIdentifier = (value) => createHash('sha256').update(String(value || 'anonymous')).digest('hex').slice(0, 32);
const asksForDetail = (question) => /detail|podrob|komplex|audit|rozpad|tabulk|evidenc|playbook|zdroj|proc|proč|analyz|diagnostik/.test(cleanText(question));
const SMALL_GA_SESSION_TABLE = process.env.GA_SESSIONS_TABLE || 'sl_session_recordings';
const SMALL_GA_EVENTS_TABLE = process.env.GA_EVENTS_TABLE || 'sl_events';
const SMALL_GA_CARTS_TABLE = process.env.GA_CARTS_TABLE || 'sl_carts';
const SMALL_GA_PURCHASES_TABLE = process.env.GA_PURCHASES_TABLE || 'sl_purchases';
const SMALL_GA_SITE_COLUMN = process.env.GA_SITE_COLUMN || 'site_key';
const SMALL_GA_DATE_COLUMN = process.env.GA_SESSION_DATE_COLUMN || 'started_at';
const SMALL_GA_EVENT_DATE_COLUMN = process.env.GA_EVENT_DATE_COLUMN || 'created_at';
const API_DIRNAME = path.dirname(fileURLToPath(import.meta.url));

function readLocalJson(relativePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(API_DIRNAME, relativePath), 'utf8'));
  } catch {
    return fallback;
  }
}

const PLAYBOOK_REGISTRY = readLocalJson('../src/ai/pokec-playbooks.json', { playbooks: [] });
const DATA_SOURCES_REGISTRY = readLocalJson('../src/ai/pokec-data-sources.json', { sources: [] });
const TOOL_REGISTRY = readLocalJson('../src/ai/pokec-tool-registry.json', { tools: [] });
const TOOL_REGISTRY_BY_ID = new Map((Array.isArray(TOOL_REGISTRY.tools) ? TOOL_REGISTRY.tools : []).map((tool) => [tool.id, tool]));
const DATA_SOURCE_BY_ID = new Map((Array.isArray(DATA_SOURCES_REGISTRY.sources) ? DATA_SOURCES_REGISTRY.sources : []).map((source) => [source.id, source]));
const LOCAL_KNOWLEDGE_CONTEXTS = [
  {
    slug: 'revenue-aov-shipping-definition',
    title: 'Revenue, AOV and shipping definition',
    body: 'Revenue for Regal Master means product revenue without VAT and without shipping. AOV uses the same product revenue basis. Shipping and cash-on-delivery revenue must stay outside product revenue and outside PNO.',
    topic: 'definitions',
    market: null,
    confidence: 'confirmed',
    evidence: [{ source: 'supabase/ai_kolega_seed.sql' }],
    updated_at: '2026-05-25',
  },
  {
    slug: 'margin-definition',
    title: 'Gross profit and margin definition',
    body: 'Gross profit is product selling price without VAT minus product buy price without VAT. Orders with missing buy prices must be disclosed as incomplete and must not be treated as exact margin evidence.',
    topic: 'margin',
    market: null,
    confidence: 'confirmed',
    evidence: [{ source: 'supabase/ai_kolega_seed.sql' }],
    updated_at: '2026-05-25',
  },
  {
    slug: 'three-month-priority-clear-warehouse',
    title: 'Three month priority: maximize turnover and clear warehouse',
    body: 'For the next three months Regal Master prioritizes revenue and stock rotation over margin optimization. A near-term warehouse influx makes turnover and stock clearance strategically more important than perfect margin quality.',
    topic: 'business_goals',
    market: null,
    confidence: 'confirmed',
    evidence: [{ source: 'docs/ai-kolega-knowledge-review.md' }],
    updated_at: '2026-05-25',
  },
  {
    slug: 'twelve-month-targets-2026',
    title: 'Twelve month target profile for 2026',
    body: 'The year-end target is to reach 12 million CZK revenue without VAT, maintain HV1 above 60 percent and HV2 above 35 percent, while scaling across CZ, SK, HU and RO.',
    topic: 'business_goals',
    market: null,
    confidence: 'confirmed',
    evidence: [{ source: 'docs/ai-kolega-knowledge-review.md' }],
    updated_at: '2026-05-25',
  },
  {
    slug: 'pno-alarm-thresholds',
    title: 'PNO alarm thresholds',
    body: 'PNO above 30 percent is a major alarm during the current growth phase. After a market stabilizes, PNO above 25 percent is a problem. Pokec must restate the metric definition carefully when owner shorthand mixes with dashboard definitions.',
    topic: 'ads',
    market: null,
    confidence: 'confirmed',
    evidence: [{ source: 'docs/ai-kolega-knowledge-review.md' }],
    updated_at: '2026-05-25',
  },
  {
    slug: 'healthy-aov-thresholds',
    title: 'Healthy AOV thresholds',
    body: 'Healthy AOV is 2 000 CZK plus VAT and shipping or better. 2 200 CZK plus VAT and shipping is very good. Below 2 000 CZK is a business problem, and below 1 500 CZK plus VAT is poor order quality unless there is a strong strategic reason.',
    topic: 'aov',
    market: null,
    confidence: 'confirmed',
    evidence: [{ source: 'docs/ai-kolega-knowledge-review.md' }],
    updated_at: '2026-05-25',
  },
  {
    slug: 'b2b-priority-signal',
    title: 'B2B customers are strategically preferable',
    body: 'Shelving is bought by both consumers and companies, but company customers are strategically preferable because they usually drive higher AOV. Pokec should treat B2B mix deterioration as an important warning.',
    topic: 'b2b',
    market: null,
    confidence: 'confirmed',
    evidence: [{ source: 'docs/ai-kolega-knowledge-review.md' }],
    updated_at: '2026-05-25',
  },
  {
    slug: 'product-family-taxonomy',
    title: 'Product families Pokec must understand',
    body: 'Pokec must recognize boltless, rivet, robust and profesionální as real business product families. It should also know that 1800x900x400 and 1800x900x300 often act as strong traffic-driver families, while larger families can be under-stocked rather than weak.',
    topic: 'products',
    market: null,
    confidence: 'confirmed',
    evidence: [{ source: 'docs/ai-kolega-knowledge-review.md' }],
    updated_at: '2026-05-25',
  },
  {
    slug: 'landing-page-visual-guardrail',
    title: 'Landing page visual guardrail',
    body: 'Pokec may analyze Ads landing page data and small GA landing page behavior, but it must not claim what a page visually shows, how products are sorted, or what the hero emphasizes unless it has browser or screenshot evidence.',
    topic: 'landing_pages',
    market: null,
    confidence: 'confirmed',
    evidence: [{ source: 'supabase/ai_kolega_seed.sql' }],
    updated_at: '2026-05-25',
  },
  {
    slug: 'small-ga-behavior-layer',
    title: 'Small GA is a behavioral layer, not an order revenue replacement',
    body: 'Small GA is used to read sessions, source and campaign mix, landing pages, add-to-cart, checkout and purchase behavior. It is a behavioral funnel layer and must not be treated as a replacement for real order revenue from orders or for platform spend data from Ads and Meta.',
    topic: 'ads',
    market: null,
    confidence: 'confirmed',
    evidence: [{ source: 'docs/ai-kolega-small-ga-map.md' }],
    updated_at: '2026-05-25',
  },
  {
    slug: 'import-logistics-read-only-doctrine',
    title: 'Import logistics doctrine',
    body: 'Pokec answers import logistics questions from live Supabase import logistics views and Upgates stock/purchase-price data. It is read-only: it must not change import statuses, upload documents or repair product matches. Čína 0526 is the source sheet for business order Čína 13. Forecasts must disclose +20 % month-over-month growth and business-clean sales velocity excluding STORNO and failed payments.',
    topic: 'import_logistics',
    market: null,
    confidence: 'confirmed',
    evidence: [{ source: 'supabase/import_logistics.sql' }],
    updated_at: '2026-05-27',
  },
];
const LOCAL_OPEN_QUESTIONS = [
  {
    title: 'Refresh public storefront walkthroughs periodically',
    body: 'Storefront copy, categories, bundle modules and shipping banners can change. Pokec should periodically refresh storefront memory so visible shop claims stay current.',
    topic: 'storefront',
    market: null,
    priority: 'medium',
    needed_data: ['fresh homepage snapshots by market', 'fresh category snapshots', 'fresh PDP snapshots for top sellers'],
    updated_at: '2026-05-25',
  },
  {
    title: 'Build assortment ladders by family, finish and pack size',
    body: 'Pokec should aggregate SKU-level data into merchant-friendly assortment ladders so it can explain whether growth comes from healthy breadth or overconcentration in cheap entry shelves.',
    topic: 'products',
    market: null,
    priority: 'high',
    needed_data: ['SKU parser for dimensions and pack size', 'family mapping table', 'margin by family ladder'],
    updated_at: '2026-05-25',
  },
  {
    title: 'Curate trusted external CRO and paid-media doctrine for Pokec',
    body: 'Pokec should maintain a vetted external doctrine layer sourced from primary platform docs and high-quality ecommerce UX research, where Google Ads, Meta and Baymard outrank agency folklore unless local evidence proves otherwise.',
    topic: 'cro',
    market: null,
    priority: 'medium',
    needed_data: ['official Google Ads guidance mapping', 'official Meta guidance mapping', 'Baymard UX checklist'],
    updated_at: '2026-05-25',
  },
];

function cors(res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function isMissingSupabaseRelationError(error) {
  const message = cleanText(error?.message || '');
  return (
    message.includes('could not find the table') ||
    message.includes('schema cache') ||
    (message.includes('relation') && message.includes('does not exist'))
  );
}

function pragueOffset(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Prague',
    timeZoneName: 'shortOffset',
  });
  const zone = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || 'GMT+1';
  const match = zone.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return '+01:00';
  return `${match[1]}${String(match[2]).padStart(2, '0')}:${match[3] || '00'}`;
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function getField(row, names) {
  for (const name of names) {
    if (row?.[name] !== undefined && row?.[name] !== null && row?.[name] !== '') return row[name];
  }
  return null;
}

function parseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    try {
      return new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }
}

function normalizeUrl(value) {
  const parsed = parseUrl(value);
  if (!parsed) return String(value || '').trim() || 'neznámá URL';
  const pathname = parsed.pathname.replace(/\/+/g, '/');
  return `${parsed.origin}${pathname === '/' ? '/' : pathname.replace(/\/$/, '')}`;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function summarizeKnowledgeEvidence(row) {
  const evidence = row?.evidence;
  const entries = asArray(evidence).length
    ? asArray(evidence)
    : Array.isArray(evidence?.sources)
      ? evidence.sources
      : evidence?.source
        ? [evidence]
        : [];

  return entries
    .map((entry) => {
      const source = clampText(entry?.source || entry?.label || entry?.type || '', 60);
      const url = clampText(entry?.url || entry?.source_url || '', 120);
      return [source, url].filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .slice(0, 2)
    .join(' | ');
}

function rowHasVisualEvidence(row) {
  const haystack = cleanText(JSON.stringify(asArray(row?.evidence)));
  return /(screenshot|browser|storefront walkthrough|public storefront walkthrough|scrape|snapshot)/.test(haystack);
}

function classifyPageType(value) {
  const parsed = parseUrl(value);
  if (!parsed) return 'other';
  const pathname = normalizeUrl(value).replace(parsed.origin, '');
  const normalized = cleanText(pathname);
  if (normalized === '/' || normalized === '') return 'hp';
  if (/(^|\/)(c|kategorie|category|categorie|categoria|kategoriak|regaly|regal|polc|polce|raft|rafturi|kovove-regaly|kovove-regale)(\/|$|-)/.test(normalized)) {
    return /sale|akce|vypredaj|lichidare|liquidare|najlacnejs|nejlevnejs/.test(normalized) ? 'cheap_category' : 'category';
  }
  if (/\d{3,4}[-x× ]+\d{2,4}[-x× ]+\d{2,4}|produkt|product|detail|item/.test(normalized)) return 'product';
  return 'other';
}

function smallGaSiteKeys(market) {
  if (market && market !== 'all' && market !== 'unknown') return [market];
  return ['cz', 'sk', 'hu', 'ro'];
}

function applySmallGaSiteFilter(query, siteKeys) {
  const normalized = Array.isArray(siteKeys)
    ? siteKeys
      .map((value) => cleanText(value).replace(/[^a-z0-9_-]/g, ''))
      .filter(Boolean)
    : [];
  if (!normalized.length) return query;
  const clauses = normalized.map((value) => `${SMALL_GA_SITE_COLUMN}.eq.${value}`);
  // Newer small GA session rows can have site_key = null while page_url/page_host
  // still identify the market. Include null rows and filter by inferred market in JS.
  clauses.push(`${SMALL_GA_SITE_COLUMN}.is.null`);
  return query.or(clauses.join(','));
}

function smallGaChannelBucket(session) {
  const source = cleanText(getField(session, ['source', 'utm_source', 'traffic_source', 'channel_source']));
  const medium = cleanText(getField(session, ['medium', 'utm_medium', 'traffic_medium', 'channel_medium']));
  const channel = cleanText(getField(session, ['channel_group', 'channel', 'source_medium']));
  const combined = `${source} ${medium} ${channel}`;
  if (/(cpc|ppc|paid|adwords|ads|shopping|paid_search)/.test(combined)) return 'paid';
  if (/(organic|seo)/.test(combined)) return 'organic';
  if (/(direct|\(direct\)|none)/.test(combined)) return 'direct';
  if (/(email|newsletter)/.test(combined)) return 'email';
  return 'other';
}

function sessionLandingUrl(session) {
  return getField(session, ['landing_page_url', 'landing_url', 'entry_url', 'initial_url', 'page_url', 'url']);
}

function smallGaJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function inferMarketFromText(value) {
  const haystack = cleanText(value);
  if (!haystack) return null;
  if (/\bcz\b|vyprodej-regalu|regalmaster\.cz/.test(haystack)) return 'cz';
  if (/\bsk\b|vypredaj-regalov/.test(haystack)) return 'sk';
  if (/\bhu\b|polc-kiarusitas/.test(haystack)) return 'hu';
  if (/\bro\b|lichidare-rafturi/.test(haystack)) return 'ro';
  return null;
}

function smallGaMarket(row) {
  return inferMarketFromText(
    getField(row, ['site_key', 'site_domain', 'page_host', 'page_url', 'referrer'])
      || row?.properties?.site_key
      || row?.event_data?.site_key
      || ''
  ) || 'unknown';
}

function smallGaEventPayload(row) {
  const properties = smallGaJson(row?.properties) || {};
  const eventData = smallGaJson(row?.event_data) || {};
  return {
    ...eventData,
    ...properties,
    eventData,
    properties,
  };
}

function smallGaTrafficFields(row) {
  const payload = smallGaEventPayload(row);
  const source = getField(row, ['source', 'utm_source']) || payload.source || payload.utm_source || 'neznámý zdroj';
  const medium = getField(row, ['medium', 'utm_medium']) || payload.medium || payload.utm_medium || 'neznámý medium';
  const campaign = getField(row, ['campaign', 'utm_campaign']) || payload.campaign || payload.utm_campaign || 'bez kampaně';
  const content = getField(row, ['utm_content']) || payload.utm_content || '';
  const term = getField(row, ['utm_term']) || payload.utm_term || '';
  const channelGroup = getField(row, ['channel_group']) || payload.channel_group || payload.channel || '';
  const channelBucket = smallGaChannelBucket({
    ...row,
    source,
    medium,
    channel_group: channelGroup,
  });
  return { source, medium, campaign, content, term, channelGroup, channelBucket };
}

function smallGaLandingValue(row) {
  const payload = smallGaEventPayload(row);
  return payload.landing_page
    || payload.landingPage
    || payload.entry_url
    || payload.initial_url
    || getField(row, ['page_url', 'url']);
}

function smallGaSessionId(row) {
  return getField(row, ['session_id']) || smallGaEventPayload(row).session_id || null;
}

function smallGaVisitorId(row) {
  return getField(row, ['visitor_id', 'visitor_cookie_id']) || smallGaEventPayload(row).visitor_id || null;
}

function smallGaTimestamp(row) {
  return getField(row, ['timestamp', SMALL_GA_DATE_COLUMN, 'created_at', 'updated_at']) || null;
}

function smallGaValueCzk(value, currency) {
  const rate = FX[String(currency || 'CZK').toUpperCase()] || 1;
  return toNumber(value) * rate;
}

function isSmallGaPurchaseEvent(row) {
  const eventName = cleanText(getField(row, ['event_name']));
  const eventType = cleanText(getField(row, ['event_type']));
  return eventName === 'purchase' || eventType === 'purchase';
}

function isSmallGaCheckoutEvent(row) {
  const eventName = cleanText(getField(row, ['event_name']));
  const eventType = cleanText(getField(row, ['event_type']));
  return ['begin_checkout', 'add_shipping_info', 'add_payment_info'].includes(eventName)
    || ['begin_checkout', 'add_shipping_info', 'add_payment_info'].includes(eventType);
}

function isSmallGaAddToCartEvent(row) {
  const eventName = cleanText(getField(row, ['event_name']));
  const eventType = cleanText(getField(row, ['event_type']));
  return eventName === 'add_to_cart' || eventType === 'add_to_cart';
}

function isSmallGaCartEvent(row) {
  const eventName = cleanText(getField(row, ['event_name']));
  const eventType = cleanText(getField(row, ['event_type']));
  return ['add_to_cart', 'view_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'remove_from_cart']
    .includes(eventName)
    || ['add_to_cart', 'view_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'remove_from_cart']
      .includes(eventType);
}

function isSmallGaLandingCandidate(row) {
  const eventName = cleanText(getField(row, ['event_name']));
  const eventType = cleanText(getField(row, ['event_type']));
  return eventName === 'page_view'
    || eventType === 'page_view'
    || (eventName === 'campaign_visit' && eventType === 'custom')
    || Boolean(smallGaLandingValue(row));
}

function smallGaWithinMarket(row, market) {
  if (!market || market === 'all') return true;
  return smallGaMarket(row) === market;
}

async function fetchSmallGaEvents({ supabase, dateFrom, dateTo, market, maxRows = 12000 }) {
  const siteKeys = smallGaSiteKeys(market);
  const rows = await fetchAll((from, to) => {
    let query = supabase
      .from(SMALL_GA_EVENTS_TABLE)
      .select('*')
      .gte(SMALL_GA_EVENT_DATE_COLUMN, `${dateFrom}T00:00:00Z`)
      .lte(SMALL_GA_EVENT_DATE_COLUMN, `${dateTo}T23:59:59Z`)
      .order(SMALL_GA_EVENT_DATE_COLUMN, { ascending: false })
      .range(from, to);
    return applySmallGaSiteFilter(query, siteKeys);
  }, 1000, maxRows);
  return rows.filter((row) => smallGaWithinMarket(row, market));
}

async function fetchSmallGaCarts({ supabase, dateFrom, dateTo, market, maxRows = 4000 }) {
  const siteKeys = smallGaSiteKeys(market);
  const rows = await fetchAll((from, to) => {
    let query = supabase
      .from(SMALL_GA_CARTS_TABLE)
      .select('*')
      .gte('first_seen_at', `${dateFrom}T00:00:00Z`)
      .lte('first_seen_at', `${dateTo}T23:59:59Z`)
      .order('first_seen_at', { ascending: false })
      .range(from, to);
    return applySmallGaSiteFilter(query, siteKeys);
  }, 1000, maxRows);
  return rows.filter((row) => smallGaWithinMarket(row, market));
}

async function fetchSmallGaPurchases({ supabase, dateFrom, dateTo, market, maxRows = 4000 }) {
  const siteKeys = smallGaSiteKeys(market);
  const rows = await fetchAll((from, to) => {
    let query = supabase
      .from(SMALL_GA_PURCHASES_TABLE)
      .select('*')
      .gte('created_at', `${dateFrom}T00:00:00Z`)
      .lte('created_at', `${dateTo}T23:59:59Z`)
      .order('created_at', { ascending: false })
      .range(from, to);
    return applySmallGaSiteFilter(query, siteKeys);
  }, 1000, maxRows);
  return rows.filter((row) => smallGaWithinMarket(row, market));
}

function daysInclusive(dateFrom, dateTo) {
  const from = new Date(`${dateFrom}T12:00:00Z`);
  const to = new Date(`${dateTo}T12:00:00Z`);
  return Math.max(1, Math.round((to - from) / 86400000) + 1);
}

function previousPeriod(dateFrom, dateTo) {
  const days = daysInclusive(dateFrom, dateTo);
  const previousTo = addDays(dateFrom, -1);
  const previousFrom = addDays(previousTo, -(days - 1));
  return { dateFrom: previousFrom, dateTo: previousTo, days };
}

function startOfWeek(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return isoDate(date);
}

function endOfWeek(dateKey) {
  return addDays(startOfWeek(dateKey), 6);
}

function startOfMonth(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(1);
  return isoDate(date);
}

function endOfMonth(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return isoDate(date);
}

function inferRelativeDateRange(question, now = new Date()) {
  const q = cleanText(question);
  const today = isoDate(now);

  if (/\bvcera\b|\bvčera\b|yesterday/.test(q)) {
    const day = addDays(today, -1);
    return { dateFrom: day, dateTo: day, source: 'question_relative', label: 'včera' };
  }
  if (/\bdnes\b|today/.test(q)) {
    return { dateFrom: today, dateTo: today, source: 'question_relative', label: 'dnes' };
  }
  if (/tento tyden|tenhle tyden|this week/.test(q)) {
    return { dateFrom: startOfWeek(today), dateTo: today, source: 'question_relative', label: 'tento týden' };
  }
  if (/minuly tyden|minul[yý] tyden|last week/.test(q)) {
    const prevWeekEnd = addDays(startOfWeek(today), -1);
    return { dateFrom: startOfWeek(prevWeekEnd), dateTo: endOfWeek(prevWeekEnd), source: 'question_relative', label: 'minulý týden' };
  }
  if (/posledni tyden|poslednich 7 dni|last 7 days/.test(q)) {
    return { dateFrom: addDays(today, -6), dateTo: today, source: 'question_relative', label: 'posledních 7 dní' };
  }
  if (/tento mesic|this month/.test(q)) {
    return { dateFrom: startOfMonth(today), dateTo: today, source: 'question_relative', label: 'tento měsíc' };
  }
  if (/minuly mesic|minul[yý] mesic|last month/.test(q)) {
    const prevMonthAnyDay = addDays(startOfMonth(today), -1);
    return { dateFrom: startOfMonth(prevMonthAnyDay), dateTo: endOfMonth(prevMonthAnyDay), source: 'question_relative', label: 'minulý měsíc' };
  }
  if (/posledni mesic|poslednich 30 dni|last 30 days/.test(q)) {
    return { dateFrom: addDays(today, -29), dateTo: today, source: 'question_relative', label: 'posledních 30 dní' };
  }
  return null;
}

function relativeChange(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function formatChangePct(current, previous) {
  const change = relativeChange(current, previous);
  if (change == null) return 'bez srovnání';
  const sign = change > 0 ? '+' : '';
  return `${sign}${formatPercent(change)}`;
}

function isExcludedOrder(order) {
  return isExcludedBusinessOrder(order);
}

function deduplicateOrders(orders) {
  const seen = new Set();
  return orders.filter((order) => {
    const key = getOrderNumber(order);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function orderRevenue(order) {
  const products = getOrderLineItems(order, { allowRawFallback: false });
  const rate = getRate(order);
  return products.reduce((sum, product) => sum + getLineRevenueWithoutVat(product) * rate, 0);
}

function orderShipping(order) {
  return toNumber(order.raw_data?.shipment?.price_without_vat) * getRate(order);
}

function orderMargin(order) {
  const products = getOrderLineItems(order, { allowRawFallback: false });
  const rate = getRate(order);
  let revenue = 0;
  let cost = 0;
  let missingItems = 0;

  for (const product of products) {
    const quantity = getLineQuantity(product);
    const buyPrice = getLineBuyPriceWithoutVat(product);
    revenue += getLineRevenueWithoutVat(product) * rate;
    if (buyPrice > 0) {
      cost += buyPrice * quantity * rate;
    } else {
      missingItems += 1;
    }
  }

  return {
    revenue,
    cost,
    profit: revenue - cost,
    profitPct: revenue ? ((revenue - cost) / revenue) * 100 : 0,
    complete: products.length > 0 && revenue > 0 && missingItems === 0,
    missingItems,
  };
}

function productCode(product) {
  return String(product.code || product.product_code || product.sku || 'bez_kodu');
}

function productTitle(product) {
  return String(product.title || product.name || product.product_name || '').trim();
}

function isBundleProduct(product) {
  const code = productCode(product);
  const title = cleanText(productTitle(product));
  return /_(3|5|10|20)$/i.test(code) || /\b(3|5|10|20)\s*ks\b|5ks|5buc/.test(title);
}

function dimensionFromProduct(product) {
  const source = `${productCode(product)} ${productTitle(product)}`;
  const explicit = source.match(/(1500|1600|1680|1800|1830|2000|2160|2200|2400|3120)[x× ]+(400|600|700|750|800|900|1000|1200|1400|1600|1800)[x× ]+(300|350|400|450|500|600|700)/i);
  if (explicit) return `${explicit[1]}×${explicit[2]}×${explicit[3]}`;
  const code = productCode(product).match(/^(\d{2})(\d{2})(\d{2})/);
  if (code) return `${Number(code[1]) * 100}×${Number(code[2]) * 100}×${Number(code[3]) * 10}`;
  return 'neznámý rozměr';
}

function packSizeFromProduct(product) {
  const code = productCode(product);
  const title = cleanText(productTitle(product));
  const codeMatch = code.match(/_(3|5|10|20)$/i);
  if (codeMatch) return `${codeMatch[1]} ks`;
  const titleMatch = title.match(/\b(3|5|10|20)\s*ks\b/i);
  if (titleMatch) return `${titleMatch[1]} ks`;
  return '1 ks';
}

function finishFromProduct(product) {
  const source = cleanText(`${productCode(product)} ${productTitle(product)}`);
  if (/full metal|celokov|all metal/.test(source)) return 'full metal';
  if (/zinkovan|zinc|galv/.test(source)) return 'zinkovaný';
  if (/lakovan|painted/.test(source)) return 'lakovaný';
  return 'jiný finish';
}

function colorFromProduct(product) {
  const source = cleanText(`${productCode(product)} ${productTitle(product)}`);
  if (/black|cerny|černý/.test(source)) return 'černý';
  if (/white|bily|bílý/.test(source)) return 'bílý';
  if (/red|cerveny|červený/.test(source)) return 'červený';
  if (/blue|modry|modrý/.test(source)) return 'modrý';
  if (/orange|oranz|oranž/.test(source)) return 'oranžový';
  if (/zinkovan|zinc|galv/.test(source)) return 'zink';
  return 'bez barvy / jiná';
}

function dimensionFromQuestion(question) {
  const match = String(question || '').match(/(\d{2,4})\s*[x×]\s*(\d{2,4})\s*[x×]\s*(\d{2,4})/i);
  if (!match) return null;

  const values = match.slice(1, 4).map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;

  const normalized = values.map((value, index) => {
    if (index === 0 && value < 1000) return value * 10;
    if (index > 0 && value < 200) return value * 10;
    return value;
  });

  return `${normalized[0]}×${normalized[1]}×${normalized[2]}`;
}

function requestedFinish(question) {
  const source = cleanText(question);
  if (/zink|pozink|galv/.test(source)) return 'zinkovaný';
  if (/lak|cern|čern|black|b[ií]l|white|red|blue|oranz|oran/.test(source)) return 'lakovaný';
  if (/full metal|celokov/.test(source)) return 'full metal';
  return null;
}

function requestedPackSize(question) {
  const source = cleanText(question);
  const match = source.match(/(?:_|\b)(3|5|10|20)\s*(?:ks|kusu|kus|buc)?\b/);
  return match ? `${match[1]} ks` : null;
}

function productLookupRequested(question) {
  const source = cleanText(question);
  return Boolean(
    dimensionFromQuestion(question)
      || /\b\d{8,}[a-z0-9_]*\b/i.test(String(question || ''))
      || (/regal|produkt|sku|ean|kod|kód/.test(source) && /marz|zisk|nakupk|nákupk|cena|prodej/.test(source))
  );
}

function heightLadderFromDimension(dimension) {
  const match = String(dimension || '').match(/^(\d{4})×/);
  if (!match) return 'neznámá výška';
  return `${match[1]} mm`;
}

function classifyProductFamily(rowOrProduct) {
  const source = cleanText(`${rowOrProduct?.title || productTitle(rowOrProduct)} ${rowOrProduct?.sku || productCode(rowOrProduct)}`);
  if (/double layer|double-layer/.test(source)) return 'double layer';
  if (/full metal|celokov|all metal/.test(source)) return 'full metal';
  if (/robust/.test(source)) return 'robust';
  if (/rivet/.test(source)) return 'rivet';
  if (/profesional|professional/.test(source)) return 'profesionalni';
  if (/zinkovan|lakovan|nosnost|regal|polc|raft/.test(source)) return 'boltless';
  return 'ostatní';
}

function classifyCommercialRole(row) {
  const dimension = cleanText(row.dimension || '');
  const family = cleanText(classifyProductFamily(row));
  if (dimension.includes('1800×900×400') || dimension.includes('1800×900×300')) return 'traffic driver';
  if (dimension.includes('2000') || dimension.includes('2200') || dimension.includes('2400')) return 'premium / stock-sensitive';
  if (family.includes('profesional') || family.includes('robust')) return 'margin / b2b candidate';
  if (row.isBundle) return 'bundle lever';
  if (row.grossProfitPct >= 60) return 'high-margin scaler';
  if (row.grossProfitPct < 45) return 'low-margin risk';
  return 'core assortment';
}

function summarizeProductFamilies(products) {
  const byFamily = new Map();
  for (const row of products) {
    const family = classifyProductFamily(row);
    if (!byFamily.has(family)) {
      byFamily.set(family, { family, quantity: 0, orders: 0, revenue: 0, profit: 0, bundles: 0 });
    }
    const target = byFamily.get(family);
    target.quantity += toNumber(row.quantity);
    target.orders += toNumber(row.orders);
    target.revenue += toNumber(row.revenue);
    target.profit += toNumber(row.profit);
    if (row.isBundle) target.bundles += toNumber(row.quantity);
  }
  return Array.from(byFamily.values())
    .map((row) => ({
      ...row,
      grossProfitPct: row.revenue ? (row.profit / row.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);
}

function summarizeAssortmentLadders(products) {
  const byHeight = new Map();
  const byFinishPack = new Map();

  for (const row of products) {
    const height = row.heightLadder || heightLadderFromDimension(row.dimension);
    const finish = row.finish || finishFromProduct(row);
    const packSize = row.packSize || packSizeFromProduct(row);

    if (!byHeight.has(height)) {
      byHeight.set(height, {
        ladder: height,
        skuSet: new Set(),
        quantity: 0,
        revenue: 0,
        profit: 0,
      });
    }
    const heightRow = byHeight.get(height);
    heightRow.skuSet.add(row.sku);
    heightRow.quantity += toNumber(row.quantity);
    heightRow.revenue += toNumber(row.revenue);
    heightRow.profit += toNumber(row.profit);

    const finishKey = `${finish} | ${packSize}`;
    if (!byFinishPack.has(finishKey)) {
      byFinishPack.set(finishKey, {
        finish,
        packSize,
        skuSet: new Set(),
        quantity: 0,
        revenue: 0,
        profit: 0,
      });
    }
    const finishRow = byFinishPack.get(finishKey);
    finishRow.skuSet.add(row.sku);
    finishRow.quantity += toNumber(row.quantity);
    finishRow.revenue += toNumber(row.revenue);
    finishRow.profit += toNumber(row.profit);
  }

  const finalize = (row) => ({
    ...row,
    skuCount: row.skuSet.size,
    grossProfitPct: row.revenue ? (row.profit / row.revenue) * 100 : 0,
  });

  return {
    heightLadders: Array.from(byHeight.values()).map(finalize).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
    finishPackLadders: Array.from(byFinishPack.values()).map(finalize).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
  };
}

function dateKey(order) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(order.order_date));
}

function isB2B(order) {
  return order.raw_data?.customer?.company_yn === true || order.raw_data?.customer?.company_yn === 'true';
}

async function fetchAll(queryFactory, pageSize = 1000, maxRows = 6000) {
  const rows = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await queryFactory(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = Array.isArray(data) ? data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
}

function isImportLogisticsIntent(intent) {
  return IMPORT_LOGISTICS_INTENTS.includes(intent);
}

function normalizeImportQuestionOrderName(value) {
  const normalized = normalizeImportOrderCode(String(value || '').trim());
  const q = cleanText(normalized).replace(/\s+/g, ' ').trim();
  const explicitSheet = q.match(/\bcina\s*0526\b/);
  if (explicitSheet) return 'Čína 13';
  const match = q.match(/\bcina\s*(9|10|11|12|13)\b/) || q.match(/\bimport\s*(9|10|11|12|13)\b/);
  return match ? `Čína ${match[1]}` : '';
}

function extractImportSupplier(question) {
  const q = cleanText(question);
  if (/abc|dodavatel\s*1/.test(q)) return 'ABC China';
  if (/leagle|leagel|dodavatel\s*3/.test(q)) return 'Leagle China';
  return '';
}

async function fetchImportView({ supabase, view, select = '*', configure = (query) => query, maxRows = 5000 }) {
  try {
    const rows = await fetchAll((from, to) => {
      const configured = configure(supabase.from(view).select(select));
      return configured.range(from, to);
    }, 1000, maxRows);
    return { rows, warning: null, status: 'ok' };
  } catch (error) {
    const missing = isMissingSupabaseRelationError(error);
    return {
      rows: [],
      warning: missing
        ? `Importní logistika ještě nemá dostupnou view ${view}; vracím missing-data warning místo pádu.`
        : `Importní view ${view} se nepodařilo načíst: ${error.message || 'neznámá chyba'}.`,
      status: missing ? 'missing' : 'error',
    };
  }
}

function importToolCall(tool, result) {
  return {
    tool,
    status: result.status || (result.warning ? 'error' : 'ok'),
    rows: Array.isArray(result.rows) ? result.rows.length : undefined,
    message: result.warning || undefined,
  };
}

function normalizeImportOrderOverviewRow(row) {
  const orderName = normalizeImportQuestionOrderName(row.order_name || row.order_code || row.source_sheet) || row.order_name || row.order_code;
  return {
    import_order_id: row.import_order_id || row.id,
    order_name: orderName,
    supplier: row.supplier || row.supplier_name || '',
    status: row.status || '',
    source_sheet: row.source_sheet || '',
    shipped_date: row.shipped_date || null,
    eta_port: row.eta_port || null,
    eta_brno: row.eta_brno || null,
    containers: row.containers || '',
    container_count: row.container_count == null ? null : toNumber(row.container_count),
    container_loading: row.container_loading || '',
    loading_photo_count: row.loading_photo_count == null ? null : toNumber(row.loading_photo_count),
    container_loading_details: Array.isArray(row.container_loading_details) ? row.container_loading_details : [],
    total_qty: row.total_qty == null ? null : toNumber(row.total_qty),
    goods_value_czk: row.goods_value_czk == null ? null : toNumber(row.goods_value_czk),
    goods_value_by_currency: row.goods_value_by_currency || {},
    matched_pct: toNumber(row.matched_pct),
    docs_coverage: row.docs_coverage || {},
    missing_docs: Array.isArray(row.missing_docs) ? row.missing_docs : [],
    missing_prices: toNumber(row.missing_prices),
    missing_freight_cost: Boolean(row.missing_freight_cost),
    risk_count: toNumber(row.risk_count),
    line_count: toNumber(row.line_count),
    review_line_count: toNumber(row.review_line_count),
    qty_unknown_line_count: toNumber(row.qty_unknown_line_count),
  };
}

async function getImportOrdersOnTheWay({ supabase, question = '', supplier = '', status = '', etaFrom = '', etaTo = '' }) {
  const detectedSupplier = supplier || extractImportSupplier(question);
  const result = await fetchImportView({
    supabase,
    view: 'import_logistics_order_overview',
    configure: (query) => {
      let next = query.order('eta_brno', { ascending: true });
      if (detectedSupplier) next = next.ilike('supplier', `%${detectedSupplier}%`);
      if (status) next = next.eq('status', status);
      if (etaFrom) next = next.gte('eta_brno', etaFrom);
      if (etaTo) next = next.lte('eta_brno', etaTo);
      return next;
    },
  });
  return { ...result, rows: result.rows.map(normalizeImportOrderOverviewRow) };
}

async function getImportOrderDetail({ supabase, question = '', orderName = '', importOrderId = '' }) {
  const normalizedOrderName = normalizeImportQuestionOrderName(orderName || question);
  const overviewResult = await fetchImportView({
    supabase,
    view: 'import_logistics_order_overview',
    configure: (query) => {
      if (importOrderId) return query.eq('import_order_id', importOrderId);
      if (normalizedOrderName) return query.eq('order_name', normalizedOrderName);
      return query.order('eta_brno', { ascending: true }).limit(1);
    },
    maxRows: 100,
  });
  const order = overviewResult.rows.map(normalizeImportOrderOverviewRow)[0] || null;
  if (!order) {
    return {
      rows: [],
      detail: null,
      status: overviewResult.status,
      warning: overviewResult.warning || (normalizedOrderName ? `Importní objednávku ${normalizedOrderName} jsem v live datech nenašel.` : null),
    };
  }

  const [shipmentsResult, documentsResult, linesResult, costsResult, riskResult] = await Promise.all([
    fetchImportView({
      supabase,
      view: 'import_order_shipments',
      select: 'id,order_id,shipment_ref,kn_tracking_number,bill_of_lading,commercial_invoice_no,supplier_order_codes,container_no,containers_text,container_count,loading_method,palletized,loading_summary,loading_photo_count,loading_photos,status,ordered_date,port_departure_date,shipped_date,eta_port,eta_hamburg,eta_brno,tracking_url,port_of_loading,port_of_transshipment,port_of_discharge,vessel_name,voyage_no,allocated_quantity,allocated_amount,allocated_currency,allocation_note,raw_row',
      configure: (query) => query.eq('order_id', order.import_order_id).order('eta_brno', { ascending: true }),
      maxRows: 200,
    }),
    fetchImportView({
      supabase,
      view: 'import_order_documents',
      select: 'id,order_id,shipment_id,file_name,file_path,document_type,amount,currency,document_date,notes,extraction_status,extracted_json,created_at',
      configure: (query) => query.eq('order_id', order.import_order_id).order('document_date', { ascending: false }),
      maxRows: 200,
    }),
    fetchImportView({
      supabase,
      view: 'import_order_lines_detail',
      select: 'id,order_id,source_sheet,source_row,spec,rm_code,ean,matched_rm_code,matched_ean,product_title,quantity,unit_purchase_price,purchase_currency,match_method,match_confidence,audit_status,match_reason,match_candidates,master_rm_code,master_ean,master_title',
      configure: (query) => query.eq('order_id', order.import_order_id).order('source_row', { ascending: true }),
      maxRows: 1000,
    }),
    fetchImportView({
      supabase,
      view: 'import_logistics_landed_cost_changes',
      configure: (query) => query.eq('import_order_id', order.import_order_id),
      maxRows: 1000,
    }),
    fetchImportView({
      supabase,
      view: 'import_logistics_sku_risk',
      maxRows: 2000,
    }),
  ]);

  const costsByLine = new Map((costsResult.rows || []).map((row) => [row.import_order_line_id, row]));
  const riskBySku = new Map((riskResult.rows || []).map((row) => [String(row.sku || '').toUpperCase(), row]));
  const lines = (linesResult.rows || []).map((line) => {
    const sku = line.master_rm_code || line.matched_rm_code || line.rm_code || '';
    const cost = costsByLine.get(line.id) || {};
    const risk = riskBySku.get(String(sku).toUpperCase()) || {};
    return {
      import_order_line_id: line.id,
      source_sheet: normalizeImportQuestionOrderName(line.source_sheet) || line.source_sheet,
      source_row: line.source_row,
      raw_spec: line.spec || '',
      sku,
      ean: line.master_ean || line.matched_ean || line.ean || '',
      title: line.master_title || line.product_title || '',
      qty: line.quantity == null ? null : toNumber(line.quantity),
      current_stock: risk.current_stock == null ? null : toNumber(risk.current_stock),
      inbound_qty: risk.inbound_qty == null ? null : toNumber(risk.inbound_qty),
      current_upgates_nc: cost.current_upgates_nc == null ? null : toNumber(cost.current_upgates_nc),
      import_unit_cost: line.unit_purchase_price == null ? null : toNumber(line.unit_purchase_price),
      import_unit_cost_czk: cost.import_unit_cost_czk == null ? null : toNumber(cost.import_unit_cost_czk),
      landed_unit_cost: cost.landed_unit_cost == null ? null : toNumber(cost.landed_unit_cost),
      purchase_currency: line.purchase_currency || cost.purchase_currency || '',
      match_method: line.match_method || '',
      match_confidence: line.match_confidence == null ? null : toNumber(line.match_confidence),
      audit_status: line.audit_status || '',
      match_reason: line.match_reason || '',
    };
  });

  return {
    rows: [order],
    detail: {
      order,
      shipments: shipmentsResult.rows || [],
      documents: documentsResult.rows || [],
      lines,
      warnings: [shipmentsResult.warning, documentsResult.warning, linesResult.warning, costsResult.warning, riskResult.warning].filter(Boolean),
    },
    status: [overviewResult, shipmentsResult, documentsResult, linesResult, costsResult, riskResult].some((item) => item.status === 'missing') ? 'missing' : 'ok',
    warning: [overviewResult.warning, shipmentsResult.warning, documentsResult.warning, linesResult.warning, costsResult.warning, riskResult.warning].filter(Boolean).join(' '),
  };
}

function selectImportVelocity(row, market, windowDays) {
  if (market && market !== 'all') {
    const byMarket = row.velocity_by_market || {};
    const marketRow = byMarket[market] || {};
    return toNumber(marketRow[`velocity_${windowDays}d`]);
  }
  return toNumber(row[`velocity_${windowDays}d`]);
}

async function getInboundStockRisk({ supabase, market = 'all', horizonDays = 180, velocityWindow = 30 }) {
  const result = await fetchImportView({
    supabase,
    view: 'import_logistics_sku_risk',
    configure: (query) => query.order('nearest_eta', { ascending: true }),
    maxRows: 3000,
  });

  const rows = result.rows.map((row) => {
    const velocity7 = selectImportVelocity(row, market, 7);
    const velocity14 = selectImportVelocity(row, market, 14);
    const velocity30 = selectImportVelocity(row, market, 30);
    const selectedVelocity = { 7: velocity7, 14: velocity14, 30: velocity30 }[Number(velocityWindow)] || velocity30;
    const hasStock = row.current_stock !== null && row.current_stock !== undefined;
    const hasVelocity = velocity7 > 0 || velocity14 > 0 || velocity30 > 0;
    const hasInbound = toNumber(row.inbound_qty) > 0 && Boolean(row.nearest_eta);
    const coverageStatus = hasStock && hasVelocity && hasInbound ? 'sufficient' : 'insufficient';
    const predicted = coverageStatus === 'sufficient'
      ? predictImportStockoutDate({
          currentStock: toNumber(row.current_stock),
          inboundShipments: [{ quantity: toNumber(row.inbound_qty), etaDate: row.nearest_eta }],
          baseDailyDemand: selectedVelocity,
          monthlyGrowth: IMPORT_LOGISTICS_GROWTH_MONTHLY,
          horizonDays,
        })
      : { date: null };

    return {
      sku: row.sku || '',
      ean: row.ean || '',
      title: row.title || '',
      current_stock: hasStock ? toNumber(row.current_stock) : null,
      inbound_qty: row.inbound_qty == null ? null : toNumber(row.inbound_qty),
      nearest_eta: row.nearest_eta || null,
      inbound_orders: Array.isArray(row.inbound_orders) ? row.inbound_orders : [],
      velocity_7d: velocity7,
      velocity_14d: velocity14,
      velocity_30d: velocity30,
      velocity_by_market: row.velocity_by_market || {},
      forecast_stockout_date: predicted.date,
      stockout_before_eta: Boolean(predicted.date && row.nearest_eta && predicted.date < row.nearest_eta),
      coverage_status: coverageStatus,
      qty_unknown_line_count: toNumber(row.qty_unknown_line_count),
      monthly_growth: IMPORT_LOGISTICS_GROWTH_MONTHLY,
    };
  }).sort((a, b) => {
    if (a.stockout_before_eta !== b.stockout_before_eta) return a.stockout_before_eta ? -1 : 1;
    if (a.forecast_stockout_date && b.forecast_stockout_date) return a.forecast_stockout_date.localeCompare(b.forecast_stockout_date);
    if (a.forecast_stockout_date) return -1;
    if (b.forecast_stockout_date) return 1;
    return b.velocity_30d - a.velocity_30d;
  });

  return { ...result, rows };
}

async function getLandedCostChanges({ supabase, question = '' }) {
  const orderName = normalizeImportQuestionOrderName(question);
  const skuMatch = String(question || '').match(/[A-Z0-9]{6,}[A-Z0-9_]*(?:CORNER)?/i);
  const result = await fetchImportView({
    supabase,
    view: 'import_logistics_landed_cost_changes',
    configure: (query) => query.order('delta_pct', { ascending: false }),
    maxRows: 3000,
  });

  const rows = result.rows
    .filter((row) => !orderName || row.order_name === orderName)
    .filter((row) => !skuMatch || String(row.sku || '').toUpperCase().includes(skuMatch[0].toUpperCase()) || String(row.ean || '').includes(skuMatch[0]))
    .map((row) => ({
      order_name: normalizeImportQuestionOrderName(row.order_name) || row.order_name,
      supplier: row.supplier || '',
      sku: row.sku || '',
      ean: row.ean || '',
      title: row.title || '',
      current_upgates_nc: row.current_upgates_nc == null ? null : toNumber(row.current_upgates_nc),
      import_unit_cost: row.import_unit_cost == null ? null : toNumber(row.import_unit_cost),
      import_unit_cost_czk: row.import_unit_cost_czk == null ? null : toNumber(row.import_unit_cost_czk),
      purchase_fx_to_czk: row.purchase_fx_to_czk == null ? null : toNumber(row.purchase_fx_to_czk),
      allocated_freight_per_unit: row.allocated_freight_per_unit == null ? null : toNumber(row.allocated_freight_per_unit),
      landed_unit_cost: row.landed_unit_cost == null ? null : toNumber(row.landed_unit_cost),
      delta_abs: row.delta_abs == null ? null : toNumber(row.delta_abs),
      delta_pct: row.delta_pct == null ? null : toNumber(row.delta_pct),
      missing_import_price: Boolean(row.missing_import_price),
      missing_fx_rate: Boolean(row.missing_fx_rate),
      missing_freight_cost: Boolean(row.missing_freight_cost),
      purchase_currency: row.purchase_currency || '',
    }))
    .sort((a, b) => {
      const aScore = a.delta_abs == null ? -1 : Math.abs(a.delta_abs);
      const bScore = b.delta_abs == null ? -1 : Math.abs(b.delta_abs);
      return bScore - aScore;
    });

  return { ...result, rows };
}

async function getImportMatchGaps({ supabase }) {
  const result = await fetchImportView({
    supabase,
    view: 'import_logistics_match_gaps',
    configure: (query) => query.order('order_name', { ascending: true }).order('source_row', { ascending: true }),
    maxRows: 2000,
  });
  return {
    ...result,
    rows: result.rows.map((row) => ({
      order_name: normalizeImportQuestionOrderName(row.order_name) || row.order_name,
      source_sheet: normalizeImportQuestionOrderName(row.source_sheet) || row.source_sheet,
      source_row: row.source_row,
      raw_spec: row.raw_spec || '',
      candidate_count: toNumber(row.candidate_count),
      match_status: row.match_status || '',
      reason: row.reason || '',
      candidates: row.candidates || [],
    })),
  };
}

async function getImportDocumentCoverage({ supabase }) {
  const result = await fetchImportView({
    supabase,
    view: 'import_logistics_document_coverage',
    configure: (query) => query.order('order_name', { ascending: true }),
    maxRows: 500,
  });
  return {
    ...result,
    rows: result.rows.map((row) => ({
      order_name: normalizeImportQuestionOrderName(row.order_name) || row.order_name,
      has_supplier_invoice: Boolean(row.has_supplier_invoice),
      has_payment_proof: Boolean(row.has_payment_proof),
      has_packing_list: Boolean(row.has_packing_list),
      has_kn_invoice: Boolean(row.has_kn_invoice),
      has_bl_tracking: Boolean(row.has_bl_tracking),
      has_loading_photos: Boolean(row.has_loading_photos),
      loading_photo_count: toNumber(row.loading_photo_count),
      missing_docs: Array.isArray(row.missing_docs) ? row.missing_docs : [],
      parsed_status: row.parsed_status || 'unknown',
      document_count: toNumber(row.document_count),
    })),
  };
}

function buildImportCoverage({ orders = [], riskRows = [], matchGaps = [], documentCoverage = [] }) {
  const missingPriceLines = orders.reduce((sum, row) => sum + toNumber(row.missing_prices), 0);
  const missingFreightOrders = orders.filter((row) => row.missing_freight_cost || !(row.docs_coverage?.has_kn_invoice)).length;
  const qtyUnknownLines = orders.reduce((sum, row) => sum + toNumber(row.qty_unknown_line_count), 0);
  const china13 = orders.find((row) => row.order_name === 'Čína 13');
  const insufficientRiskRows = riskRows.filter((row) => row.coverage_status !== 'sufficient').length;
  const riskySkuCount = riskRows.filter((row) => row.stockout_before_eta).length;
  const ordersMissingDocs = documentCoverage.filter((row) => row.missing_docs?.length).length;
  const loadingPhotoCount = documentCoverage.reduce((sum, row) => sum + toNumber(row.loading_photo_count), 0);
  const ordersWithLoadingPhotos = documentCoverage.filter((row) => row.has_loading_photos).length;

  return {
    checkedAt: new Date().toISOString(),
    source: 'Supabase import logistics views',
    views: [
      'import_logistics_order_overview',
      'import_logistics_sku_risk',
      'import_logistics_landed_cost_changes',
      'import_logistics_match_gaps',
      'import_logistics_document_coverage',
    ],
    orderCount: orders.length,
    orderNames: orders.map((row) => row.order_name).filter(Boolean),
    missingPriceLines,
    missingFreightOrders,
    matchGapCount: matchGaps.length,
    ordersMissingDocs,
    loadingPhotoCount,
    ordersWithLoadingPhotos,
    qtyUnknownLines,
    china13QtyUnknown: china13 ? toNumber(china13.qty_unknown_line_count) : 0,
    riskySkuCount,
    insufficientRiskRows,
    velocityWindows: IMPORT_LOGISTICS_VELOCITY_WINDOWS,
    monthlyGrowth: IMPORT_LOGISTICS_GROWTH_MONTHLY,
    businessCleanOrders: true,
  };
}

async function getImportLogisticsBundle({ supabase, question, market, intent }) {
  const orderName = normalizeImportQuestionOrderName(question);
  const [ordersResult, riskResult, landedResult, matchGapsResult, documentCoverageResult, detailResult] = await Promise.all([
    getImportOrdersOnTheWay({ supabase, question }),
    getInboundStockRisk({ supabase, market }),
    getLandedCostChanges({ supabase, question }),
    getImportMatchGaps({ supabase }),
    getImportDocumentCoverage({ supabase }),
    getImportOrderDetail({ supabase, question, orderName }),
  ]);

  const riskCountByOrder = new Map();
  for (const row of riskResult.rows || []) {
    if (!row.stockout_before_eta) continue;
    for (const inboundOrder of row.inbound_orders || []) {
      const normalized = normalizeImportQuestionOrderName(inboundOrder) || inboundOrder;
      riskCountByOrder.set(normalized, (riskCountByOrder.get(normalized) || 0) + 1);
    }
  }
  const orders = (ordersResult.rows || []).map((row) => ({
    ...row,
    risk_count: riskCountByOrder.get(row.order_name) || row.risk_count || 0,
  }));
  const coverage = buildImportCoverage({
    orders,
    riskRows: riskResult.rows || [],
    matchGaps: matchGapsResult.rows || [],
    documentCoverage: documentCoverageResult.rows || [],
  });
  const warnings = [
    ordersResult.warning,
    riskResult.warning,
    landedResult.warning,
    matchGapsResult.warning,
    documentCoverageResult.warning,
    detailResult.warning,
  ].filter(Boolean);

  return {
    source: 'Supabase import logistics + Upgates stock/purchase prices + business-clean orders',
    intent,
    orderName,
    orders,
    riskRows: riskResult.rows || [],
    landedCostChanges: landedResult.rows || [],
    matchGaps: matchGapsResult.rows || [],
    documentCoverage: documentCoverageResult.rows || [],
    detail: detailResult.detail,
    coverage,
    warnings,
    toolCalls: [
      importToolCall('get_import_orders_on_the_way', ordersResult),
      importToolCall('get_inbound_stock_risk', riskResult),
      importToolCall('get_landed_cost_changes', landedResult),
      importToolCall('get_import_match_gaps', matchGapsResult),
      importToolCall('get_import_document_coverage', documentCoverageResult),
      importToolCall('get_import_order_detail', detailResult),
    ],
  };
}

function smallGaRuntimeBudget(intent, dateFrom, dateTo) {
  const days = daysInclusive(dateFrom, dateTo);
  if (days > 7) {
    return {
      landingCurrentEventLimit: 2000,
      landingPreviousEventLimit: 2000,
      sessionLimit: 2000,
      eventLimit: 2500,
    };
  }
  return {
    landingCurrentEventLimit: 4000,
    landingPreviousEventLimit: 4000,
    sessionLimit: intent === 'campaign_performance' ? 4000 : 4000,
    eventLimit: intent === 'campaign_performance' ? 6000 : 6000,
  };
}

async function authenticate(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { error: { status: 401, message: 'Chybí přihlášení.' } };
  }

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user) {
    return { error: { status: 401, message: 'Nepodařilo se ověřit uživatele.' } };
  }

  const email = normalizeEmail(data.user.email);
  const domain = email.split('@')[1] || '';
  if (!ALLOWED_DOMAINS.includes(domain)) {
    return { error: { status: 403, message: `Email ${email || 'bez emailu'} není povolený pro Pokec.` } };
  }
  if (!canAccessModule(email, MODULE_IDS.POKEC)) {
    return { error: { status: 403, message: 'Pokec není pro tento účet povolený.' } };
  }

  const writeSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const readSupabase = SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : writeSupabase;

  return { user: data.user, readSupabase, writeSupabase, supabase: readSupabase };
}

async function getOrders({ supabase, dateFrom, dateTo, market }) {
  const offsetFrom = pragueOffset(dateFrom);
  const offsetTo = pragueOffset(dateTo);
  const [rows, purchaseRows] = await Promise.all([
    fetchAll((from, to) => {
      let query = supabase
        .from('orders')
        .select('*,order_items(order_id,product_code,product_name,quantity,buy_price,unit_price_without_vat,total_price_without_vat,vat_rate,sku,ean)')
        .gte('order_date', `${dateFrom}T00:00:00${offsetFrom}`)
        .lte('order_date', `${dateTo}T23:59:59${offsetTo}`)
        .order('order_date', { ascending: false })
        .range(from, to);
      if (market && market !== 'all') query = query.eq('market', market);
      return query;
    }),
    fetchAll((from, to) => supabase
      .from('upgates_product_purchase_prices_current')
      .select('product_code,currency,purchase_price_without_vat_native')
      .not('purchase_price_without_vat_native', 'is', null)
      .range(from, to)),
  ]);

  return attachPurchasePriceLookup(
    deduplicateOrders(rows).filter((order) => !isExcludedOrder(order)),
    buildPurchasePriceLookup(purchaseRows),
  );
}

function summarizeOrders(orders) {
  const byMarket = new Map();
  const total = { orders: 0, revenue: 0, shipping: 0, b2b: 0 };

  for (const order of orders) {
    const market = getMarket(order);
    if (!byMarket.has(market)) byMarket.set(market, { market, orders: 0, revenue: 0, shipping: 0, b2b: 0 });
    const targets = [total, byMarket.get(market)];
    for (const target of targets) {
      target.orders += 1;
      target.revenue += orderRevenue(order);
      target.shipping += orderShipping(order);
      if (isB2B(order)) target.b2b += 1;
    }
  }

  return {
    total: {
      ...total,
      aov: total.orders ? total.revenue / total.orders : 0,
      b2bPct: total.orders ? (total.b2b / total.orders) * 100 : 0,
    },
    byMarket: Array.from(byMarket.values())
      .map((row) => ({ ...row, aov: row.orders ? row.revenue / row.orders : 0, b2bPct: row.orders ? (row.b2b / row.orders) * 100 : 0 }))
      .sort((a, b) => MARKET_ORDER.indexOf(a.market) - MARKET_ORDER.indexOf(b.market)),
  };
}

function summarizeMargin(orders) {
  const total = { orders: 0, exactOrders: 0, missingCostOrders: 0, revenue: 0, cost: 0, profit: 0 };
  const byMarket = new Map();

  for (const order of orders) {
    const market = getMarket(order);
    if (!byMarket.has(market)) byMarket.set(market, { market, orders: 0, exactOrders: 0, missingCostOrders: 0, revenue: 0, cost: 0, profit: 0 });
    const margin = orderMargin(order);
    for (const target of [total, byMarket.get(market)]) {
      target.orders += 1;
      if (margin.complete) {
        target.exactOrders += 1;
        target.revenue += margin.revenue;
        target.cost += margin.cost;
        target.profit += margin.profit;
      } else {
        target.missingCostOrders += 1;
      }
    }
  }

  const finalize = (row) => ({
    ...row,
    grossProfitPct: row.revenue ? (row.profit / row.revenue) * 100 : 0,
    exactSharePct: row.orders ? (row.exactOrders / row.orders) * 100 : 0,
  });

  return {
    total: finalize(total),
    byMarket: Array.from(byMarket.values()).map(finalize).sort((a, b) => MARKET_ORDER.indexOf(a.market) - MARKET_ORDER.indexOf(b.market)),
  };
}

function summarizeProducts(orders, { bundleOnly = false } = {}) {
  const bySku = new Map();

  for (const order of orders) {
    const rate = getRate(order);
    const products = getOrderLineItems(order, { allowRawFallback: false });
    for (const product of products) {
      if (bundleOnly && !isBundleProduct(product)) continue;
      const code = productCode(product);
      const quantity = getLineQuantity(product);
      const revenue = getLineRevenueWithoutVat(product) * rate;
      const buyPrice = getLineBuyPriceWithoutVat(product);
      const cost = buyPrice > 0 ? buyPrice * quantity * rate : 0;
      const key = code;
      if (!bySku.has(key)) {
        const dimension = dimensionFromProduct(product);
        bySku.set(key, {
          sku: code,
          title: productTitle(product),
          dimension,
          heightLadder: heightLadderFromDimension(dimension),
          packSize: packSizeFromProduct(product),
          finish: finishFromProduct(product),
          color: colorFromProduct(product),
          isBundle: isBundleProduct(product),
          quantity: 0,
          orders: new Set(),
          revenue: 0,
          exactRevenue: 0,
          incompleteRevenue: 0,
          cost: 0,
          profit: 0,
          missingBuyPriceQty: 0,
        });
      }
      const row = bySku.get(key);
      row.quantity += quantity;
      row.orders.add(getOrderNumber(order));
      row.revenue += revenue;
      if (buyPrice > 0) {
        row.exactRevenue += revenue;
        row.cost += cost;
        row.profit += revenue - cost;
      } else {
        row.incompleteRevenue += revenue;
        row.missingBuyPriceQty += quantity;
      }
    }
  }

  return Array.from(bySku.values())
    .map((row) => ({
      ...row,
      orders: row.orders.size,
      grossProfitPct: row.exactRevenue ? (row.profit / row.exactRevenue) * 100 : 0,
      marginCoveragePct: row.revenue ? (row.exactRevenue / row.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

async function getPurchasePriceRows({ supabase }) {
  return fetchAll((from, to) => supabase
    .from('upgates_product_purchase_prices_current')
    .select('product_code,market,currency,purchase_price_without_vat_native,purchase_price_czk,sale_price_without_vat_native,title,base_code,bundle_quantity,is_bundle,ean')
    .not('purchase_price_without_vat_native', 'is', null)
    .order('product_code', { ascending: true })
    .range(from, to));
}

function purchaseRowsByProduct(rows = []) {
  const byCode = new Map();
  for (const row of rows || []) {
    const code = productCode(row);
    if (!code || code === 'bez_kodu') continue;
    if (!byCode.has(code)) {
      byCode.set(code, {
        sku: code,
        title: productTitle(row),
        dimension: dimensionFromProduct(row),
        finish: finishFromProduct(row),
        packSize: packSizeFromProduct(row),
        isBundle: Boolean(row.is_bundle),
        bundleQuantity: toNumber(row.bundle_quantity) || 1,
        prices: {},
        salePrices: {},
      });
    }
    const target = byCode.get(code);
    if (!target.title && productTitle(row)) target.title = productTitle(row);
    target.prices[String(row.currency || '').toUpperCase()] = toNumber(row.purchase_price_without_vat_native);
    if (row.sale_price_without_vat_native != null) {
      target.salePrices[String(row.currency || '').toUpperCase()] = toNumber(row.sale_price_without_vat_native);
    }
  }
  return Array.from(byCode.values());
}

function productQuestionScore(row, question) {
  const source = cleanText(question);
  const requestedDimension = dimensionFromQuestion(question);
  const finish = requestedFinish(question);
  const packSize = requestedPackSize(question);
  const rawQuestion = String(question || '').toLowerCase();
  let score = 0;

  if (requestedDimension && row.dimension === requestedDimension) score += 80;
  if (finish && row.finish === finish) score += 30;
  if (packSize && row.packSize === packSize) score += 20;
  if (!packSize && row.packSize === '1 ks') score += 8;
  if (rawQuestion.includes(String(row.sku || '').toLowerCase())) score += 100;
  if (/zink|pozink|galv/.test(source) && row.finish === 'zinkovaný') score += 10;
  if (/balick|bundle|5\s*ks|5ks/.test(source) && row.isBundle) score += 10;
  if (!/balick|bundle|5\s*ks|5ks/.test(source) && !row.isBundle) score += 5;

  return score;
}

function findProductFocus({ question, products = [], purchaseRows = [] }) {
  const purchaseProducts = purchaseRowsByProduct(purchaseRows);
  const productMap = new Map(products.map((row) => [row.sku, row]));
  const candidates = purchaseProducts
    .map((row) => ({
      ...row,
      sold: productMap.get(row.sku) || null,
      score: productQuestionScore(row, question),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.packSize === '1 ks' && b.packSize !== '1 ks') return -1;
      if (b.packSize === '1 ks' && a.packSize !== '1 ks') return 1;
      return (b.sold?.revenue || 0) - (a.sold?.revenue || 0);
    });

  return {
    requestedDimension: dimensionFromQuestion(question),
    requestedFinish: requestedFinish(question),
    requestedPackSize: requestedPackSize(question),
    match: candidates[0] || null,
    alternatives: candidates.slice(1, 5),
  };
}

function formatNativeCurrency(value, currency) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  if (currency === 'CZK') return `${formatNumber(number)} Kč`;
  if (currency === 'HUF') return `${Math.round(number).toLocaleString('cs-CZ')} HUF`;
  return `${number.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatPurchasePrices(prices = {}) {
  return ['CZK', 'EUR', 'HUF', 'RON']
    .filter((currency) => prices[currency] != null && prices[currency] > 0)
    .map((currency) => formatNativeCurrency(prices[currency], currency))
    .join(', ');
}

function detectCampaignBucket(name) {
  const normalized = cleanText(name);
  if (/(shopping|merchant|pla)\b/.test(normalized)) return 'shopping';
  if (/(performance max|pmax|perf max)\b/.test(normalized)) return 'pmax';
  if (/\b(search|vyhled|vyhladav|cautare)\b/.test(normalized)) return 'search';
  return 'other';
}

function summarizeCampaignMix(rows) {
  const totals = new Map();
  let totalSpend = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const spend = toNumber(row.spend_czk ?? row.spend);
    const bucket = detectCampaignBucket(row.campaign_name || row.campaign || row.campaign_id || '');
    totalSpend += spend;
    totals.set(bucket, (totals.get(bucket) || 0) + spend);
  }

  return Array.from(totals.entries())
    .map(([bucket, spend]) => ({
      bucket,
      spend,
      sharePct: totalSpend ? (spend / totalSpend) * 100 : 0,
    }))
    .sort((a, b) => b.spend - a.spend);
}

function summarizeBundlesByDay(orders) {
  const byDay = new Map();
  const ensure = (key) => {
    if (!byDay.has(key)) {
      byDay.set(key, {
        date: key,
        quantity: 0,
        orders: new Set(),
        revenue: 0,
        exactRevenue: 0,
        incompleteRevenue: 0,
        cost: 0,
        profit: 0,
        missingBuyPriceQty: 0,
      });
    }
    return byDay.get(key);
  };

  for (const order of orders) {
    const day = dateKey(order);
    const rate = getRate(order);
    for (const product of getOrderLineItems(order, { allowRawFallback: false })) {
      if (!isBundleProduct(product)) continue;
      const quantity = getLineQuantity(product);
      const buyPrice = getLineBuyPriceWithoutVat(product);
      const revenue = getLineRevenueWithoutVat(product) * rate;
      const cost = buyPrice > 0 ? buyPrice * quantity * rate : 0;
      const row = ensure(day);
      row.quantity += quantity;
      row.orders.add(getOrderNumber(order));
      row.revenue += revenue;
      if (buyPrice > 0) {
        row.exactRevenue += revenue;
        row.cost += cost;
        row.profit += revenue - cost;
      } else {
        row.incompleteRevenue += revenue;
        row.missingBuyPriceQty += quantity;
      }
    }
  }

  return Array.from(byDay.values())
    .map((row) => ({
      ...row,
      orders: row.orders.size,
      grossProfitPct: row.exactRevenue ? (row.profit / row.exactRevenue) * 100 : 0,
      marginCoveragePct: row.revenue ? (row.exactRevenue / row.revenue) * 100 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function summarizeOrdersByHour(orders) {
  const byHour = new Map();
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    hour: '2-digit',
    hour12: false,
  });

  for (const order of orders) {
    const hour = formatter.format(new Date(order.order_date));
    if (!byHour.has(hour)) byHour.set(hour, { hour, orders: 0, revenue: 0 });
    const row = byHour.get(hour);
    row.orders += 1;
    row.revenue += orderRevenue(order);
  }

  return Array.from(byHour.values()).sort((a, b) => a.hour.localeCompare(b.hour));
}

function orderItemQuantity(order) {
  return (Array.isArray(order.raw_data?.products) ? order.raw_data.products : []).reduce((sum, product) => {
    return sum + (toNumber(product.quantity) || 1);
  }, 0);
}

function orderValueBucketLabel(value) {
  if (value <= 1000) return '0-1000';
  if (value <= 2000) return '1001-2000';
  if (value <= 3000) return '2001-3000';
  if (value <= 5000) return '3001-5000';
  return '5000+';
}

function orderItemCountBucketLabel(quantity) {
  if (quantity <= 1) return '1 ks';
  if (quantity <= 2) return '2 ks';
  if (quantity <= 4) return '3-4 ks';
  if (quantity <= 9) return '5-9 ks';
  return '10+ ks';
}

function summarizeOrderValueBuckets(orders) {
  const bucketOrder = ['0-1000', '1001-2000', '2001-3000', '3001-5000', '5000+'];
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, order) => sum + orderRevenue(order), 0);
  const byBucket = new Map(bucketOrder.map((bucket) => [bucket, { bucket, orders: 0, revenue: 0 }]));

  for (const order of orders) {
    const revenue = orderRevenue(order);
    const bucket = orderValueBucketLabel(revenue);
    const target = byBucket.get(bucket);
    target.orders += 1;
    target.revenue += revenue;
  }

  return bucketOrder.map((bucket) => {
    const row = byBucket.get(bucket);
    return {
      ...row,
      orderSharePct: totalOrders ? (row.orders / totalOrders) * 100 : 0,
      revenueSharePct: totalRevenue ? (row.revenue / totalRevenue) * 100 : 0,
    };
  });
}

function summarizeOrderItemCountBuckets(orders) {
  const bucketOrder = ['1 ks', '2 ks', '3-4 ks', '5-9 ks', '10+ ks'];
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, order) => sum + orderRevenue(order), 0);
  const byBucket = new Map(bucketOrder.map((bucket) => [bucket, { bucket, orders: 0, revenue: 0 }]));

  for (const order of orders) {
    const quantity = orderItemQuantity(order);
    const revenue = orderRevenue(order);
    const bucket = orderItemCountBucketLabel(quantity);
    const target = byBucket.get(bucket);
    target.orders += 1;
    target.revenue += revenue;
  }

  return bucketOrder.map((bucket) => {
    const row = byBucket.get(bucket);
    return {
      ...row,
      orderSharePct: totalOrders ? (row.orders / totalOrders) * 100 : 0,
      revenueSharePct: totalRevenue ? (row.revenue / totalRevenue) * 100 : 0,
    };
  });
}

function summarizeShippingRevenue(orders, groupBy = 'date') {
  const byKey = new Map();

  for (const order of orders) {
    const key = groupBy === 'market' ? getMarket(order) : dateKey(order);
    if (!byKey.has(key)) {
      byKey.set(key, { key, shipping: 0, orders: 0 });
    }
    const row = byKey.get(key);
    row.shipping += orderShipping(order);
    row.orders += 1;
  }

  return Array.from(byKey.values())
    .sort((a, b) => groupBy === 'market'
      ? MARKET_ORDER.indexOf(a.key) - MARKET_ORDER.indexOf(b.key)
      : a.key.localeCompare(b.key));
}

function summarizeMissingBuyPrices(productRows) {
  return productRows
    .filter((row) => row.missingBuyPriceQty > 0)
    .sort((a, b) => b.revenue - a.revenue);
}

function compareProductMix(currentProducts, previousProducts) {
  const previousBySku = new Map(previousProducts.map((row) => [row.sku, row]));
  const currentRevenue = currentProducts.reduce((sum, row) => sum + row.revenue, 0);
  const previousRevenue = previousProducts.reduce((sum, row) => sum + row.revenue, 0);

  return currentProducts
    .map((row) => {
      const previous = previousBySku.get(row.sku);
      const currentShare = currentRevenue ? (row.revenue / currentRevenue) * 100 : 0;
      const previousShare = previousRevenue && previous ? (previous.revenue / previousRevenue) * 100 : 0;
      return {
        ...row,
        previousQuantity: previous?.quantity || 0,
        previousRevenue: previous?.revenue || 0,
        currentShare,
        previousShare,
        sharePointChange: currentShare - previousShare,
      };
    })
    .sort((a, b) => Math.abs(b.sharePointChange) - Math.abs(a.sharePointChange))
    .slice(0, 10);
}

async function getAdsSpend({ supabase, dateFrom, dateTo, market }) {
  let query = supabase
    .from('ad_metrics_daily')
    .select('date,provider,market,campaign_id,campaign_name,spend_czk,clicks,conversions,conversion_value_czk')
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .eq('level', 'campaign')
    .range(0, 9999);
  if (market && market !== 'all') query = query.eq('market', market);
  const { data, error } = await query;
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const total = rows.reduce((acc, row) => {
    acc.spend += toNumber(row.spend_czk);
    acc.clicks += toNumber(row.clicks);
    acc.conversions += toNumber(row.conversions);
    acc.conversionValue += toNumber(row.conversion_value_czk);
    return acc;
  }, { spend: 0, clicks: 0, conversions: 0, conversionValue: 0 });
  const byCampaign = new Map();
  const byProvider = new Map();
  for (const row of rows) {
    const key = `${row.provider}:${row.market}:${row.campaign_id}`;
    if (!byCampaign.has(key)) {
      byCampaign.set(key, { provider: row.provider, market: row.market, campaign: row.campaign_name || row.campaign_id || 'Bez názvu', spend: 0, clicks: 0, conversions: 0, conversionValue: 0 });
    }
    const target = byCampaign.get(key);
    target.spend += toNumber(row.spend_czk);
    target.clicks += toNumber(row.clicks);
    target.conversions += toNumber(row.conversions);
    target.conversionValue += toNumber(row.conversion_value_czk);

    const providerKey = row.provider || 'unknown';
    if (!byProvider.has(providerKey)) {
      byProvider.set(providerKey, { provider: providerKey, spend: 0, clicks: 0, conversions: 0, conversionValue: 0 });
    }
    const providerTarget = byProvider.get(providerKey);
    providerTarget.spend += toNumber(row.spend_czk);
    providerTarget.clicks += toNumber(row.clicks);
    providerTarget.conversions += toNumber(row.conversions);
    providerTarget.conversionValue += toNumber(row.conversion_value_czk);
  }
  return {
    total,
    rows,
    byProvider: Array.from(byProvider.values()).sort((a, b) => b.spend - a.spend),
    campaignMix: summarizeCampaignMix(rows.filter((row) => row.provider === 'google_ads')),
    topCampaigns: Array.from(byCampaign.values()).sort((a, b) => b.spend - a.spend).slice(0, 10),
  };
}

async function getMetaSpend({ supabase, dateFrom, dateTo, market }) {
  let query = supabase
    .from('ad_metrics_daily')
    .select('date,provider,market,campaign_id,spend_czk,clicks,conversions,conversion_value_czk')
    .eq('provider', 'meta_ads')
    .eq('level', 'campaign')
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .range(0, 4999);
  if (market && market !== 'all') query = query.eq('market', market);
  const { data, error } = await query;
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const campaignIds = new Set();
  const total = rows.reduce((acc, row) => {
    acc.spend += toNumber(row.spend_czk);
    acc.clicks += toNumber(row.clicks);
    acc.conversions += toNumber(row.conversions);
    acc.conversionValue += toNumber(row.conversion_value_czk);
    if (row.campaign_id) campaignIds.add(row.campaign_id);
    return acc;
  }, { spend: 0, clicks: 0, conversions: 0, conversionValue: 0 });

  return {
    total,
    rows,
    campaignCount: campaignIds.size,
  };
}

async function getAdsCampaigns({ supabase, dateFrom, dateTo, market }) {
  let metricsQuery = supabase
    .from('ad_metrics_daily')
    .select('market,campaign_id,campaign_name,spend_czk,clicks,conversions,conversion_value_czk,provider,level')
    .eq('provider', 'google_ads')
    .eq('level', 'campaign')
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .range(0, 4999);
  if (market && market !== 'all') metricsQuery = metricsQuery.eq('market', market);

  const { data: metricRows, error: metricError } = await metricsQuery;
  if (metricError) throw metricError;

  let campaignsQuery = supabase
    .from('ad_campaigns')
    .select('market,campaign_id,campaign_name,status,serving_status,channel_type,channel_sub_type,objective,updated_at')
    .eq('provider', 'google_ads')
    .range(0, 1999);
  if (market && market !== 'all') campaignsQuery = campaignsQuery.eq('market', market);

  const { data: campaignRows, error: campaignError } = await campaignsQuery;
  if (campaignError) throw campaignError;

  const campaignMeta = new Map((Array.isArray(campaignRows) ? campaignRows : []).map((row) => [`${row.market}:${row.campaign_id}`, row]));
  const byCampaign = new Map();
  for (const row of Array.isArray(metricRows) ? metricRows : []) {
    const key = `${row.market}:${row.campaign_id}`;
    if (!byCampaign.has(key)) {
      const meta = campaignMeta.get(key) || {};
      byCampaign.set(key, {
        provider: 'google_ads',
        market: row.market,
        campaignId: row.campaign_id,
        campaign: row.campaign_name || meta.campaign_name || row.campaign_id || 'Bez názvu',
        status: meta.status || null,
        servingStatus: meta.serving_status || null,
        channelType: meta.channel_type || null,
        channelSubType: meta.channel_sub_type || null,
        objective: meta.objective || null,
        spend: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
      });
    }
    const target = byCampaign.get(key);
    target.spend += toNumber(row.spend_czk);
    target.clicks += toNumber(row.clicks);
    target.conversions += toNumber(row.conversions);
    target.conversionValue += toNumber(row.conversion_value_czk);
  }

  return Array.from(byCampaign.values()).sort((a, b) => b.spend - a.spend).slice(0, 12);
}

async function getLandingPages({ supabase, dateFrom, dateTo, market }) {
  let query = supabase
    .from('ad_landing_pages_daily')
    .select('date,market,campaign_name,landing_page_url,expanded_final_url,landing_page_type,cost_czk,clicks')
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .range(0, 999);
  if (market && market !== 'all') query = query.eq('market', market);
  const { data, error } = await query;
  if (error) throw error;
  const byUrl = new Map();
  for (const row of Array.isArray(data) ? data : []) {
    const url = row.expanded_final_url || row.landing_page_url || 'neznámá URL';
    if (!byUrl.has(url)) byUrl.set(url, { landingPage: url, pageType: row.landing_page_type || 'unknown', spend: 0, clicks: 0, campaigns: new Set() });
    const target = byUrl.get(url);
    target.spend += toNumber(row.cost_czk);
    target.clicks += toNumber(row.clicks);
    if (row.campaign_name) target.campaigns.add(row.campaign_name);
  }
  return Array.from(byUrl.values())
    .map((row) => ({ ...row, campaigns: Array.from(row.campaigns).slice(0, 3).join(', ') }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);
}

function normalizeAdsDimensionValue(value, fallback = 'neznamy') {
  const normalized = cleanText(value);
  return normalized || fallback;
}

function inferProviderFromTraffic(row) {
  const source = cleanText(row?.source);
  const medium = cleanText(row?.medium);
  const campaign = cleanText(row?.campaign);
  const combined = `${source} ${medium} ${campaign}`;
  if (/(facebook|instagram|meta)/.test(combined)) return 'meta_ads';
  if (/(google|adwords|gdn|youtube)/.test(combined)) return 'google_ads';
  return 'unknown';
}

function summarizeCampaignPerformance({ adsCampaigns, metaCampaigns, smallGaFunnel }) {
  const byCampaign = new Map();
  const ensureRow = (seed) => {
    const key = `${seed.provider}:${seed.market}:${cleanText(seed.campaign)}`;
    if (!byCampaign.has(key)) {
      byCampaign.set(key, {
        provider: seed.provider || 'unknown',
        market: seed.market || 'unknown',
        campaign: seed.campaign || 'Bez názvu',
        spend: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
        smallGaSessions: 0,
        addToCartRatePct: null,
        checkoutRatePct: null,
        purchaseRatePct: null,
        checkoutCompletionPct: null,
        avgCartValueCzk: 0,
        topCartItem: null,
        topCartItemCount: 0,
        matchedPurchaseCount: 0,
        matchedPurchaseValueCzk: 0,
        matchedAvgPurchaseValueCzk: 0,
        evidence: new Set(),
      });
    }
    return byCampaign.get(key);
  };

  for (const row of Array.isArray(adsCampaigns) ? adsCampaigns : []) {
    const target = ensureRow({ provider: 'google_ads', market: row.market, campaign: row.campaign });
    target.spend += toNumber(row.spend);
    target.clicks += toNumber(row.clicks);
    target.conversions += toNumber(row.conversions);
    target.conversionValue += toNumber(row.conversionValue);
    target.evidence.add('platform');
  }

  for (const row of Array.isArray(metaCampaigns) ? metaCampaigns : []) {
    const target = ensureRow({ provider: 'meta_ads', market: row.market, campaign: row.campaign });
    target.spend += toNumber(row.spend);
    target.clicks += toNumber(row.clicks);
    target.conversions += toNumber(row.conversions);
    target.conversionValue += toNumber(row.conversionValue);
    target.evidence.add('platform');
  }

  for (const row of Array.isArray(smallGaFunnel?.topSources) ? smallGaFunnel.topSources : []) {
    const provider = inferProviderFromTraffic(row);
    const target = ensureRow({ provider, market: 'all', campaign: row.campaign });
    target.smallGaSessions += toNumber(row.sessions);
    target.addToCartRatePct = row.addToCartRatePct ?? target.addToCartRatePct;
    target.checkoutRatePct = row.checkoutRatePct ?? target.checkoutRatePct;
    target.purchaseRatePct = row.purchaseRatePct ?? target.purchaseRatePct;
    target.checkoutCompletionPct = row.checkoutCompletionPct ?? target.checkoutCompletionPct;
    target.avgCartValueCzk = toNumber(row.avgCartValueCzk);
    target.topCartItem = row.topCartItem || target.topCartItem;
    target.topCartItemCount = toNumber(row.topCartItemCount);
    target.matchedPurchaseCount = toNumber(row.matchedPurchaseCount);
    target.matchedPurchaseValueCzk = toNumber(row.matchedPurchaseValueCzk);
    target.matchedAvgPurchaseValueCzk = toNumber(row.matchedAvgPurchaseValueCzk);
    target.evidence.add('small_ga');
  }

  return Array.from(byCampaign.values())
    .map((row) => ({
      ...row,
      platformConvRatePct: row.clicks ? (row.conversions / row.clicks) * 100 : 0,
      hasPlatformValue: row.conversionValue > 0 || row.conversions > 0 || row.spend > 0,
      evidence: Array.from(row.evidence),
    }))
    .sort((a, b) => {
      const valueDiff = b.conversionValue - a.conversionValue;
      if (valueDiff !== 0) return valueDiff;
      const purchaseDiff = toNumber(b.purchaseRatePct) - toNumber(a.purchaseRatePct);
      if (purchaseDiff !== 0) return purchaseDiff;
      return b.spend - a.spend;
    });
}

function summarizeAdsDetailRows(rows, { dimensionKeys, fallbackLabel, labelFromRow }) {
  const byDimension = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const dimensions = row.dimensions && typeof row.dimensions === 'object' ? row.dimensions : {};
    const rawLabel = labelFromRow
      ? labelFromRow({ row, dimensions })
      : dimensionKeys.map((key) => dimensions[key]).find(Boolean);
    const label = normalizeAdsDimensionValue(rawLabel, fallbackLabel);
    if (!byDimension.has(label)) {
      byDimension.set(label, {
        label,
        spend: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
      });
    }
    const target = byDimension.get(label);
    target.spend += toNumber(row.spend_czk ?? row.spend);
    target.clicks += toNumber(row.clicks);
    target.conversions += toNumber(row.conversions);
    target.conversionValue += toNumber(row.conversion_value_czk ?? row.conversionValue);
  }

  return Array.from(byDimension.values())
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);
}

async function getAdsSearchTerms({ supabase, dateFrom, dateTo, market }) {
  let query = supabase
    .from('ad_metrics_daily')
    .select('date,market,dimensions,spend_czk,clicks,conversions,conversion_value_czk')
    .eq('provider', 'google_ads')
    .eq('level', 'search_term')
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .range(0, 4999);
  if (market && market !== 'all') query = query.eq('market', market);
  const { data, error } = await query;
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return {
    rows,
    topTerms: summarizeAdsDetailRows(rows, {
      dimensionKeys: ['search_term'],
      fallbackLabel: 'neznamy dotaz',
      labelFromRow: ({ dimensions }) => dimensions.search_term || dimensions.keyword_text,
    }).map((row) => ({ ...row, searchTerm: row.label })),
  };
}

async function getAdsShoppingProducts({ supabase, dateFrom, dateTo, market }) {
  let query = supabase
    .from('ad_metrics_daily')
    .select('date,market,dimensions,spend_czk,clicks,conversions,conversion_value_czk')
    .eq('provider', 'google_ads')
    .eq('level', 'shopping_product')
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .range(0, 4999);
  if (market && market !== 'all') query = query.eq('market', market);
  const { data, error } = await query;
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return {
    rows,
    topProducts: summarizeAdsDetailRows(rows, {
      dimensionKeys: ['product_title', 'product_item_id'],
      fallbackLabel: 'neznamy produkt',
      labelFromRow: ({ dimensions }) => {
        const title = normalizeAdsDimensionValue(dimensions.product_title, '');
        const itemId = normalizeAdsDimensionValue(dimensions.product_item_id, '');
        if (title && itemId) return `${title} (${itemId})`;
        return title || itemId;
      },
    }).map((row) => ({ ...row, itemId: row.label })),
  };
}

async function getSmallGaLandingPages({
  supabase,
  dateFrom,
  dateTo,
  market,
  currentEventLimit = 4000,
  previousEventLimit = 4000,
}) {
  const currentEvents = await fetchSmallGaEvents({ supabase, dateFrom, dateTo, market, maxRows: currentEventLimit });
  const previous = previousPeriod(dateFrom, dateTo);
  const previousEvents = previous.days <= 31
    ? await fetchSmallGaEvents({
      supabase,
      dateFrom: previous.dateFrom,
      dateTo: previous.dateTo,
      market,
      maxRows: previousEventLimit,
    })
    : [];

  const aggregateLandingPages = (rows) => {
    const byLandingPage = new Map();
    for (const event of rows) {
      if (!isSmallGaLandingCandidate(event) && !isSmallGaCartEvent(event) && !isSmallGaPurchaseEvent(event)) continue;
      const url = smallGaLandingValue(event);
      if (!url) continue;
      const normalizedUrl = normalizeUrl(url);
      const traffic = smallGaTrafficFields(event);
      const pageType = classifyPageType(url);
      const eventName = cleanText(getField(event, ['event_name']));
      const eventType = cleanText(getField(event, ['event_type']));
      const sessionId = smallGaSessionId(event) || `${smallGaTimestamp(event) || 'unknown'}:${normalizedUrl}:${traffic.source}:${traffic.medium}`;
      const key = `${traffic.channelBucket}:${normalizedUrl}`;
      if (!byLandingPage.has(key)) {
        byLandingPage.set(key, {
          landingPage: normalizedUrl,
          pageType,
          channelBucket: traffic.channelBucket,
          sessionsSet: new Set(),
          cartSessions: new Set(),
          purchaseSessions: new Set(),
          addToCartSessions: new Set(),
          campaignVisits: 0,
          purchaseEvents: 0,
          cartEvents: 0,
          addToCartEvents: 0,
          markets: new Set(),
          topCampaigns: new Map(),
          lastSeenAt: null,
        });
      }
      const target = byLandingPage.get(key);
      target.sessionsSet.add(sessionId);
      target.markets.add(smallGaMarket(event));
      if (smallGaTimestamp(event) && (!target.lastSeenAt || smallGaTimestamp(event) > target.lastSeenAt)) {
        target.lastSeenAt = smallGaTimestamp(event);
      }
      if (eventName === 'campaign_visit') {
        target.campaignVisits += 1;
      }
      if (isSmallGaCartEvent(event)) {
        target.cartEvents += 1;
        target.cartSessions.add(sessionId);
        if (eventName === 'add_to_cart' || eventType === 'add_to_cart') {
          target.addToCartEvents += 1;
          target.addToCartSessions.add(sessionId);
        }
      }
      if (isSmallGaPurchaseEvent(event)) {
        target.purchaseEvents += 1;
        target.purchaseSessions.add(sessionId);
      }
      const campaign = traffic.campaign || 'bez kampaně';
      target.topCampaigns.set(campaign, (target.topCampaigns.get(campaign) || 0) + 1);
    }

    return Array.from(byLandingPage.values()).map((row) => {
      const topCampaign = Array.from(row.topCampaigns.entries()).sort((a, b) => b[1] - a[1])[0];
      const sessions = row.sessionsSet.size;
      return {
        landingPage: row.landingPage,
        pageType: row.pageType,
        channelBucket: row.channelBucket,
        sessions,
        cartEvents: row.cartEvents,
        purchaseEvents: row.purchaseEvents,
        addToCartEvents: row.addToCartEvents,
        cartRatePct: sessions ? (row.cartSessions.size / sessions) * 100 : 0,
        purchaseRatePct: sessions ? (row.purchaseSessions.size / sessions) * 100 : 0,
        addToCartRatePct: sessions ? (row.addToCartSessions.size / sessions) * 100 : 0,
        campaignVisits: row.campaignVisits,
        markets: Array.from(row.markets).join(', '),
        topCampaign: topCampaign?.[0] || 'bez kampaně',
        topCampaignHits: topCampaign?.[1] || 0,
        lastSeenAt: row.lastSeenAt,
      };
    });
  };

  const currentRows = aggregateLandingPages(currentEvents);
  const previousRows = aggregateLandingPages(previousEvents);
  const previousByKey = new Map(previousRows.map((row) => [`${row.channelBucket}:${row.landingPage}`, row]));

  return currentRows
    .map((row) => {
      const prev = previousByKey.get(`${row.channelBucket}:${row.landingPage}`);
      return {
        ...row,
        previousSessions: prev?.sessions || 0,
        changeVsPreviousPct: relativeChange(row.sessions, prev?.sessions || 0),
      };
    })
    .sort((a, b) => {
      const signalDiff = (b.purchaseEvents + b.cartEvents) - (a.purchaseEvents + a.cartEvents);
      if (signalDiff !== 0) return signalDiff;
      return b.sessions - a.sessions;
    })
    .slice(0, 12);
}

async function getSmallGaSessions({
  supabase,
  dateFrom,
  dateTo,
  market,
  sessionLimit = 4000,
  eventLimit = 6000,
}) {
  const sessionSiteKeys = smallGaSiteKeys(market);
  const sessionRows = await fetchAll((from, to) => {
    let query = supabase
      .from(SMALL_GA_SESSION_TABLE)
      .select('*')
      .gte(SMALL_GA_DATE_COLUMN, `${dateFrom}T00:00:00Z`)
      .lte(SMALL_GA_DATE_COLUMN, `${dateTo}T23:59:59Z`)
      .order(SMALL_GA_DATE_COLUMN, { ascending: false })
      .range(from, to);
    return applySmallGaSiteFilter(query, sessionSiteKeys);
  }, 1000, sessionLimit);
  const sessions = sessionRows.filter((row) => smallGaWithinMarket(row, market));
  const events = await fetchSmallGaEvents({ supabase, dateFrom, dateTo, market, maxRows: eventLimit });

  const bySource = new Map();
  const sessionTrafficById = new Map();
  const allSessions = new Set();
  const cartSessions = new Set();
  const purchaseSessions = new Set();

  for (const session of sessions) {
    const sessionId = smallGaSessionId(session);
    if (!sessionId) continue;
    const traffic = smallGaTrafficFields(session);
    sessionTrafficById.set(sessionId, traffic);
    allSessions.add(sessionId);
    const key = `${traffic.channelBucket}:${cleanText(traffic.source)}:${cleanText(traffic.medium)}:${cleanText(traffic.campaign)}`;
    if (!bySource.has(key)) {
      bySource.set(key, {
        channelBucket: traffic.channelBucket,
        source: traffic.source,
        medium: traffic.medium,
        campaign: traffic.campaign,
        sessionsSet: new Set(),
        cartSessions: new Set(),
        purchaseSessions: new Set(),
        events: 0,
        purchases: 0,
        cartEvents: 0,
      });
    }
    bySource.get(key).sessionsSet.add(sessionId);
  }

  for (const event of events) {
    const sessionId = smallGaSessionId(event);
    if (!sessionId) continue;
    allSessions.add(sessionId);
    const traffic = sessionTrafficById.get(sessionId) || smallGaTrafficFields(event);
    const key = `${traffic.channelBucket}:${cleanText(traffic.source)}:${cleanText(traffic.medium)}:${cleanText(traffic.campaign)}`;
    if (!bySource.has(key)) {
      bySource.set(key, {
        channelBucket: traffic.channelBucket,
        source: traffic.source,
        medium: traffic.medium,
        campaign: traffic.campaign,
        sessionsSet: new Set(),
        cartSessions: new Set(),
        purchaseSessions: new Set(),
        events: 0,
        purchases: 0,
        cartEvents: 0,
      });
    }
    const target = bySource.get(key);
    target.sessionsSet.add(sessionId);
    target.events += 1;
    if (isSmallGaCartEvent(event)) {
      target.cartEvents += 1;
      target.cartSessions.add(sessionId);
      cartSessions.add(sessionId);
    }
    if (isSmallGaPurchaseEvent(event)) {
      target.purchases += 1;
      target.purchaseSessions.add(sessionId);
      purchaseSessions.add(sessionId);
    }
  }

  const topSources = Array.from(bySource.values())
    .map((row) => {
      const sessionsCount = row.sessionsSet.size;
      return {
        channelBucket: row.channelBucket,
        source: row.source,
        medium: row.medium,
        campaign: row.campaign,
        sessions: sessionsCount,
        events: row.events,
        cartRatePct: sessionsCount ? (row.cartSessions.size / sessionsCount) * 100 : 0,
        purchaseRatePct: sessionsCount ? (row.purchaseSessions.size / sessionsCount) * 100 : 0,
        cartEvents: row.cartEvents,
        purchases: row.purchases,
      };
    })
    .sort((a, b) => {
      const purchaseDiff = b.purchases - a.purchases;
      if (purchaseDiff !== 0) return purchaseDiff;
      return b.sessions - a.sessions;
    })
    .slice(0, 12);

  return {
    totalSessions: allSessions.size,
    totalEvents: events.length,
    cartRatePct: allSessions.size ? (cartSessions.size / allSessions.size) * 100 : 0,
    purchaseRatePct: allSessions.size ? (purchaseSessions.size / allSessions.size) * 100 : 0,
    topSources,
  };
}

async function getSmallGaFunnel({
  supabase,
  dateFrom,
  dateTo,
  market,
  includeLandingPages = true,
  includeCommerceTables = true,
  sessionLimit = 4000,
  eventLimit = 6000,
}) {
  const sessionSiteKeys = smallGaSiteKeys(market);
  const sessionRows = await fetchAll((from, to) => {
    let query = supabase
      .from(SMALL_GA_SESSION_TABLE)
      .select('*')
      .gte(SMALL_GA_DATE_COLUMN, `${dateFrom}T00:00:00Z`)
      .lte(SMALL_GA_DATE_COLUMN, `${dateTo}T23:59:59Z`)
      .order(SMALL_GA_DATE_COLUMN, { ascending: false })
      .range(from, to);
    return applySmallGaSiteFilter(query, sessionSiteKeys);
  }, 1000, sessionLimit);
  const sessions = sessionRows.filter((row) => smallGaWithinMarket(row, market));
  const events = await fetchSmallGaEvents({ supabase, dateFrom, dateTo, market, maxRows: eventLimit });

  const sessionMetaById = new Map();
  const sessionIdByVisitorId = new Map();
  const sourceBuckets = new Map();
  const landingBuckets = new Map();
  const totals = {
    sessions: new Set(),
    addToCartSessions: new Set(),
    cartSessions: new Set(),
    checkoutSessions: new Set(),
    purchaseSessions: new Set(),
  };
  const eventCounts = new Map();

  const ensureBucket = (bucketMap, key, seed) => {
    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        ...seed,
        sessions: new Set(),
        addToCartSessions: new Set(),
        cartSessions: new Set(),
        checkoutSessions: new Set(),
        purchaseSessions: new Set(),
        addToCartEvents: 0,
        cartEvents: 0,
        checkoutEvents: 0,
        purchaseEvents: 0,
        cartCount: 0,
        cartValueCzk: 0,
        matchedPurchaseCount: 0,
        matchedPurchaseValueCzk: 0,
        topCartItems: new Map(),
      });
    }
    return bucketMap.get(key);
  };

  for (const session of sessions) {
    const sessionId = smallGaSessionId(session);
    if (!sessionId) continue;
    const traffic = smallGaTrafficFields(session);
    const landingUrl = sessionLandingUrl(session) || smallGaLandingValue(session);
    const normalizedLanding = landingUrl ? normalizeUrl(landingUrl) : null;
    const visitorId = smallGaVisitorId(session);
    const sessionTimestamp = smallGaTimestamp(session);
    sessionMetaById.set(sessionId, {
      traffic,
      landingPage: normalizedLanding,
      pageType: landingUrl ? classifyPageType(landingUrl) : 'other',
      visitorId,
      sessionTimestamp,
    });
    if (visitorId) {
      const existing = sessionIdByVisitorId.get(visitorId);
      if (!existing || String(sessionTimestamp || '') >= String(existing.sessionTimestamp || '')) {
        sessionIdByVisitorId.set(visitorId, { sessionId, sessionTimestamp });
      }
    }
    totals.sessions.add(sessionId);

    const sourceKey = `${traffic.channelBucket}:${cleanText(traffic.source)}:${cleanText(traffic.medium)}:${cleanText(traffic.campaign)}`;
    ensureBucket(sourceBuckets, sourceKey, {
      channelBucket: traffic.channelBucket,
      source: traffic.source,
      medium: traffic.medium,
      campaign: traffic.campaign,
    }).sessions.add(sessionId);

    if (includeLandingPages && normalizedLanding) {
      const landingKey = `${traffic.channelBucket}:${normalizedLanding}`;
      ensureBucket(landingBuckets, landingKey, {
        channelBucket: traffic.channelBucket,
        landingPage: normalizedLanding,
        pageType: classifyPageType(landingUrl),
      }).sessions.add(sessionId);
    }
  }

  for (const event of events) {
    const sessionId = smallGaSessionId(event);
    if (!sessionId) continue;
    const eventName = cleanText(getField(event, ['event_name']));
    const eventType = cleanText(getField(event, ['event_type']));
    const traffic = sessionMetaById.get(sessionId)?.traffic || smallGaTrafficFields(event);
    const rawLanding = sessionMetaById.get(sessionId)?.landingPage || smallGaLandingValue(event);
    const normalizedLanding = rawLanding ? normalizeUrl(rawLanding) : null;
    const pageType = sessionMetaById.get(sessionId)?.pageType || (rawLanding ? classifyPageType(rawLanding) : 'other');
    const sourceKey = `${traffic.channelBucket}:${cleanText(traffic.source)}:${cleanText(traffic.medium)}:${cleanText(traffic.campaign)}`;
    const sourceBucket = ensureBucket(sourceBuckets, sourceKey, {
      channelBucket: traffic.channelBucket,
      source: traffic.source,
      medium: traffic.medium,
      campaign: traffic.campaign,
    });
    sourceBucket.sessions.add(sessionId);
    totals.sessions.add(sessionId);

    const landingBucket = includeLandingPages && normalizedLanding
      ? ensureBucket(landingBuckets, `${traffic.channelBucket}:${normalizedLanding}`, {
        channelBucket: traffic.channelBucket,
        landingPage: normalizedLanding,
        pageType,
      })
      : null;
    if (landingBucket) landingBucket.sessions.add(sessionId);

    const countKey = eventName || eventType || 'other';
    eventCounts.set(countKey, (eventCounts.get(countKey) || 0) + 1);

    if (isSmallGaAddToCartEvent(event)) {
      totals.addToCartSessions.add(sessionId);
      sourceBucket.addToCartSessions.add(sessionId);
      sourceBucket.addToCartEvents += 1;
      if (landingBucket) {
        landingBucket.addToCartSessions.add(sessionId);
        landingBucket.addToCartEvents += 1;
      }
    }
    if (isSmallGaCartEvent(event)) {
      totals.cartSessions.add(sessionId);
      sourceBucket.cartSessions.add(sessionId);
      sourceBucket.cartEvents += 1;
      if (landingBucket) {
        landingBucket.cartSessions.add(sessionId);
        landingBucket.cartEvents += 1;
      }
    }
    if (isSmallGaCheckoutEvent(event)) {
      totals.checkoutSessions.add(sessionId);
      sourceBucket.checkoutSessions.add(sessionId);
      sourceBucket.checkoutEvents += 1;
      if (landingBucket) {
        landingBucket.checkoutSessions.add(sessionId);
        landingBucket.checkoutEvents += 1;
      }
    }
    if (isSmallGaPurchaseEvent(event)) {
      totals.purchaseSessions.add(sessionId);
      sourceBucket.purchaseSessions.add(sessionId);
      sourceBucket.purchaseEvents += 1;
      if (landingBucket) {
        landingBucket.purchaseSessions.add(sessionId);
        landingBucket.purchaseEvents += 1;
      }
    }
  }

  const finalizeBucket = (row) => {
    const sessionsCount = row.sessions.size;
    const topCartItem = Array.from(row.topCartItems.entries()).sort((a, b) => b[1] - a[1])[0];
    return {
      ...row,
      sessions: sessionsCount,
      addToCartRatePct: sessionsCount ? (row.addToCartSessions.size / sessionsCount) * 100 : 0,
      cartRatePct: sessionsCount ? (row.cartSessions.size / sessionsCount) * 100 : 0,
      checkoutRatePct: sessionsCount ? (row.checkoutSessions.size / sessionsCount) * 100 : 0,
      purchaseRatePct: sessionsCount ? (row.purchaseSessions.size / sessionsCount) * 100 : 0,
      checkoutCompletionPct: row.checkoutSessions.size ? (row.purchaseSessions.size / row.checkoutSessions.size) * 100 : 0,
      cartToPurchasePct: row.cartSessions.size ? (row.purchaseSessions.size / row.cartSessions.size) * 100 : 0,
      avgCartValueCzk: row.cartCount ? row.cartValueCzk / row.cartCount : 0,
      matchedAvgPurchaseValueCzk: row.matchedPurchaseCount ? row.matchedPurchaseValueCzk / row.matchedPurchaseCount : 0,
      topCartItem: topCartItem?.[0] || null,
      topCartItemCount: topCartItem?.[1] || 0,
    };
  };

  let carts = { available: false, skipped: !includeCommerceTables };
  let purchases = { available: false, skipped: !includeCommerceTables };
  if (includeCommerceTables) {
    try {
      const cartRows = await fetchSmallGaCarts({ supabase, dateFrom, dateTo, market });
      const summary = {
        available: true,
        count: cartRows.length,
        converted: 0,
        abandoned: 0,
        recovered: 0,
        totalValueCzk: 0,
      };
      for (const row of cartRows) {
        const status = cleanText(row.status);
        const sessionId = smallGaSessionId(row);
        const sessionMeta = sessionId ? sessionMetaById.get(sessionId) : null;
        if (row.converted_at || status.includes('convert')) summary.converted += 1;
        if (row.abandoned_at || status.includes('abandon')) summary.abandoned += 1;
        if (row.recovered_at || status.includes('recover')) summary.recovered += 1;
        const cartValueCzk = smallGaValueCzk(row.total_value, row.currency);
        summary.totalValueCzk += cartValueCzk;

        const firstItem = Array.isArray(row.items) ? row.items[0] : null;
        const itemLabel = firstItem?.item_id || firstItem?.product_id || firstItem?.item_name || firstItem?.name || null;
        const attachBucket = (bucket) => {
          if (!bucket) return;
          bucket.cartCount += 1;
          bucket.cartValueCzk += cartValueCzk;
          if (itemLabel) bucket.topCartItems.set(itemLabel, (bucket.topCartItems.get(itemLabel) || 0) + 1);
        };

        if (sessionMeta) {
          const traffic = sessionMeta.traffic;
          const sourceKey = `${traffic.channelBucket}:${cleanText(traffic.source)}:${cleanText(traffic.medium)}:${cleanText(traffic.campaign)}`;
          attachBucket(sourceBuckets.get(sourceKey));
          if (includeLandingPages && sessionMeta.landingPage) {
            attachBucket(landingBuckets.get(`${traffic.channelBucket}:${sessionMeta.landingPage}`));
          }
        }
      }
      carts = {
        ...summary,
        convertedPct: summary.count ? (summary.converted / summary.count) * 100 : 0,
        abandonedPct: summary.count ? (summary.abandoned / summary.count) * 100 : 0,
        recoveredPct: summary.count ? (summary.recovered / summary.count) * 100 : 0,
        avgValueCzk: summary.count ? summary.totalValueCzk / summary.count : 0,
      };
    } catch (error) {
      carts = { available: false, error: error.message || 'neznámá chyba' };
    }

    try {
      const purchaseRows = await fetchSmallGaPurchases({ supabase, dateFrom, dateTo, market });
      const paymentMethods = new Map();
      const shippingMethods = new Map();
      const summary = {
        available: true,
        count: purchaseRows.length,
        totalValueCzk: 0,
        matchedToSessionCount: 0,
        matchedToSessionValueCzk: 0,
      };
      for (const row of purchaseRows) {
        const purchaseValueCzk = smallGaValueCzk(row.total_value, row.currency);
        summary.totalValueCzk += purchaseValueCzk;
        const paymentMethod = String(row.payment_method || 'neznámá platba');
        const shippingMethod = String(row.shipping_method || 'neznámá doprava');
        paymentMethods.set(paymentMethod, (paymentMethods.get(paymentMethod) || 0) + 1);
        shippingMethods.set(shippingMethod, (shippingMethods.get(shippingMethod) || 0) + 1);

        const visitorId = smallGaVisitorId(row);
        const matchedSession = visitorId ? sessionIdByVisitorId.get(visitorId) : null;
        const sessionMeta = matchedSession ? sessionMetaById.get(matchedSession.sessionId) : null;
        if (sessionMeta) {
          summary.matchedToSessionCount += 1;
          summary.matchedToSessionValueCzk += purchaseValueCzk;
          const traffic = sessionMeta.traffic;
          const sourceKey = `${traffic.channelBucket}:${cleanText(traffic.source)}:${cleanText(traffic.medium)}:${cleanText(traffic.campaign)}`;
          const sourceBucket = sourceBuckets.get(sourceKey);
          if (sourceBucket) {
            sourceBucket.matchedPurchaseCount += 1;
            sourceBucket.matchedPurchaseValueCzk += purchaseValueCzk;
          }
          if (includeLandingPages && sessionMeta.landingPage) {
            const landingBucket = landingBuckets.get(`${traffic.channelBucket}:${sessionMeta.landingPage}`);
            if (landingBucket) {
              landingBucket.matchedPurchaseCount += 1;
              landingBucket.matchedPurchaseValueCzk += purchaseValueCzk;
            }
          }
        }
      }
      purchases = {
        ...summary,
        avgValueCzk: summary.count ? summary.totalValueCzk / summary.count : 0,
        matchedAvgValueCzk: summary.matchedToSessionCount ? summary.matchedToSessionValueCzk / summary.matchedToSessionCount : 0,
        topPaymentMethods: Array.from(paymentMethods.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([method, count]) => ({ method, count })),
        topShippingMethods: Array.from(shippingMethods.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([method, count]) => ({ method, count })),
      };
    } catch (error) {
      purchases = { available: false, error: error.message || 'neznámá chyba' };
    }
  }

  return {
    totalSessions: totals.sessions.size,
    addToCartRatePct: totals.sessions.size ? (totals.addToCartSessions.size / totals.sessions.size) * 100 : 0,
    cartRatePct: totals.sessions.size ? (totals.cartSessions.size / totals.sessions.size) * 100 : 0,
    checkoutRatePct: totals.sessions.size ? (totals.checkoutSessions.size / totals.sessions.size) * 100 : 0,
    purchaseRatePct: totals.sessions.size ? (totals.purchaseSessions.size / totals.sessions.size) * 100 : 0,
    checkoutCompletionPct: totals.checkoutSessions.size ? (totals.purchaseSessions.size / totals.checkoutSessions.size) * 100 : 0,
    cartToPurchasePct: totals.cartSessions.size ? (totals.purchaseSessions.size / totals.cartSessions.size) * 100 : 0,
    eventMix: Array.from(eventCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([event, count]) => ({ event, count })),
    topSources: Array.from(sourceBuckets.values()).map(finalizeBucket).sort((a, b) => {
      const purchaseDiff = b.purchaseEvents - a.purchaseEvents;
      if (purchaseDiff !== 0) return purchaseDiff;
      const checkoutDiff = b.checkoutEvents - a.checkoutEvents;
      if (checkoutDiff !== 0) return checkoutDiff;
      return b.sessions - a.sessions;
    }).slice(0, 12),
    topLandingPages: Array.from(landingBuckets.values()).map(finalizeBucket).sort((a, b) => {
      const purchaseDiff = b.purchaseEvents - a.purchaseEvents;
      if (purchaseDiff !== 0) return purchaseDiff;
      const checkoutDiff = b.checkoutEvents - a.checkoutEvents;
      if (checkoutDiff !== 0) return checkoutDiff;
      return b.sessions - a.sessions;
    }).slice(0, 12),
    carts,
    purchases,
  };
}

async function getDataFreshness({ supabase, market }) {
  const syncRunsQuery = supabase
    .from('ad_sync_runs')
    .select('provider,sync_type,status,range_from,range_to,rows_upserted,started_at,finished_at')
    .order('started_at', { ascending: false })
    .limit(120);
  const { data: syncRuns, error: syncRunsError } = await syncRunsQuery;
  if (syncRunsError) throw syncRunsError;

  const latestRun = (provider, predicate) => (Array.isArray(syncRuns) ? syncRuns : []).find((row) => row.provider === provider && predicate(String(row.sync_type || '')));
  const results = [];
  const pushRun = (source, run, note) => {
    if (!run) {
      results.push({ source, status: 'missing', lastSyncAt: null, note: note || 'sync run nenalezen' });
      return;
    }
    const lastSyncAt = run.finished_at || run.started_at || null;
    const ageMinutes = lastSyncAt ? (Date.now() - new Date(lastSyncAt).getTime()) / 60000 : Number.POSITIVE_INFINITY;
    results.push({
      source,
      status: String(run.status || '').toLowerCase() === 'success' || String(run.status || '').toLowerCase() === 'partial_success'
        ? (ageMinutes <= 75 ? 'fresh' : 'stale')
        : 'error',
      lastSyncAt,
      note: `${run.sync_type || 'sync'} · rows=${formatNumber(run.rows_upserted || 0)} · range=${run.range_from || '-'}..${run.range_to || '-'}`,
    });
  };

  pushRun('google_ads_campaign_sync', latestRun('google_ads', (syncType) => syncType.includes('campaign')));
  pushRun('google_ads_landing_pages_sync', latestRun('google_ads', (syncType) => syncType.includes('landing_pages')));
  pushRun('google_ads_detail_sync', latestRun('google_ads', (syncType) => syncType.startsWith('detail:') && !syncType.endsWith('campaign')));
  pushRun('meta_ads_sync', latestRun('meta_ads', (syncType) => syncType.includes('campaign') || syncType.startsWith('detail:')), 'Meta sync zatím může chybět, pokud ještě neběží provider.');

  const siteKeys = smallGaSiteKeys(market);
  const [smallGaSessionResult, smallGaEventResult] = await Promise.all([
    applySmallGaSiteFilter(
      supabase
        .from(SMALL_GA_SESSION_TABLE)
        .select(`${SMALL_GA_DATE_COLUMN},${SMALL_GA_SITE_COLUMN},site_domain,page_host,page_url,referrer`)
        .order(SMALL_GA_DATE_COLUMN, { ascending: false })
        .limit(250),
      siteKeys
    ),
    applySmallGaSiteFilter(
      supabase
        .from(SMALL_GA_EVENTS_TABLE)
        .select(`${SMALL_GA_EVENT_DATE_COLUMN},timestamp,${SMALL_GA_SITE_COLUMN},site_domain,page_host,page_url,referrer`)
        .order(SMALL_GA_EVENT_DATE_COLUMN, { ascending: false })
        .limit(250),
      siteKeys
    ),
  ]);

  const smallGaSessionError = smallGaSessionResult.error;
  const smallGaEventError = smallGaEventResult.error;
  if (smallGaSessionError && smallGaEventError) {
    results.push({
      source: 'small_ga_ingestion',
      status: 'missing',
      lastSyncAt: null,
      note: smallGaEventError.message || smallGaSessionError.message || 'small GA tabulky nejsou dostupné',
    });
  } else {
    const sessionRows = (Array.isArray(smallGaSessionResult.data) ? smallGaSessionResult.data : []).filter((row) => smallGaWithinMarket(row, market));
    const eventRows = (Array.isArray(smallGaEventResult.data) ? smallGaEventResult.data : []).filter((row) => smallGaWithinMarket(row, market));
    const lastSessionAt = sessionRows[0]?.[SMALL_GA_DATE_COLUMN] || null;
    const lastEventAt = eventRows[0]?.timestamp || eventRows[0]?.[SMALL_GA_EVENT_DATE_COLUMN] || null;
    const lastSyncAt = [lastSessionAt, lastEventAt].filter(Boolean).sort().at(-1) || null;
    const ageMinutes = lastSyncAt ? (Date.now() - new Date(lastSyncAt).getTime()) / 60000 : Number.POSITIVE_INFINITY;
    const notes = [];
    if (lastSessionAt) notes.push(`session ${lastSessionAt}`);
    if (lastEventAt) notes.push(`event ${lastEventAt}`);
    if (!notes.length && smallGaSessionError) notes.push(`session error: ${smallGaSessionError.message}`);
    if (!notes.length && smallGaEventError) notes.push(`event error: ${smallGaEventError.message}`);
    results.push({
      source: 'small_ga_ingestion',
      status: lastSyncAt ? (ageMinutes <= 180 ? 'fresh' : 'stale') : 'missing',
      lastSyncAt,
      note: notes.length ? `poslední small GA aktivita: ${notes.join(' · ')}` : 'small GA data pro zvolený filtr nejsou dostupná',
    });
  }

  const { data: competitorRows, error: competitorError } = await supabase
    .from('ai_competitor_observations')
    .select('observed_at,created_at,status')
    .order('observed_at', { ascending: false })
    .limit(1);
  if (competitorError) {
    results.push({
      source: 'matrix_scrape',
      status: 'missing',
      lastSyncAt: null,
      note: isMissingSupabaseRelationError(competitorError)
        ? 'knowledge layer competitor observations zatím nejsou v Supabase nasazené'
        : (competitorError.message || 'competitor observations nejsou dostupné'),
    });
  } else {
    const latest = Array.isArray(competitorRows) && competitorRows[0] ? competitorRows[0] : null;
    const lastSyncAt = latest?.observed_at || latest?.created_at || null;
    results.push({
      source: 'matrix_scrape',
      status: lastSyncAt ? 'fresh' : 'missing',
      lastSyncAt,
      note: lastSyncAt ? `poslední competitor observation (${latest.status || 'unknown'})` : 'bez uloženého Matrix scrape v knowledge layer',
    });
  }

  results.push({
    source: 'upgates_sync',
    status: 'unverified',
    lastSyncAt: null,
    note: 'V tomto endpointu zatím nemám autoritativní sync metadata pro Upgates; umím jen číst business orders, ne potvrdit poslední sync run.',
  });

  return results;
}

async function getMetaCampaigns({ supabase, dateFrom, dateTo, market }) {
  let metricsQuery = supabase
    .from('ad_metrics_daily')
    .select('date,provider,market,campaign_id,campaign_name,spend_czk,clicks,conversions,conversion_value_czk,level')
    .eq('provider', 'meta_ads')
    .eq('level', 'campaign')
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .range(0, 4999);
  if (market && market !== 'all') metricsQuery = metricsQuery.eq('market', market);

  const { data: metricRows, error: metricError } = await metricsQuery;
  if (metricError) throw metricError;

  let campaignsQuery = supabase
    .from('ad_campaigns')
    .select('provider,market,account_id,campaign_id,campaign_name,status,serving_status,objective,updated_at')
    .eq('provider', 'meta_ads')
    .range(0, 999);
  if (market && market !== 'all') campaignsQuery = campaignsQuery.eq('market', market);

  const { data: campaignRows, error: campaignError } = await campaignsQuery;
  if (campaignError) throw campaignError;

  const campaignMeta = new Map((Array.isArray(campaignRows) ? campaignRows : []).map((row) => [`${row.market}:${row.campaign_id}`, row]));
  const byCampaign = new Map();
  for (const row of Array.isArray(metricRows) ? metricRows : []) {
    const key = `${row.market}:${row.campaign_id}`;
    if (!byCampaign.has(key)) {
      const meta = campaignMeta.get(key) || {};
      byCampaign.set(key, {
        market: row.market,
        campaignId: row.campaign_id,
        campaign: row.campaign_name || meta.campaign_name || row.campaign_id || 'Bez názvu',
        status: meta.status || null,
        servingStatus: meta.serving_status || null,
        objective: meta.objective || null,
        spend: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
      });
    }
    const target = byCampaign.get(key);
    target.spend += toNumber(row.spend_czk);
    target.clicks += toNumber(row.clicks);
    target.conversions += toNumber(row.conversions);
    target.conversionValue += toNumber(row.conversion_value_czk);
  }

  return Array.from(byCampaign.values()).sort((a, b) => b.spend - a.spend).slice(0, 10);
}

async function getCompetitorChanges({ supabase, market, question }) {
  const keywordTokens = cleanText(question)
    .split(/\s+/)
    .filter((word) => word.length >= 5)
    .slice(0, 8);

  let query = supabase
    .from('ai_competitor_observations')
    .select('market,competitor,title,body,observed_at,source_url,confidence,evidence')
    .order('observed_at', { ascending: false })
    .range(0, 49);
  if (market && market !== 'all' && market !== 'unknown') {
    query = query.eq('market', market);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingSupabaseRelationError(error)) return [];
    throw error;
  }

  return (Array.isArray(data) ? data : [])
    .filter((row) => {
      if (!keywordTokens.length) return true;
      const haystack = cleanText(`${row.competitor || ''} ${row.title || ''} ${row.body || ''}`);
      return keywordTokens.some((token) => haystack.includes(token));
    })
    .slice(0, 8);
}

function rowMatchesKnowledge(row, { topic, market, question }) {
  const rowMarket = String(row.market || '').toLowerCase();
  if (rowMarket && market !== 'all' && rowMarket !== market) return false;
  const haystack = cleanText(`${row.topic || ''} ${row.title || ''} ${row.body || ''}`);
  const q = cleanText(question);
  const tokens = [topic, ...q.split(/\s+/).filter((word) => word.length >= 5).slice(0, 8)];
  return tokens.some((token) => token && haystack.includes(cleanText(token)));
}

async function getKnowledgeContext({ supabase, intent, market, question }) {
  const topic = INTENT_TOPICS[intent] || 'business';
  const knowledgeReview = intent === 'knowledge_review';
  const warnings = [];
  const toolCalls = [];
  const missingKnowledgeTables = new Set();

  const fallbackContexts = () => {
    const rows = LOCAL_KNOWLEDGE_CONTEXTS;
    return knowledgeReview
      ? rows.filter((row) => {
          const rowMarket = String(row.market || '').toLowerCase();
          return !rowMarket || market === 'all' || rowMarket === market;
        }).slice(0, 24)
      : rows.filter((row) => rowMatchesKnowledge(row, { topic, market, question })).slice(0, 5);
  };

  const fallbackOpenQuestions = () => {
    const rows = LOCAL_OPEN_QUESTIONS;
    return knowledgeReview
      ? rows.filter((row) => {
          const rowMarket = String(row.market || '').toLowerCase();
          return !rowMarket || market === 'all' || rowMarket === market;
        }).slice(0, 12)
      : rows.filter((row) => rowMatchesKnowledge(row, { topic, market, question })).slice(0, 3);
  };

  const safe = async (tool, callback, fallback = null) => {
    try {
      const rows = await callback();
      toolCalls.push({ tool, status: 'ok', rows: rows.length });
      return rows;
    } catch (error) {
      if (isMissingSupabaseRelationError(error)) {
        const fallbackRows = typeof fallback === 'function' ? fallback() : [];
        missingKnowledgeTables.add(tool);
        toolCalls.push({ tool, status: fallbackRows.length ? 'fallback' : 'missing', rows: fallbackRows.length, message: 'knowledge_layer_not_deployed' });
        return fallbackRows;
      }
      warnings.push(`${tool} se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
      toolCalls.push({ tool, status: 'error', message: error.message || 'neznámá chyba' });
      return [];
    }
  };

  const contexts = await safe('get_known_contexts', async () => {
    const { data, error } = await supabase
      .from('ai_business_contexts')
      .select('slug,title,body,topic,market,confidence,evidence,updated_at')
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .range(0, knowledgeReview ? 119 : 49);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return knowledgeReview
      ? rows.filter((row) => {
          const rowMarket = String(row.market || '').toLowerCase();
          return !rowMarket || market === 'all' || rowMarket === market;
        }).slice(0, 24)
      : rows.filter((row) => rowMatchesKnowledge(row, { topic, market, question })).slice(0, 5);
  }, fallbackContexts);

  const memories = await safe('get_relevant_memories', async () => {
    const { data, error } = await supabase
      .from('ai_memories')
      .select('memory_type,title,body,topic,market,evidence,confidence,occurred_at,created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .range(0, knowledgeReview ? 79 : 49);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return knowledgeReview
      ? rows.filter((row) => {
          const rowMarket = String(row.market || '').toLowerCase();
          return !rowMarket || market === 'all' || rowMarket === market;
        }).slice(0, 12)
      : rows.filter((row) => rowMatchesKnowledge(row, { topic, market, question })).slice(0, 5);
  });

  const examples = await safe('get_relevant_examples', async () => {
    const { data, error } = await supabase
      .from('ai_examples')
      .select('slug,title,trigger_patterns,expected_behavior,required_playbooks,must_include,updated_at')
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .range(0, knowledgeReview ? 49 : 49);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return knowledgeReview
      ? rows.slice(0, 10)
      : rows.filter((row) => rowMatchesKnowledge({
          ...row,
          body: `${JSON.stringify(row.expected_behavior || [])} ${JSON.stringify(row.trigger_patterns || [])}`,
        }, { topic, market, question }))
        .slice(0, 4);
  });

  const meetingNotes = await safe('get_meeting_notes', async () => {
    const { data, error } = await supabase
      .from('ai_meeting_notes')
      .select('meeting_date,title,summary,decisions,action_items,hypotheses,follow_up_topics,updated_at')
      .order('meeting_date', { ascending: false })
      .range(0, 29);
    if (error) throw error;
    return (Array.isArray(data) ? data : [])
      .filter((row) => rowMatchesKnowledge({
        ...row,
        topic,
        market,
        body: `${row.summary || ''} ${JSON.stringify(row.decisions || [])} ${JSON.stringify(row.action_items || [])} ${JSON.stringify(row.hypotheses || [])} ${JSON.stringify(row.follow_up_topics || [])}`,
      }, { topic, market, question }))
      .slice(0, 4);
  });

  const experiments = await safe('get_experiments', async () => {
    const { data, error } = await supabase
      .from('ai_experiments')
      .select('slug,title,hypothesis,markets,metrics,status,result_summary,evidence,updated_at')
      .order('updated_at', { ascending: false })
      .range(0, 29);
    if (error) throw error;
    return (Array.isArray(data) ? data : [])
      .filter((row) => {
        const markets = Array.isArray(row.markets) ? row.markets.map((value) => String(value).toLowerCase()) : [];
        const marketMatch = !markets.length || market === 'all' || markets.includes(market);
        if (!marketMatch) return false;
        return rowMatchesKnowledge({
          ...row,
          topic,
          market,
          body: `${row.hypothesis || ''} ${row.result_summary || ''} ${JSON.stringify(row.metrics || [])}`,
        }, { topic, market, question });
      })
      .slice(0, 4);
  });

  const openQuestions = await safe('get_open_questions', async () => {
    const { data, error } = await supabase
      .from('ai_open_questions')
      .select('title,body,topic,market,priority,needed_data,updated_at')
      .eq('status', 'open')
      .order('updated_at', { ascending: false })
      .range(0, knowledgeReview ? 39 : 19);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return knowledgeReview
      ? rows.filter((row) => {
          const rowMarket = String(row.market || '').toLowerCase();
          return !rowMarket || market === 'all' || rowMarket === market;
        }).slice(0, 12)
      : rows.filter((row) => rowMatchesKnowledge(row, { topic, market, question })).slice(0, 3);
  }, fallbackOpenQuestions);

  const dataQualityIssues = await safe('get_data_quality_issues', async () => {
    const { data, error } = await supabase
      .from('ai_data_quality_issues')
      .select('title,source_key,severity,body,affected_period,evidence,updated_at')
      .eq('status', 'open')
      .order('updated_at', { ascending: false })
      .range(0, 19);
    if (error) throw error;
    return Array.isArray(data) ? data.slice(0, 5) : [];
  });

  if (missingKnowledgeTables.size) {
    warnings.unshift(`Supabase knowledge layer ještě není plně nasazená; používám lokální fallback jen pro část schválených kontextů a otevřených otázek. Chybějící runtime tabulky: ${Array.from(missingKnowledgeTables).join(', ')}.`);
  }

  return {
    topic,
    contexts,
    memories,
    examples,
    meetingNotes,
    experiments,
    openQuestions,
    dataQualityIssues,
    warnings,
    toolCalls,
    knowledgeLayerFallbackActive: missingKnowledgeTables.size > 0,
  };
}

function detectIntent(question) {
  const q = cleanText(question);
  if (/co umis|co umi[sš]|k jakym datum|k jakym datům|jake zdroje|jak[aé] data mas|jak[aé] data vidi[sš]|co vidis|co vis o datech|pristup k datum|přístup k datům/.test(q)) return 'capabilities_overview';
  if (/co o nas vis|co o našem businessu vis|co si myslis ze vis|jake znalosti mas|uka[zž] mi znalosti|knowledge review|co ma[sš] nahrane|co ma[sš] ulozene|uka[zž] mi nejdulezitejsi veci|co ma pokec v hlave/.test(q)) return 'knowledge_review';
  if (/best practice|best practices|co rika google|co říká google|co rika meta|co říká meta|konverzni pomer|konverzniho pomeru|cro|optimalizac[eiy] konverz|zvysit konverzni|zvýšit konverzní|marketingov[eé] dovednost|ads a fb|ads a meta|jak zlepsit ads|jak zlepšit ads|jak zlepsit meta|jak zlepšit meta/.test(q)) return 'trusted_best_practices';
  const hasImportLogisticsSignal = /logistika|import|na ceste|na cest|zbozi na ceste|zbozi.*cest|kontejner|container|zasilk|zasylk|kuehne|kuhne|\bkn\b|hamburk|pristav|sklad|vypadek|stockout|inbound|landed cost|nakupk|freight|palet|naloz|posklad|loading|cina\s*(9|10|11|12|13|0526)/.test(q);
  if (hasImportLogisticsSignal) {
    if (/problem|kvalit|data|nespar|sparovan|ambiguous|unmatched|match|doklad|dokument|invoice|faktur|kuehne|kuhne|\bkn\b|chybi|chyb[iy]|nema|nemaji|missing/.test(q)) return 'import_data_quality';
    if (/landed|nakupk|nakupni cen|import cost|cena po doprave|doprav.*cen|zmen.*cen|zmen.*nakup|cost changes?/.test(q)) return 'landed_cost_change';
    if (/vypad|stockout|dojd|dojde|dojdou|rizik|sklad|inbound/.test(q)) return 'stockout_risk';
    if (/co.*na cest|prehled|overview|zbozi.*cest/.test(q)) return 'import_logistics_overview';
    if (/kdy|doraz|eta|termin|termin|pristav|hamburk|kontejner|container|zasilk|zasylk|palet|naloz|posklad|loading|cina\s*(9|10|11|12|13|0526)/.test(q)) return 'inbound_eta';
    return 'import_logistics_overview';
  }
  if (/sortiment|assortment|cenotvorb|pricing|jake produkty tlacit|jak[eé] produkty tla[cč]it|ktere sku|kter[eé] sku|traffic magnet|margin driver|prodavat vic|rodiny produktu|produktove rodiny|merchandising/.test(q)) return 'assortment_strategy';
  if (/jak vypada shop|jak vypadaji shopy|co je na shopu|co je na homepage|walkthrough|storefront|co je potvrzene videt|co je potvrzeně vidět|co je na pdp|co tlaci homepage/.test(q)) return 'storefront_walkthrough';
  if (/postovn|poštovn|dobirk|doběreč|cod/.test(q)) return 'shipping_revenue';
  if (/chybi|chyb[iy]|nemam data|nejsou data|slaba data|missing data|meta neni dostupna|meta chybi/.test(q)) return 'missing_data';
  if (/brief|briefing|souhrn dne|denni insight|denni report/.test(q)) return 'daily_briefing';
  if (/behem dne|během dne|tempo dne|hodin|po hodin|dnes od rana|od rana|intraday/.test(q)) return 'order_drop_intraday';
  if (/produktov[yí] mix|mix produktu|sku mix|co se prodava|co se prodává/.test(q)) return 'product_mix_change';
  if (productLookupRequested(question)) return 'product_lookup';
  if (/ktera kampan|ktera kampa[nň]|nejkonverznejsi kampan|nejkonverznejsi kampa[nň]|nejvic obratu.*kampan|nejvetsi obrat.*kampan|top kampan.*obrat|top kampan.*konverz/.test(q)) return 'campaign_performance';
  if (/kampanov[yí] mix|mix kampan|search vs shopping|shopping vs search/.test(q)) return 'campaign_mix_change';
  if (/v rumunsku oproti|v madarsku oproti|v cesku oproti|v česku oproti|jen v cz|jen v sk|jen v hu|jen v ro|konkretni zemi|konkrétní zemi/.test(q)) return 'country_change';
  if (/balick|bundle|5ks|5\s*ks/.test(q)) return 'bundle_diagnostics';
  if (/marz|zisk|nakupk/.test(q)) return 'margin_drop';
  if (/\bshopping\b|\bsearch\b|vyhledav|vyhladav|search vs shopping|shopping vs search/.test(q)) return 'high_pno';
  if (/pno|roas|ads|reklam|kampan|google|meta|spend|utrat/.test(q)) return 'high_pno';
  if (/landing|strank|hp|homepage|kategor|kam vodime/.test(q)) return 'landing_page_problem';
  if (/konkur|matrix/.test(q)) return 'competitor_change';
  if (/aov|prumer|prumern|hodnot|objednavk/.test(q)) return 'aov_drop';
  return 'aov_drop';
}

function table(title, columns, rows) {
  return { title, columns, rows };
}

function formatImportQuantity(value) {
  return value == null ? 'neznámé' : formatNumber(value);
}

function formatImportCost(value, currency = 'CZK') {
  if (value == null) return 'chybí';
  if (!currency || currency === 'CZK') return formatCurrency(value);
  return formatNativeCurrency(value, currency);
}

function formatImportLoadingMethod(value, palletized) {
  if (value === 'palletized') return 'na paletách';
  if (value === 'floor_loaded') return 'bez palet';
  if (value === 'mixed') return 'mix';
  if (value === 'unknown') return 'neznámé';
  if (palletized === true) return 'na paletách';
  if (palletized === false) return 'bez palet';
  return 'neuvedeno';
}

function buildImportLogisticsVerdict(importLogistics, intent) {
  if (!importLogistics || importLogistics.warnings?.length && !importLogistics.orders?.length) {
    return 'Importní logistika není plně dostupná; vracím missing-data warning.';
  }
  const names = importLogistics.orders.map((row) => row.order_name).filter(Boolean).join(', ');
  if (intent === 'stockout_risk') {
    return `Riziko výpadku: ${formatNumber(importLogistics.coverage.riskySkuCount)} SKU podle dostupných dat.`;
  }
  if (intent === 'landed_cost_change') {
    return `Landed cost coverage: ${formatNumber(importLogistics.coverage.missingPriceLines)} řádků bez importní ceny a ${formatNumber(importLogistics.coverage.missingFreightOrders)} objednávek bez freight/KN coverage.`;
  }
  if (intent === 'import_data_quality') {
    return `Importní data: ${formatNumber(importLogistics.coverage.matchGapCount)} řádků k match review, ${formatNumber(importLogistics.coverage.ordersMissingDocs)} objednávek s chybějícími dokumenty.`;
  }
  return `Na cestě vidím ${formatNumber(importLogistics.orders.length)} importních objednávek: ${names || 'bez názvu'}.`;
}

function buildImportLogisticsAnswer(importLogistics, intent) {
  if (!importLogistics) return 'Importní logistika se nenačetla. Bez live Supabase dat nechci improvizovat.';
  const coverage = importLogistics.coverage || {};
  const names = (coverage.orderNames || []).join(', ');
  const warning = importLogistics.warnings?.[0] ? ` Pozor: ${importLogistics.warnings[0]}` : '';
  if (intent === 'stockout_risk') {
    return `Používám live inbound, aktuální Upgates sklad a business-clean velocity 7/14/30 dní s +20 % MoM růstem. Rizikových SKU před ETA je podle dostupných dat ${formatNumber(coverage.riskySkuCount)}; u ${formatNumber(coverage.insufficientRiskRows)} SKU je coverage nedostatečná, takže tam netvrdím jistý výpadek.${warning}`;
  }
  if (intent === 'landed_cost_change') {
    return `Odděluju current Upgates NC, buy price a landed unit cost. Zatím nebudu tvrdit kompletní landed-cost pravdu, pokud chybí importní ceny nebo KN/freight faktury: bez ceny je ${formatNumber(coverage.missingPriceLines)} řádků a bez freight coverage ${formatNumber(coverage.missingFreightOrders)} objednávek.${warning}`;
  }
  if (intent === 'import_data_quality') {
    return `Největší datové mezery: ${formatNumber(coverage.matchGapCount)} match-review řádků, ${formatNumber(coverage.ordersMissingDocs)} objednávek s chybějícími dokumenty, ${formatNumber(coverage.missingPriceLines)} řádků bez importní ceny. Čína 13 má ${formatNumber(coverage.china13QtyUnknown)} řádků s neznámým množstvím, pokud ještě nebyl doplněn další PO/PDF/XLS.${warning}`;
  }
  return `Na cestě jsou ${names || 'aktuální importní objednávky'}. Čtu to z live Supabase import logistics views; Čína 0526 normalizuju businessově jako Čína 13 a vždy ukazuju coverage cen, KN/freight faktur, matchů a neznámých množství.${warning}`;
}

function applyImportLogisticsResponse({
  importLogistics,
  intent,
  facts,
  hypotheses,
  missingData,
  nextSteps,
  tables,
}) {
  if (!isImportLogisticsIntent(intent)) return;

  if (!importLogistics) {
    missingData.unshift('Importní logistika se nenačetla; bez live Supabase views nechci odpovídat z hardcoded seznamu.');
    return;
  }

  const coverage = importLogistics.coverage || {};
  const orders = importLogistics.orders || [];
  facts.unshift(`Importní logistiku čtu z live Supabase views (${coverage.views?.join(', ') || 'nezjištěno'}), kontrola ${coverage.checkedAt || new Date().toISOString()}.`);
  facts.unshift(`Zdrojový systém: ${importLogistics.source}. Pokec je tady read-only: nemění statusy, neuploaduje dokumenty a neopravuje matche.`);
  if (orders.length) {
    facts.unshift(`Aktuálně na cestě: ${orders.map((row) => row.order_name).join(', ')}.`);
  } else {
    missingData.unshift('V import_logistics_order_overview nevidím žádné importní objednávky na cestě.');
  }

  if (orders.some((row) => row.order_name === 'Čína 13' && row.source_sheet === 'Čína 0526')) {
    facts.push('Zdrojový sheet Čína 0526 je v odpovědi normalizovaný jako business objednávka Čína 13.');
  }
  facts.push(`Forecast pro riziko výpadku používá business-clean objednávky přes order_items, bez STORNO/SELHAL, velocity 7/14/30 dní a růst +${formatPercent(IMPORT_LOGISTICS_GROWTH_MONTHLY * 100)} meziměsíčně.`);
  facts.push(`Coverage: ${formatNumber(coverage.missingPriceLines)} importních řádků bez ceny, ${formatNumber(coverage.missingFreightOrders)} objednávek bez KN/freight coverage, ${formatNumber(coverage.matchGapCount)} match-review řádků.`);
  facts.push(`Naložení kontejnerů: ${formatNumber(coverage.loadingPhotoCount || 0)} fotek u ${formatNumber(coverage.ordersWithLoadingPhotos || 0)} objednávek; paletování čtu ze shipmentů, neodhaduju ho z názvu objednávky.`);

  if (coverage.missingPriceLines > 0) {
    missingData.push(`Chybí importní nákupní cena u ${formatNumber(coverage.missingPriceLines)} řádků; landed cost tam nesmí být prezentovaný jako kompletní.`);
  }
  if (coverage.missingFreightOrders > 0) {
    missingData.push(`Chybí KN/freight faktura nebo freight cost u ${formatNumber(coverage.missingFreightOrders)} objednávek; dopravu alokuju jen tam, kde freight cost existuje.`);
  }
  if (coverage.matchGapCount > 0) {
    missingData.push(`${formatNumber(coverage.matchGapCount)} importních řádků je unmatched/ambiguous a patří do Match review, ne do tichého domýšlení produktu.`);
  }
  if (coverage.china13QtyUnknown > 0) {
    missingData.push(`Čína 13 má ${formatNumber(coverage.china13QtyUnknown)} řádků s neznámým množstvím; dokud není doplněný supplemental PO/PDF/XLS, inbound qty je neúplné.`);
  }
  if (importLogistics.warnings?.length) {
    missingData.push(...importLogistics.warnings);
  }

  const riskyRows = (importLogistics.riskRows || []).filter((row) => row.stockout_before_eta);
  if (riskyRows.length) {
    hypotheses.push(`Podle dostupných dat stockout před inbound ETA hrozí u ${formatNumber(riskyRows.length)} SKU; u každého řádku pořád ukazuju coverage, aby to nebyla falešná jistota.`);
  } else if (intent === 'stockout_risk') {
    hypotheses.push('V načtených datech nevidím jistý stockout před nejbližší ETA, nebo na to není dostatečné stock/velocity coverage.');
  }

  if (['import_logistics_overview', 'inbound_eta', 'import_data_quality'].includes(intent) || orders.length) {
    tables.push(table('Importní objednávky na cestě', ['Objednávka', 'Dodavatel', 'Status', 'Kontejnery', 'Naložení', 'Shipped', 'ETA port', 'ETA Brno', 'Ks', 'Hodnota', 'Match %', 'Chybí ceny', 'Rizik'], orders.map((row) => [
      row.order_name,
      row.supplier || '—',
      row.status || '—',
      row.containers || '—',
      row.container_loading || '—',
      row.shipped_date || '—',
      row.eta_port || '—',
      row.eta_brno || '—',
      formatImportQuantity(row.total_qty),
      row.goods_value_czk == null ? '—' : formatCurrency(row.goods_value_czk),
      formatPercent(row.matched_pct || 0),
      formatNumber(row.missing_prices),
      formatNumber(row.risk_count || 0),
    ])));
  }

  if ((intent === 'inbound_eta' || intent === 'import_logistics_overview') && importLogistics.detail?.order) {
    const detail = importLogistics.detail;
    if (detail.shipments?.length) {
      tables.push(table(`Naložení ${detail.order.order_name}`, ['Shipment', 'Kontejnery', 'Naložení', 'Fotky', 'Souhrn'], detail.shipments.map((row) => [
        row.shipment_ref || row.commercial_invoice_no || row.bill_of_lading || '—',
        row.containers_text || (row.container_count ? `${formatNumber(row.container_count)} kontejnerů` : '—'),
        formatImportLoadingMethod(row.loading_method, row.palletized),
        formatNumber(row.loading_photo_count || 0),
        row.loading_summary || '—',
      ])));
    }
    tables.push(table(`Detail ${detail.order.order_name}`, ['Řádek', 'SKU', 'EAN', 'Qty', 'Sklad', 'Inbound', 'Upgates NC', 'Buy price', 'Landed cost', 'Match'], detail.lines.slice(0, 30).map((row) => [
      row.source_row,
      row.sku || '—',
      row.ean || '—',
      formatImportQuantity(row.qty),
      formatImportQuantity(row.current_stock),
      formatImportQuantity(row.inbound_qty),
      formatImportCost(row.current_upgates_nc),
      formatImportCost(row.import_unit_cost, row.purchase_currency || 'CZK'),
      formatImportCost(row.landed_unit_cost, 'CZK'),
      `${row.audit_status || '—'} / ${row.match_method || '—'}`,
    ])));
  }

  if (intent === 'stockout_risk' || importLogistics.riskRows?.length) {
    tables.push(table('Riziko výpadku vs inbound', ['SKU', 'EAN', 'Sklad', 'Inbound', 'ETA', 'Vel. 7d', 'Vel. 14d', 'Vel. 30d', 'Stockout', 'Před ETA', 'Coverage'], (importLogistics.riskRows || []).slice(0, 15).map((row) => [
      row.sku,
      row.ean || '—',
      formatImportQuantity(row.current_stock),
      formatImportQuantity(row.inbound_qty),
      row.nearest_eta || '—',
      round(row.velocity_7d, 2).toLocaleString('cs-CZ'),
      round(row.velocity_14d, 2).toLocaleString('cs-CZ'),
      round(row.velocity_30d, 2).toLocaleString('cs-CZ'),
      row.forecast_stockout_date || '—',
      row.stockout_before_eta ? 'ano' : 'ne / nepotvrzeno',
      row.coverage_status,
    ])));
  }

  if (intent === 'landed_cost_change' || importLogistics.landedCostChanges?.some((row) => row.delta_abs != null)) {
    tables.push(table('Nákupka a landed cost', ['Obj.', 'SKU', 'Upgates NC', 'Buy price', 'Freight/ks', 'Landed cost', 'Delta', 'Delta %', 'Coverage'], (importLogistics.landedCostChanges || []).slice(0, 15).map((row) => [
      row.order_name,
      row.sku || '—',
      formatImportCost(row.current_upgates_nc),
      formatImportCost(row.import_unit_cost, row.purchase_currency || 'CZK'),
      formatImportCost(row.allocated_freight_per_unit, 'CZK'),
      formatImportCost(row.landed_unit_cost, 'CZK'),
      row.delta_abs == null ? '—' : formatCurrency(row.delta_abs),
      row.delta_pct == null ? '—' : formatPercent(row.delta_pct),
      [row.missing_import_price ? 'chybí import cena' : null, row.missing_fx_rate ? 'chybí FX' : null, row.missing_freight_cost ? 'chybí freight' : null].filter(Boolean).join(', ') || 'ok',
    ])));
  }

  if (intent === 'import_data_quality' || importLogistics.matchGaps?.length) {
    tables.push(table('Match review', ['Obj.', 'Sheet', 'Řádek', 'Spec', 'Kandidáti', 'Status', 'Důvod'], (importLogistics.matchGaps || []).slice(0, 25).map((row) => [
      row.order_name,
      row.source_sheet,
      row.source_row,
      clampText(row.raw_spec, 120),
      formatNumber(row.candidate_count),
      row.match_status,
      row.reason,
    ])));
  }

  if (intent === 'import_data_quality' || importLogistics.documentCoverage?.length) {
    tables.push(table('Dokumentová coverage', ['Obj.', 'Supplier invoice', 'Payment proof', 'Packing list', 'KN invoice', 'BL/tracking', 'Fotky naložení', 'Chybí', 'Parsing'], (importLogistics.documentCoverage || []).map((row) => [
      row.order_name,
      row.has_supplier_invoice ? 'ano' : 'ne',
      row.has_payment_proof ? 'ano' : 'ne',
      row.has_packing_list ? 'ano' : 'ne',
      row.has_kn_invoice ? 'ano' : 'ne',
      row.has_bl_tracking ? 'ano' : 'ne',
      row.has_loading_photos ? `${formatNumber(row.loading_photo_count)} ks` : 'ne',
      row.missing_docs?.join(', ') || '—',
      row.parsed_status,
    ])));
  }

  nextSteps.push('Doplnit chybějící supplier invoice / packing list / KN faktury a freight cost přes importní UI; Pokec to v této fázi pouze čte.');
  nextSteps.push('Řádky z Match review opravit mimo Pokec a pak importer znovu spustit idempotentně, aby live views ukázaly nové coverage.');
}

function buildDailyBriefingQuestion(dateFrom, dateTo, market) {
  const selectedMarket = MARKET_LABELS[market] || market;
  return `Udělaj mi denní briefing pro období ${dateFrom} až ${dateTo} a filtr ${selectedMarket}. Chci fakta, hlavní pohyby, rizika, co dnes hlídat a co bych měl řešit jako první.`;
}

function buildMemoryCandidate({ question, dateFrom, dateTo, market, intent, facts, hypotheses, missingData, nextSteps, evidence }) {
  const topic = INTENT_TOPICS[intent] || 'business';
  const bestHypothesis = hypotheses[0] || 'Zatím není potvrzená hlavní hypotéza.';
  const title = clampText(`Pokec: ${question}`, 140);
  const body = [
    `Otázka: ${question}`,
    `Období: ${dateFrom} až ${dateTo}, market: ${market}.`,
    facts.length ? `Fakta: ${facts.slice(0, 4).join(' | ')}` : '',
    `Pracovní hypotéza: ${bestHypothesis}`,
    missingData.length ? `Limity: ${missingData.slice(0, 3).join(' | ')}` : '',
    nextSteps.length ? `Další krok: ${nextSteps.slice(0, 2).join(' | ')}` : '',
  ].filter(Boolean).join('\n');

  return {
    memory_type: 'insight',
    title,
    body: clampText(body, 3000),
    topic,
    market: market === 'all' ? null : market,
    confidence: missingData.length ? 'medium' : 'high',
    evidence: {
      source: 'pokec_tool_first',
      date_from: dateFrom,
      date_to: dateTo,
      market,
      intent,
      tool_calls: evidence.toolCalls,
      missing_data_count: missingData.length,
    },
    requires_human_review: true,
  };
}

function buildExampleCandidate(input, fallbackMarket) {
  const title = clampText(input?.title, 160);
  const trigger = clampText(input?.trigger, 600);
  const expectedBehavior = clampText(input?.expected_behavior, 2000);
  const requiredChecks = clampText(input?.required_checks, 1200);
  const badShortcut = clampText(input?.bad_shortcut, 1200);

  if (!title) return { error: 'Chybí název příkladu.' };
  if (!trigger) return { error: 'Chybí trigger nebo situace.' };
  if (!expectedBehavior) return { error: 'Chybí očekávané chování.' };

  const body = [
    `Trigger: ${trigger}`,
    `Očekávané chování: ${expectedBehavior}`,
    requiredChecks ? `Povinné kontroly: ${requiredChecks}` : '',
    badShortcut ? `Zakázaná zkratka / špatná odpověď: ${badShortcut}` : '',
  ].filter(Boolean).join('\n');

  return {
    candidate: {
      memory_type: 'example',
      title,
      body,
      topic: 'examples',
      market: fallbackMarket && fallbackMarket !== 'all' ? fallbackMarket : null,
      confidence: 'high',
      evidence: {
        source: 'manual_example_candidate',
        trigger,
        expected_behavior: expectedBehavior,
        required_checks: requiredChecks || null,
        bad_shortcut: badShortcut || null,
      },
      source_conversation_id: 'manual-example',
      requires_human_review: true,
    },
  };
}

function compactTableForAi(tableData) {
  return {
    title: tableData.title,
    columns: tableData.columns,
    rows: tableData.rows.slice(0, 8),
  };
}

function buildAiInput(toolFirstResponse) {
  return {
    question: toolFirstResponse.question,
    facts: toolFirstResponse.facts,
    hypotheses: toolFirstResponse.hypotheses,
    missingData: toolFirstResponse.missingData,
    nextSteps: toolFirstResponse.nextSteps,
    evidence: toolFirstResponse.evidence,
    tables: toolFirstResponse.tables.slice(0, 8).map(compactTableForAi),
  };
}

function extractResponseText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  const parts = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function normalizeStringArray(value, maxItems) {
  return Array.isArray(value)
    ? value.map((item) => clampText(item, 600)).filter(Boolean).slice(0, maxItems)
    : [];
}

function sanitizeAiInterpretation(value) {
  if (!value || typeof value !== 'object') throw new Error('AI interpretace není objekt.');
  const confidence = ['nízká', 'střední', 'vyšší'].includes(value.confidence) ? value.confidence : 'střední';
  const result = {
    verdict: clampText(value.verdict, 500),
    confidence,
    interpretation: clampText(value.interpretation, 2000),
    hypotheses: normalizeStringArray(value.hypotheses, 6),
    missingData: normalizeStringArray(value.missingData, 8),
    nextSteps: normalizeStringArray(value.nextSteps, 8),
    questionsToAsk: normalizeStringArray(value.questionsToAsk, 5),
    guardrailNotes: normalizeStringArray(value.guardrailNotes, 6),
  };

  if (!result.verdict || !result.interpretation) {
    throw new Error('AI interpretace neobsahuje povinný verdict/interpretation.');
  }
  if (!result.guardrailNotes.length) {
    result.guardrailNotes.push('Model směl interpretovat jen předaná tool-first data a nesměl přidávat nová čísla bez evidence.');
  }
  return result;
}

async function runAiInterpretation({ toolFirstResponse, user }) {
  if (!OPENAI_API_KEY || POKEC_AI_MODE === 'off' || POKEC_AI_MODE === 'tool_first') {
    return {
      interpretation: null,
      warning: OPENAI_API_KEY
        ? 'LLM interpretace je vypnutá přes POKEC_AI_MODE; používám tool-first odpověď.'
        : 'OPENAI_API_KEY není nastavený; používám tool-first odpověď bez LLM vrstvy.',
    };
  }

  const input = buildAiInput(toolFirstResponse);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: POKEC_OPENAI_MODEL,
      instructions: [
        'Jsi Pokec, seniorní ecommerce/growth analytik pro Regal Master.',
        'Odpovídej česky, věcně a důkazně.',
        'Smíš interpretovat jen JSON tool-first evidenci v inputu.',
        'Nesmíš vymýšlet čísla, landing page vzhled, příčiny, konkurenci ani Ads změny, pokud nejsou v inputu.',
        'Odděluj fakta, hypotézy, missing data a další kroky.',
        'Když je playbook nekompletní, zmiň to v missingData nebo guardrailNotes.',
        'Nikdy nenavrhuj ani neprováděj mutace v Google Ads, Meta Ads, Upgates nebo business tabulkách.',
      ].join('\n'),
      input: JSON.stringify(input),
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: 'pokec_ai_interpretation',
          strict: true,
          schema: AI_INTERPRETATION_SCHEMA,
        },
        verbosity: 'medium',
      },
      max_output_tokens: 1600,
      safety_identifier: hashIdentifier(user?.id || user?.email || 'pokec-user'),
      metadata: { feature: 'pokec', mode: 'read_only_interpretation' },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI HTTP ${response.status}`);
  }

  const text = extractResponseText(payload);
  if (!text) throw new Error('OpenAI nevrátil text výstupu.');
  return {
    interpretation: sanitizeAiInterpretation(JSON.parse(text)),
    warning: null,
    meta: {
      model: POKEC_OPENAI_MODEL,
      responseId: payload.id,
    },
  };
}

function mergeAiInterpretation(toolFirstResponse, aiResult) {
  if (!aiResult?.interpretation) {
    return {
      ...toolFirstResponse,
      aiInterpretation: null,
      evidence: {
        ...toolFirstResponse.evidence,
        ai: {
          mode: 'tool_first',
          model: null,
          warning: aiResult?.warning || 'LLM interpretace nebyla spuštěná.',
        },
        warnings: [...(toolFirstResponse.evidence?.warnings || []), ...(aiResult?.warning ? [aiResult.warning] : [])],
      },
    };
  }

  return {
    ...toolFirstResponse,
    mode: 'llm_interpreted',
    verdict: aiResult.interpretation.verdict,
    confidence: aiResult.interpretation.confidence,
    aiInterpretation: aiResult.interpretation,
    evidence: {
      ...toolFirstResponse.evidence,
      ai: {
        mode: 'llm_interpreted',
        model: aiResult.meta?.model || POKEC_OPENAI_MODEL,
        responseId: aiResult.meta?.responseId || null,
        warning: null,
      },
    },
  };
}

function sanitizeMemoryCandidate(input, { user, fallbackMarket }) {
  const memoryType = MEMORY_TYPES.includes(input?.memory_type) ? input.memory_type : 'insight';
  const market = input?.market ? String(input.market).toLowerCase() : fallbackMarket;
  const safeMarket = market && market !== 'all' && SUPPORTED_MARKETS.includes(market) ? market : null;
  const title = clampText(input?.title, 160);
  const body = clampText(input?.body, 4000);

  if (!title) return { error: 'Chybí název paměti.' };
  if (!body) return { error: 'Chybí obsah paměti.' };

  return {
    candidate: {
      memory_type: memoryType,
      title,
      body,
      topic: clampText(input?.topic, 80) || null,
      market: safeMarket,
      evidence: input?.evidence && typeof input.evidence === 'object' ? input.evidence : [],
      confidence: clampText(input?.confidence, 40) || 'medium',
      source_conversation_id: clampText(input?.source_conversation_id, 120) || null,
      proposed_by: user.email || user.id,
      review_status: 'pending',
    },
  };
}

async function saveMemoryCandidate({ supabase, user, body }) {
  const { candidate, error } = sanitizeMemoryCandidate(body.candidate || {}, {
    user,
    fallbackMarket: String(body.market || 'all').toLowerCase(),
  });
  if (error) return { status: 400, payload: { error } };

  const { data, error: insertError } = await supabase
    .from('ai_memory_candidates')
    .insert(candidate)
    .select('id,review_status,created_at')
    .single();

  if (insertError) {
    return {
      status: 500,
      payload: {
        error: `Návrh paměti se nepodařilo uložit: ${insertError.message}`,
        evidence: { action: 'save_memory_candidate', table: 'ai_memory_candidates', businessDataMutated: false },
      },
    };
  }

  return {
    status: 200,
    payload: {
      candidateId: data?.id,
      reviewStatus: data?.review_status || 'pending',
      createdAt: data?.created_at,
      evidence: { action: 'save_memory_candidate', table: 'ai_memory_candidates', businessDataMutated: false },
    },
  };
}

async function saveExampleCandidate({ supabase, user, body }) {
  const market = String(body.market || 'all').toLowerCase();
  const built = buildExampleCandidate(body.example || {}, market);
  if (built.error) return { status: 400, payload: { error: built.error } };
  return saveMemoryCandidate({
    supabase,
    user,
    body: {
      market,
      candidate: {
        ...built.candidate,
        evidence: {
          ...(built.candidate.evidence || {}),
          submitted_via: 'pokec_example_form',
        },
      },
    },
  });
}

function toolStatus(toolCalls, tool) {
  const call = [...toolCalls].reverse().find((item) => item.tool === tool);
  if (!call) return 'chybí';
  if (call.status === 'ok') return 'ověřeno';
  if (call.status === 'skipped') return 'přeskočeno';
  return 'chyba';
}

function buildPlaybookEvidence(intent, toolCalls) {
  const playbook = PLAYBOOK_HINTS[intent] || PLAYBOOK_HINTS.aov_drop;
  const checklist = playbook.requiredTools.map((tool) => ({
    tool,
    status: toolStatus(toolCalls, tool),
  }));
  const missingRequired = checklist.filter((item) => item.status !== 'ověřeno');
  return {
    id: intent,
    title: playbook.title,
    checklist,
    missingRequired,
    desirableSignals: playbook.desirableSignals,
  };
}

function evaluateMustNotSkipStatuses({
  intent,
  mustNotSkip,
  comparison,
  landingPages,
  smallGaLandingPages,
  smallGaSessions,
  freshness,
  orderSummary,
  marginSummary,
  bundleProducts,
  missingBuyPrices,
  catalogSnapshot,
  facts,
  missingData,
  nextSteps,
  hypotheses,
  competitorChanges,
  importLogistics,
}) {
  const hasComparisonOrDisclosure = Boolean(comparison) || missingData.some((item) => item.includes('Srovnání s předchozím obdobím'));
  const hasFreshnessOrDisclosure = Boolean(freshness?.length) || missingData.some((item) => item.toLowerCase().includes('freshness'));
  const hasLandingPageSignal = Boolean(landingPages?.length || smallGaLandingPages?.length);
  const hasTrafficVsConversion = Boolean(smallGaSessions) || missingData.some((item) => item.includes('small GA sessions'));
  const hasBundleSignal = Boolean(bundleProducts.length);
  const hasMissingBuyPriceSignal = Boolean(missingBuyPrices.length) || marginSummary.total.missingCostOrders > 0;
  const hasMarketComparison = orderSummary.byMarket.length > 1 || Boolean(comparison?.orderSummary?.byMarket?.length);
  const hasCompetitorEvidence = Boolean(competitorChanges?.length);
  const hasImportEvidence = Boolean(importLogistics?.orders?.length);
  const hasImportCoverage = Boolean(importLogistics?.coverage);
  const hasImportRisk = Boolean(importLogistics?.riskRows?.length);
  const hasImportCost = Boolean(importLogistics?.landedCostChanges?.length);
  const hasImportMatchCoverage = Boolean(importLogistics?.matchGaps);
  const hasImportDocumentCoverage = Boolean(importLogistics?.documentCoverage?.length);
  const hasReadOnlyGuardrail = facts.some((item) => item.toLowerCase().includes('datový základ')) || catalogSnapshot.sources.every((source) => source.mutationAllowed === false);
  const hasKnownLimits = catalogSnapshot.sources.some((source) => Array.isArray(source.knownLimits) && source.knownLimits.length);
  const hasSourceInventory = Boolean(catalogSnapshot.sources.length);
  const hasSummaryMetrics = orderSummary.total.orders >= 0 && marginSummary.total.orders >= 0;
  const hasWatchout = missingData.length > 0 || hypotheses.length > 0;
  const hasNextFocus = nextSteps.length > 0;
  const hasPeriodComparison = Boolean(comparison);
  const hasCountrySpecificity = hasMarketComparison && hasNextFocus;

  const statusFor = (guardrail) => {
    switch (guardrail) {
      case 'summary_metrics':
        return hasSummaryMetrics ? 'pokryto' : 'chybí';
      case 'period_comparison_or_disclosure':
      case 'period_comparison':
        return hasComparisonOrDisclosure ? 'pokryto' : 'chybí';
      case 'watchout':
        return hasWatchout ? 'pokryto' : 'chybí';
      case 'next_focus':
      case 'next_step':
      case 'next_unblock_step':
        return hasNextFocus ? 'pokryto' : 'chybí';
      case 'source_inventory':
      case 'source_tiering':
        return hasSourceInventory ? 'pokryto' : 'chybí';
      case 'known_limits':
      case 'evidence_boundary':
        return hasKnownLimits ? 'pokryto' : 'chybí';
      case 'freshness_disclosure':
      case 'data_freshness':
      case 'freshness':
        return hasFreshnessOrDisclosure ? 'pokryto' : 'chybí';
      case 'read_only_guardrail':
      case 'read_only_warning':
        return hasReadOnlyGuardrail ? 'pokryto' : 'chybí';
      case 'shipping_separation':
        return facts.some((item) => item.includes('odděleně mimo obrat zboží i mimo PNO')) ? 'pokryto' : 'chybí';
      case 'daily_breakdown':
        return hasSourceInventory || nextSteps.length >= 0 ? 'pokryto' : 'chybí';
      case 'market_breakdown':
      case 'market_comparison':
        return hasMarketComparison ? 'pokryto' : 'chybí';
      case 'product_mix':
      case 'share_shift':
        return hypotheses.some((item) => item.toLowerCase().includes('mix')) || facts.some((item) => item.toLowerCase().includes('mover')) ? 'pokryto' : 'chybí';
      case 'landing_pages':
      case 'landing_page_link':
      case 'source_separation':
        return hasLandingPageSignal || missingData.some((item) => item.toLowerCase().includes('landing page')) ? 'pokryto' : 'chybí';
      case 'missing_data_disclosure':
      case 'uncertainty':
        return missingData.length ? 'pokryto' : 'chybí';
      case 'failed_payments':
        return facts.some((item) => item.includes('Platba selhala')) ? 'pokryto' : 'chybí';
      case 'missing_buy_prices':
        return hasMissingBuyPriceSignal ? 'pokryto' : 'chybí';
      case 'sample_size':
        return facts.some((item) => item.toLowerCase().includes('velikost vzorku')) ? 'pokryto' : 'chybí';
      case 'sku_mix':
      case 'sku_breakdown':
        return facts.some((item) => item.toLowerCase().includes('sku')) || hypotheses.some((item) => item.toLowerCase().includes('sku')) ? 'pokryto' : 'chybí';
      case 'real_revenue':
        return facts.some((item) => item.toLowerCase().includes('real pno')) ? 'pokryto' : 'chybí';
      case 'provider_split':
        return facts.some((item) => item.toLowerCase().includes('provider split')) ? 'pokryto' : 'chybí';
      case 'hourly_breakdown':
        return facts.some((item) => item.toLowerCase().includes('hodinový rozpad')) ? 'pokryto' : 'chybí';
      case 'traffic_vs_conversion':
        return hasTrafficVsConversion ? 'pokryto' : 'chybí';
      case 'margin_link':
      case 'margin_pct':
        return facts.some((item) => item.toLowerCase().includes('hrubý zisk')) || facts.some((item) => item.toLowerCase().includes('marže')) ? 'pokryto' : 'chybí';
      case 'bundle_separation':
      case 'bundle_detection_rule':
        return hasBundleSignal || facts.some((item) => item.toLowerCase().includes('balíčky detekuji')) ? 'pokryto' : 'chybí';
      case 'country_specificity':
      case 'local_validation':
        return hasCountrySpecificity ? 'pokryto' : 'chybí';
      case 'visual_claim_guardrail':
        return facts.some((item) => item.toLowerCase().includes('bez vizuální kontroly')) || missingData.some((item) => item.toLowerCase().includes('vizuální kontroly')) ? 'pokryto' : 'chybí';
      case 'last_scraped_at':
      case 'evidence':
        return hasCompetitorEvidence || missingData.some((item) => item.toLowerCase().includes('matrix scrape')) ? 'pokryto' : 'chybí';
      case 'import_orders_on_the_way':
      case 'inbound_orders':
        return hasImportEvidence ? 'pokryto' : 'chybí';
      case 'import_coverage':
      case 'coverage_warnings':
        return hasImportCoverage ? 'pokryto' : 'chybí';
      case 'document_coverage':
        return hasImportDocumentCoverage ? 'pokryto' : 'chybí';
      case 'match_review':
        return hasImportMatchCoverage ? 'pokryto' : 'chybí';
      case 'stock_velocity':
      case 'business_clean_velocity':
      case 'forecast_growth':
        return hasImportRisk && facts.some((item) => item.includes('+20,0 %') || item.includes('+20 %') || item.includes('7/14/30')) ? 'pokryto' : 'chybí';
      case 'landed_cost_components':
        return hasImportCost ? 'pokryto' : 'chybí';
      default:
        return 'nevyhodnoceno';
    }
  };

  return mustNotSkip.map((guardrail) => ({
    guardrail,
    status: statusFor(guardrail),
  }));
}

function buildCatalogSnapshot(intent, toolCalls) {
  const catalogPlaybook = (Array.isArray(PLAYBOOK_REGISTRY.playbooks) ? PLAYBOOK_REGISTRY.playbooks : [])
    .find((item) => item.id === intent);
  const runtimePlaybook = PLAYBOOK_HINTS[intent] || PLAYBOOK_HINTS.aov_drop;
  const isCapabilitiesOverview = intent === 'capabilities_overview';
  const requiredTools = Array.isArray(catalogPlaybook?.required_tools) && catalogPlaybook.required_tools.length
    ? catalogPlaybook.required_tools
    : runtimePlaybook.requiredTools;
  const desirableSignals = Array.isArray(catalogPlaybook?.typical_missing_data) ? catalogPlaybook.typical_missing_data : [];
  const toolIds = isCapabilitiesOverview
    ? (Array.isArray(TOOL_REGISTRY.tools) ? TOOL_REGISTRY.tools.map((tool) => tool.id) : [])
    : Array.from(new Set([
        ...requiredTools,
        ...toolCalls.map((call) => call.tool),
      ]));
  const tools = toolIds
    .map((toolId) => {
      const definition = TOOL_REGISTRY_BY_ID.get(toolId);
      if (!definition) return null;
      const source = DATA_SOURCE_BY_ID.get(definition.source_id) || null;
      return {
        id: toolId,
        label: definition.label || toolId,
        sourceId: definition.source_id || null,
        sourceLabel: source?.label || definition.source_id || 'neznámý zdroj',
        accessMode: definition.access_mode || 'unknown',
        evidenceFields: Array.isArray(definition.evidence_fields) ? definition.evidence_fields : [],
      };
    })
    .filter(Boolean);
  const sourceIds = isCapabilitiesOverview
    ? (Array.isArray(DATA_SOURCES_REGISTRY.sources) ? DATA_SOURCES_REGISTRY.sources.map((source) => source.id) : [])
    : Array.from(new Set(tools.map((tool) => tool.sourceId).filter(Boolean)));
  const sources = sourceIds
    .map((sourceId) => {
      const source = DATA_SOURCE_BY_ID.get(sourceId);
      if (!source) return null;
      return {
        id: source.id,
        label: source.label || source.id,
        system: source.system || 'neznámý systém',
        freshnessRequirement: source.freshness_requirement || 'bez definované freshness podmínky',
        canAnswer: Array.isArray(source.can_answer) ? source.can_answer : [],
        knownLimits: Array.isArray(source.known_limits) ? source.known_limits : [],
        mutationAllowed: source.mutation_allowed,
      };
    })
    .filter(Boolean);

  return {
    playbook: {
      id: intent,
      title: catalogPlaybook?.title || runtimePlaybook.title,
      requiredTools,
      mustNotSkip: Array.isArray(catalogPlaybook?.must_not_skip) ? catalogPlaybook.must_not_skip : [],
      typicalMissingData: desirableSignals,
    },
    tools,
    sources,
  };
}

function buildSourceCoverageRows({
  catalogSnapshot,
  freshness,
  orderSummary,
  missingBuyPrices,
  ads,
  adsCampaigns,
  metaSpend,
  metaCampaigns,
  smallGaLandingPages,
  smallGaSessions,
  competitorChanges,
  knowledge,
  importLogistics,
}) {
  const freshnessMap = new Map((freshness || []).map((row) => [row.source, row]));
  const knowledgeCount = knowledge
    ? knowledge.contexts.length + knowledge.memories.length + knowledge.examples.length + knowledge.meetingNotes.length + knowledge.experiments.length + knowledge.openQuestions.length
    : 0;

  return catalogSnapshot.sources.map((source) => {
    if (source.id === 'upgates_orders') {
      const syncFreshness = freshnessMap.get('upgates_sync');
      const missingBuyPriceCount = missingBuyPrices.length;
      const status = missingBuyPriceCount ? 'partial' : 'ready';
      const note = missingBuyPriceCount
        ? `Objednávky čtu, ale ${formatNumber(missingBuyPriceCount)} SKU nemá buy_price; ${syncFreshness?.note || 'Upgates sync metadata zatím nemám autoritativně ověřená'}.`
        : syncFreshness?.note || `Objednávky jsou čitelné; ve filtru je ${formatNumber(orderSummary.total.orders)} objednávek.`;
      return { source: source.label, status, note };
    }

    if (source.id === 'google_ads') {
      const campaignFreshness = freshnessMap.get('google_ads_campaign_sync');
      const detailFreshness = freshnessMap.get('google_ads_detail_sync');
      const landingFreshness = freshnessMap.get('google_ads_landing_pages_sync');
      const hasCore = Boolean(ads);
      const hasDetail = Boolean(adsCampaigns?.length);
      const hasLanding = landingFreshness?.status === 'fresh' || landingFreshness?.status === 'stale';
      const isBlocked = !hasCore;
      const isPartial = hasCore && (!hasDetail || !hasLanding || campaignFreshness?.status === 'stale' || detailFreshness?.status === 'stale');
      const status = isBlocked ? 'blocked' : isPartial ? 'partial' : 'ready';
      const note = isBlocked
        ? campaignFreshness?.note || 'Google Ads spend ani kampaně se nenačetly.'
        : [
            campaignFreshness ? `campaign ${campaignFreshness.status}` : null,
            detailFreshness ? `detail ${detailFreshness.status}` : null,
            landingFreshness ? `landing pages ${landingFreshness.status}` : null,
            !hasDetail ? 'detail kampaní zatím chybí' : null,
          ].filter(Boolean).join(' | ');
      return { source: source.label, status, note: note || 'Google Ads data jsou načtená.' };
    }

    if (source.id === 'meta_ads') {
      const metaFreshness = freshnessMap.get('meta_ads_sync');
      const hasMeta = Boolean(metaSpend || metaCampaigns?.length);
      const status = hasMeta
        ? (metaFreshness?.status === 'stale' ? 'partial' : 'ready')
        : (metaFreshness?.status === 'missing' || metaFreshness?.status === 'error' || metaFreshness?.status === 'unverified' ? 'blocked' : 'partial');
      const note = hasMeta
        ? metaFreshness?.note || 'Meta spend / kampaně jsou čitelné.'
        : metaFreshness?.note || 'Meta data ještě nejsou dostupná v Supabase.';
      return { source: source.label, status, note };
    }

    if (source.id === 'small_ga') {
      const gaFreshness = freshnessMap.get('small_ga_ingestion');
      const hasSmallGa = Boolean(smallGaLandingPages?.length || smallGaSessions);
      const status = hasSmallGa
        ? (gaFreshness?.status === 'stale' ? 'partial' : 'ready')
        : (gaFreshness?.status === 'missing' || gaFreshness?.status === 'error' ? 'blocked' : 'partial');
      const note = hasSmallGa
        ? gaFreshness?.note || 'Small GA sessions / landing pages / funnel eventy jsou čitelné.'
        : gaFreshness?.note || 'Small GA data pro filtr chybí.';
      return { source: source.label, status, note };
    }

    if (source.id === 'matrix_competition') {
      const matrixFreshness = freshnessMap.get('matrix_scrape');
      const hasCompetitorData = Boolean(competitorChanges?.length);
      const status = hasCompetitorData ? 'ready' : 'blocked';
      const note = hasCompetitorData
        ? matrixFreshness?.note || 'Konkurenční observation jsou načtené.'
        : matrixFreshness?.note || 'Bez aktuálního Matrix scrape nelze dělat tvrdé konkurenční závěry.';
      return { source: source.label, status, note };
    }

    if (source.id === 'ai_memory') {
      const hasKnowledge = knowledgeCount > 0;
      return {
        source: source.label,
        status: hasKnowledge ? 'ready' : 'partial',
        note: hasKnowledge
          ? `Načteno ${formatNumber(knowledgeCount)} relevantních knowledge záznamů.`
          : 'Knowledge layer je dostupná, ale k tomuto tématu je zatím málo schváleného kontextu.',
      };
    }

    if (source.id === 'import_logistics') {
      if (importLogistics?.warnings?.length && !importLogistics?.orders?.length) {
        return {
          source: source.label,
          status: 'blocked',
          note: importLogistics.warnings[0],
        };
      }
      const coverage = importLogistics?.coverage;
      const status = coverage?.missingPriceLines || coverage?.missingFreightOrders || coverage?.matchGapCount || coverage?.china13QtyUnknown
        ? 'partial'
        : importLogistics?.orders?.length
          ? 'ready'
          : 'blocked';
      return {
        source: source.label,
        status,
        note: coverage
          ? `${formatNumber(coverage.orderCount)} objednávek na cestě; missing ceny ${formatNumber(coverage.missingPriceLines)}, KN/freight ${formatNumber(coverage.missingFreightOrders)}, match gaps ${formatNumber(coverage.matchGapCount)}.`
          : 'Importní logistika se nenačetla.',
      };
    }

    return {
      source: source.label,
      status: 'unverified',
      note: source.freshnessRequirement,
    };
  });
}

function buildBriefing({ dateFrom, dateTo, market, orderSummary, marginSummary, ads, comparison, topProducts, playbook, missingData, nextSteps }) {
  const pno = orderSummary.total.revenue ? ((ads?.total.spend || 0) / orderSummary.total.revenue) * 100 : 0;
  const topMover = topProducts[0];
  const aovChange = comparison?.orderSummary ? formatChangePct(orderSummary.total.aov, comparison.orderSummary.total.aov) : 'bez srovnání';
  const marginChange = comparison?.marginSummary ? formatChangePct(marginSummary.total.grossProfitPct, comparison.marginSummary.total.grossProfitPct) : 'bez srovnání';
  const spendSummary = ads ? formatCurrency(ads.total.spend) : 'bez Ads dat';
  const watchouts = [];

  if (missingData.length) {
    watchouts.push(missingData[0]);
  }
  if (playbook.missingRequired.length) {
    watchouts.push(`Briefing nemá kompletní checklist: ${playbook.missingRequired.map((item) => item.tool).join(', ')}.`);
  }
  if (ads && pno > 30) {
    watchouts.push(`PNO ve filtru je ${formatPercent(pno)}, což už si říká o detailnější kontrolu kampaní.`);
  }
  if (marginSummary.total.grossProfitPct < 45) {
    watchouts.push(`Hrubý zisk ${formatPercent(marginSummary.total.grossProfitPct)} je slabší než bych chtěl pro klidný briefing.`);
  }

  return {
    title: `Denní briefing: ${dateFrom} až ${dateTo}`,
    summary: `${formatNumber(orderSummary.total.orders)} objednávek, ${formatCurrency(orderSummary.total.revenue)} obratu bez DPH a poštovného, AOV ${formatCurrency(orderSummary.total.aov)}, hrubý zisk ${formatPercent(marginSummary.total.grossProfitPct)}, Ads spend ${spendSummary}.`,
    highlights: [
      `AOV proti předchozímu období: ${aovChange}.`,
      `Marže proti předchozímu období: ${marginChange}.`,
      topMover ? `Nejsilnější SKU podle tržby je ${topMover.sku} (${topMover.dimension}) s tržbou ${formatCurrency(topMover.revenue)}.` : 'Nemám top SKU pro briefing.',
    ],
    watchouts: watchouts.slice(0, 3),
    focusQuestion: nextSteps[0] || 'Zpřesnit briefing o konkrétní problém nebo zemi.',
    generatedFor: {
      dateFrom,
      dateTo,
      market,
    },
  };
}

function buildQuestionVerdict({ intent, productFocus, marginSummary, orderSummary, ads }) {
  if (intent === 'product_lookup') {
    const match = productFocus?.match;
    if (!match) return 'Produkt jsem nenašel dost jistě.';
    if (match.sold) return `${match.sku}: marže ${formatCoverageAwareMargin(match.sold)}.`;
    return `${match.sku}: nákupka ${formatPurchasePrices(match.prices) || 'nenalezena'}, ve filtru bez prodeje.`;
  }
  if (intent === 'margin_drop') return `Hrubý zisk je ${formatPercent(marginSummary.total.grossProfitPct)}.`;
  if (intent === 'high_pno') {
    const pno = orderSummary.total.revenue ? ((ads?.total.spend || 0) / orderSummary.total.revenue) * 100 : 0;
    return `Real PNO je zhruba ${formatPercent(pno)}.`;
  }
  if (intent === 'shipping_revenue') return `Poštovné a doběrečné: ${formatCurrency(orderSummary.total.shipping)}.`;
  if (intent === 'aov_drop') return `AOV je ${formatCurrency(orderSummary.total.aov)}.`;
  return `${formatNumber(orderSummary.total.orders)} objednávek, obrat ${formatCurrency(orderSummary.total.revenue)}.`;
}

function buildConversationalAnswer({
  intent,
  productFocus,
  dateFrom,
  dateTo,
  orderSummary,
  marginSummary,
  ads,
  missingData,
  nextSteps,
}) {
  if (intent === 'product_lookup') {
    const match = productFocus?.match;
    if (!match) {
      return `Tohle jsem nenašel dost jistě. Zkus mi napsat SKU, nebo rozměr + finish + jestli jde o balíček.`;
    }

    const purchaseSummary = formatPurchasePrices(match.prices);
    const sold = match.sold;
    const soldSentence = sold
      ? `V období ${dateFrom} až ${dateTo} má ${formatNumber(sold.quantity)} ks v ${formatNumber(sold.orders)} objednávkách, tržbu ${formatCurrency(sold.revenue)} a marži ${formatCoverageAwareMargin(sold)}.`
      : `V období ${dateFrom} až ${dateTo} ho v objednávkách nevidím, takže marži za období nepočítám.`;

    return `Našel jsem ${match.sku} (${match.dimension}, ${match.finish}, ${match.packSize}). Nákupka bez DPH je ${purchaseSummary || 'v katalogu chybí'}. ${soldSentence}`;
  }

  if (intent === 'margin_drop') {
    return `Za vybrané období vychází hrubý zisk ${formatPercent(marginSummary.total.grossProfitPct)}. Počítám ho z ${formatNumber(marginSummary.total.exactOrders)} přesných objednávek z ${formatNumber(marginSummary.total.orders)}; STORNO a Platba selhala jsou venku. ${nextSteps[0] || ''}`.trim();
  }

  if (intent === 'high_pno') {
    const pno = orderSummary.total.revenue ? ((ads?.total.spend || 0) / orderSummary.total.revenue) * 100 : 0;
    return `Real PNO je zhruba ${formatPercent(pno)} při obratu ${formatCurrency(orderSummary.total.revenue)} bez DPH a poštovného. Ads spend vidím ${formatCurrency(ads?.total.spend || 0)}.`;
  }

  const caveat = missingData[0] ? ` Pozor: ${missingData[0]}` : '';
  return `Vidím ${formatNumber(orderSummary.total.orders)} objednávek, obrat ${formatCurrency(orderSummary.total.revenue)}, AOV ${formatCurrency(orderSummary.total.aov)} a hrubý zisk ${formatPercent(marginSummary.total.grossProfitPct)}.${caveat}`;
}

function buildResponse({
  question,
  dateFrom,
  dateTo,
  market,
  intent,
  resolvedPeriod,
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
  knowledge,
  importLogistics = null,
  purchaseRows = [],
  toolCalls,
  warnings,
  responseMode = 'question',
}) {
  const safeKnowledge = knowledge ? {
    topic: knowledge.topic || 'business',
    contexts: Array.isArray(knowledge.contexts) ? knowledge.contexts : [],
    memories: Array.isArray(knowledge.memories) ? knowledge.memories : [],
    examples: Array.isArray(knowledge.examples) ? knowledge.examples : [],
    meetingNotes: Array.isArray(knowledge.meetingNotes) ? knowledge.meetingNotes : [],
    experiments: Array.isArray(knowledge.experiments) ? knowledge.experiments : [],
    openQuestions: Array.isArray(knowledge.openQuestions) ? knowledge.openQuestions : [],
    dataQualityIssues: Array.isArray(knowledge.dataQualityIssues) ? knowledge.dataQualityIssues : [],
  } : null;
  const storefrontContexts = safeKnowledge ? [
    ...safeKnowledge.contexts.filter((row) => row.topic === 'storefront' || row.topic === 'landing_pages'),
    ...safeKnowledge.memories.filter((row) => row.topic === 'storefront' || row.topic === 'landing_pages'),
  ] : [];
  const visualStorefrontContexts = storefrontContexts.filter((row) => rowHasVisualEvidence(row));
  const topProducts = products.slice(0, 8);
  const hourlyOrders = summarizeOrdersByHour(orders);
  const shippingByDay = summarizeShippingRevenue(orders, 'date');
  const shippingByMarket = summarizeShippingRevenue(orders, 'market');
  const bundleProducts = products.filter((row) => row.isBundle).slice(0, 8);
  const missingBuyPrices = summarizeMissingBuyPrices(products).slice(0, 8);
  const orderValueBuckets = summarizeOrderValueBuckets(orders);
  const orderItemBuckets = summarizeOrderItemCountBuckets(orders);
  const productFamilies = summarizeProductFamilies(products);
  const assortmentLadders = summarizeAssortmentLadders(products);
  const heightLadders = assortmentLadders.heightLadders;
  const finishPackLadders = assortmentLadders.finishPackLadders;
  const campaignPerformance = summarizeCampaignPerformance({ adsCampaigns, metaCampaigns, smallGaFunnel });
  const lowMarginProducts = products
    .filter((row) => row.revenue > 0 && row.missingBuyPriceQty === 0)
    .sort((a, b) => a.grossProfitPct - b.grossProfitPct)
    .slice(0, 5);
  const missingBuyPriceRevenue = missingBuyPrices.reduce((sum, row) => sum + (row.incompleteRevenue || row.revenue), 0);
  const selectedMarket = MARKET_LABELS[market] || market;
  const playbook = buildPlaybookEvidence(intent, toolCalls);
  const catalogSnapshot = buildCatalogSnapshot(intent, toolCalls);
  const missingData = [];
  const facts = [];
  const hypotheses = [];
  const nextSteps = [];
  const tables = [];
  const detailRequested = responseMode === 'daily_briefing' || asksForDetail(question);
  const productFocus = intent === 'product_lookup'
    ? findProductFocus({ question, products, purchaseRows })
    : null;
  const importLogisticsIntent = isImportLogisticsIntent(intent);

  facts.push(`Analyzuji období ${dateFrom} až ${dateTo}, filtr ${selectedMarket}.`);
  if (resolvedPeriod?.source === 'question_relative') {
    facts.push(`Období jsem převzal přímo z otázky (${resolvedPeriod.label}), ne jen z okolního filtru.`);
  }
  facts.push(`Použitý playbook: ${playbook.title}. Povinné runtime kontroly: ${playbook.checklist.filter((item) => item.status === 'ověřeno').length}/${playbook.checklist.length} ověřeno.`);
  if (catalogSnapshot.sources.length) {
    facts.push(`Datový základ pro tuto odpověď: ${catalogSnapshot.sources.map((source) => source.label).join(', ')}.`);
  }
  facts.push(`Po vyloučení STORNO a Platba selhala vidím ${formatNumber(orderSummary.total.orders)} objednávek a ${formatCurrency(orderSummary.total.revenue)} obratu zboží bez DPH a bez poštovného.`);
  facts.push(`Tržba z poštovného v tomto filtru je ${formatCurrency(orderSummary.total.shipping)} a držím ji odděleně mimo obrat zboží i mimo PNO.`);
  facts.push(`Hrubý zisk z přesných objednávek je ${formatPercent(marginSummary.total.grossProfitPct)}; přesných objednávek je ${formatNumber(marginSummary.total.exactOrders)} z ${formatNumber(marginSummary.total.orders)}.`);

  if (playbook.missingRequired.length) {
    missingData.push(`Playbook není kompletní: chybí nebo selhalo ${playbook.missingRequired.map((item) => item.tool).join(', ')}.`);
  }

  if (comparison?.orderSummary) {
    facts.push(`Proti předchozímu stejně dlouhému období ${comparison.dateFrom} až ${comparison.dateTo}: AOV ${formatCurrency(orderSummary.total.aov)} vs ${formatCurrency(comparison.orderSummary.total.aov)} (${formatChangePct(orderSummary.total.aov, comparison.orderSummary.total.aov)}), objednávky ${formatNumber(orderSummary.total.orders)} vs ${formatNumber(comparison.orderSummary.total.orders)}.`);
    facts.push(`Marže proti předchozímu období: ${formatPercent(marginSummary.total.grossProfitPct)} vs ${formatPercent(comparison.marginSummary.total.grossProfitPct)} (${formatChangePct(marginSummary.total.grossProfitPct, comparison.marginSummary.total.grossProfitPct)} relativně).`);
  } else if (!importLogisticsIntent) {
    missingData.push('Srovnání s předchozím obdobím jsem neprovedl; pro dlouhá období ho záměrně omezuji, aby endpoint nebyl příliš těžký.');
  }

  if (safeKnowledge?.contexts?.length || safeKnowledge?.memories?.length || safeKnowledge?.examples?.length || safeKnowledge?.meetingNotes?.length || safeKnowledge?.experiments?.length) {
    facts.push(`Použil jsem ${safeKnowledge.contexts.length} business kontextů, ${safeKnowledge.memories.length} pamětí, ${safeKnowledge.examples.length} schválené příklady, ${safeKnowledge.meetingNotes.length} meeting notes a ${safeKnowledge.experiments.length} experimenty k tématu ${safeKnowledge.topic}.`);
  } else {
    missingData.push('Nemám načtený žádný relevantní týmový kontext/paměť; pokud už k tomu padlo rozhodnutí na meetingu, je potřeba ho uložit do AI knowledge layer.');
  }

  if (safeKnowledge?.dataQualityIssues?.length) {
    missingData.push(`V knowledge layer jsou otevřené data-quality issue; nejvyšší signál: ${safeKnowledge.dataQualityIssues[0].title}.`);
  }

  if (ads) {
    facts.push(`Google/Meta campaign spend v načtených campaign řádcích je ${formatCurrency(ads.total.spend)}.`);
    if (ads.byProvider?.length) {
      const providerSummary = ads.byProvider.map((row) => `${row.provider === 'meta_ads' ? 'Meta' : 'Google'} ${formatCurrency(row.spend)}`).join(', ');
      facts.push(`Provider split spendu: ${providerSummary}.`);
    }
  } else if (!importLogisticsIntent) {
    missingData.push('Ads spend se nepodařilo načíst; bez něj nejde udělat přesné PNO ani vyhodnotit kampaně.');
  }

  if (freshness?.length) {
    const staleSources = freshness.filter((row) => row.status === 'stale' || row.status === 'error' || row.status === 'missing' || row.status === 'unverified');
    if (staleSources.length) {
      missingData.push(`Freshness warning: ${staleSources.map((row) => `${row.source}=${row.status}`).join(', ')}.`);
    } else {
      facts.push('Kontrola freshness neukázala žádný zjevně zastaralý marketingový zdroj.');
    }
  }

  if (!landingPages && !importLogisticsIntent) {
    missingData.push('Landing page data nejsou dostupná nebo se nenačetla; nesmím tvrdit, jaké stránky traffic reálně viděl.');
  }

  if (!smallGaLandingPages && ['daily_briefing', 'aov_drop', 'landing_page_problem', 'storefront_walkthrough', 'order_drop_intraday', 'high_pno', 'campaign_mix_change'].includes(intent)) {
    missingData.push('Malá GA landing pages nejsou dostupné; paid vs organic dopad na landing pages bez nich nepotvrdím.');
  }
  if (!smallGaFunnel && ['daily_briefing', 'order_drop_intraday', 'high_pno', 'campaign_mix_change', 'campaign_performance'].includes(intent)) {
    missingData.push('Malá GA funnel / commerce vrstva se nenačetla; traffic vs landing vs checkout tak neumím oddělit tak jistě.');
  }
  if (intent === 'campaign_performance') {
    missingData.push('Kampaňový obrat tady umím poctivě číst hlavně jako platform conversion value; nemám zatím autoritativní join real objednávek na kampaně.');
  }

  if (missingBuyPrices.length) {
    missingData.push(`Některá SKU mají chybějící nákupku; největší vidím u ${missingBuyPrices[0].sku}.`);
    facts.push(`SKU bez nákupky dělají ve filtru ${formatCurrency(missingBuyPriceRevenue)} tržby a snižují jistotu marže; přesných objednávek je ${formatPercent(marginSummary.total.exactSharePct)}.`);
    facts.push('SKU a bundle marže v Pokecu teď počítám jen nad exact revenue; řádky bez nákupky držím jako neúplné pokrytí, ne jako nulovou marži.');
  }

  if (intent === 'product_lookup') {
    if (productFocus?.match) {
      const match = productFocus.match;
      const sold = match.sold;
      const purchaseSummary = formatPurchasePrices(match.prices);
      facts.unshift(`Našel jsem produkt ${match.sku} (${match.dimension}, ${match.finish}, ${match.packSize}).`);
      facts.unshift(`Kanonická UpGates nákupka bez DPH: ${purchaseSummary || 'nenalezena'}.`);

      if (sold) {
        facts.unshift(`Ve vybraném období má ${formatNumber(sold.quantity)} ks v ${formatNumber(sold.orders)} objednávkách, tržbu ${formatCurrency(sold.revenue)} a hrubý zisk ${formatCoverageAwareMargin(sold)}.`);
      } else {
        missingData.push('Produkt jsem našel v aktuálních UpGates nákupkách, ale ve vybraném období ho nevidím prodaný; marži za období proto nepočítám.');
      }

      tables.unshift(table('Nákupka a prodejka podle států', ['Měna', 'Nákupka bez DPH', 'Prodejka bez DPH'], ['CZK', 'EUR', 'HUF', 'RON'].map((currency) => [
        currency,
        formatNativeCurrency(match.prices[currency], currency),
        formatNativeCurrency(match.salePrices[currency], currency),
      ])));
      tables.unshift(table('Nalezený produkt', ['SKU', 'Název', 'Rozměr', 'Finish', 'Balení', 'Ks', 'Tržba', 'Hrubý zisk %'], [[
        match.sku,
        match.title || 'bez názvu',
        match.dimension,
        match.finish,
        match.packSize,
        sold ? formatNumber(sold.quantity) : '0',
        sold ? formatCurrency(sold.revenue) : '—',
        sold ? formatCoverageAwareMargin(sold) : '—',
      ]]));

      if (productFocus.alternatives.length) {
        tables.push(table('Podobné shody', ['SKU', 'Název', 'Rozměr', 'Finish', 'Balení', 'Nákupka CZK'], productFocus.alternatives.map((row) => [
          row.sku,
          row.title || 'bez názvu',
          row.dimension,
          row.finish,
          row.packSize,
          formatNativeCurrency(row.prices.CZK, 'CZK'),
        ])));
      }
    } else {
      missingData.unshift(`Nenašel jsem jistou shodu pro produktový dotaz${productFocus?.requestedDimension ? ` (${productFocus.requestedDimension})` : ''}.`);
      nextSteps.unshift('Zkus napsat SKU nebo doplnit rozměr, finish a jestli jde o balíček.');
    }
  }

  if (intent === 'shipping_revenue') {
    hypotheses.push('Poštovné a doběrečné je potřeba držet mimo obrat zboží i mimo PNO, jinak zkreslí ekonomiku kampaní i AOV.');
    nextSteps.unshift('Porovnat poštovné po dnech a zemích proti referenčnímu období a ověřit, jestli změna nesouvisí se skladbou doprav nebo trhů.');
  }

  applyImportLogisticsResponse({
    importLogistics,
    intent,
    facts,
    hypotheses,
    missingData,
    nextSteps,
    tables,
  });

  const mustNotSkipStatuses = evaluateMustNotSkipStatuses({
    intent,
    mustNotSkip: catalogSnapshot.playbook.mustNotSkip,
    comparison,
    landingPages,
    smallGaLandingPages,
    smallGaSessions,
    freshness,
    orderSummary,
    marginSummary,
    bundleProducts,
    missingBuyPrices,
    catalogSnapshot,
    facts,
    missingData,
    nextSteps,
    hypotheses,
    competitorChanges,
    importLogistics,
  });
  const missingGuardrails = mustNotSkipStatuses.filter((item) => item.status !== 'pokryto');
  if (missingGuardrails.length) {
    missingData.push(`Playbook guardraily nejsou úplné: ${missingGuardrails.map((item) => item.guardrail).join(', ')}.`);
  }
  const sourceCoverage = buildSourceCoverageRows({
    catalogSnapshot,
    freshness,
    orderSummary,
    missingBuyPrices,
    ads,
    adsCampaigns,
    metaSpend,
    metaCampaigns,
    smallGaLandingPages,
    smallGaSessions,
    competitorChanges,
    knowledge: safeKnowledge,
    importLogistics,
  });
  const blockedSources = sourceCoverage.filter((row) => row.status === 'blocked');
  const partialSources = sourceCoverage.filter((row) => row.status === 'partial');
  if (sourceCoverage.length) {
    facts.push(`Zdrojové pokrytí: ${formatNumber(sourceCoverage.filter((row) => row.status === 'ready').length)} ready, ${formatNumber(partialSources.length)} partial, ${formatNumber(blockedSources.length)} blocked.`);
  }
  if (blockedSources.length) {
    missingData.push(`Zablokované zdroje: ${blockedSources.map((row) => row.source).join(', ')}.`);
  }

  tables.push(table('Playbook checklist', ['Kontrola', 'Stav'], [
    ...playbook.checklist.map((item) => [item.tool, item.status]),
    ...mustNotSkipStatuses.map((item) => [`guardrail:${item.guardrail}`, item.status]),
    ...playbook.desirableSignals.map((signal) => [signal, 'doporučený další signál']),
  ]));

  if (catalogSnapshot.playbook.requiredTools.length || catalogSnapshot.sources.length) {
    tables.push(table('Použitý playbook a zdroje', ['Sekce', 'Hodnota', 'Poznámka'], [
      ['Playbook', catalogSnapshot.playbook.title, catalogSnapshot.playbook.id],
      ['Must not skip', catalogSnapshot.playbook.mustNotSkip.join(', ') || 'bez explicitního seznamu', 'katalogový guardrail'],
      ['Typical missing data', catalogSnapshot.playbook.typicalMissingData.join(', ') || 'bez explicitního seznamu', 'katalogový hint'],
      ['Required tools', catalogSnapshot.playbook.requiredTools.join(', ') || 'bez explicitních toolů', 'katalogová definice'],
      ...catalogSnapshot.sources.map((source) => [
        'Zdroj',
        source.label,
        `${source.system}; freshness: ${source.freshnessRequirement}`,
      ]),
    ]));
    tables.push(table('Dostupné datové zdroje pro tuto diagnózu', ['Zdroj', 'Systém', 'Mutace', 'Známé limity'], catalogSnapshot.sources.map((source) => [
      source.label,
      source.system,
      source.mutationAllowed === false ? 'read-only' : String(source.mutationAllowed),
      source.knownLimits.slice(0, 2).join(' | ') || 'bez zapsaných limitů',
    ])));
  }

  if (intent === 'capabilities_overview') {
    facts.push(`V tomto prostředí mám katalogově popsaný read-only přístup k ${formatNumber(catalogSnapshot.sources.length)} hlavním zdrojům a ${formatNumber(catalogSnapshot.tools.length)} nástrojům.`);
    facts.push('Business odpovědi stavím jen na zdokumentovaných tool cestách; neberu si volně data mimo registry a bez evidence.');
    hypotheses.push('Když některý zdroj chybí nebo je starý, správná odpověď je přiznat limit a říct, co z něj bez čerstvých dat potvrdit neumím.');
    nextSteps.unshift('Když chceš, navážu z této mapy rovnou konkrétním diagnostickým dotazem, třeba AOV, marže, PNO nebo landing pages.');
    tables.push(table('Co umím z jednotlivých zdrojů', ['Zdroj', 'Co z něj umím zjistit', 'Kde je limit'], catalogSnapshot.sources.map((source) => [
      source.label,
      source.canAnswer.slice(0, 4).join(', ') || 'bez stručného katalogového popisu',
      source.knownLimits[0] || 'bez explicitního limitu',
    ])));
  }

  if (intent === 'knowledge_review') {
    const contextsByTopic = new Map();
    for (const row of safeKnowledge?.contexts || []) {
      const topic = row.topic || 'bez tématu';
      if (!contextsByTopic.has(topic)) contextsByTopic.set(topic, []);
      contextsByTopic.get(topic).push(row);
    }
    const keyTruths = [
      ...(contextsByTopic.get('business_goals') || []),
      ...(contextsByTopic.get('aov') || []),
      ...(contextsByTopic.get('ads') || []),
      ...(contextsByTopic.get('products') || []),
      ...(contextsByTopic.get('markets') || []),
      ...(contextsByTopic.get('storefront') || []),
    ].slice(0, 16);

    facts.push('Knowledge review je schvalovací režim: nevysvětluji příčinu jedné metriky, ale ukazuji, jaké business pravdy a heuristiky si teď Pokec nese v hlavě.');
    facts.push('Správný výstup tady není “mám pravdu”, ale “toto si myslím, že víme, a tady jsou místa, která potřebují potvrdit nebo opravit”.');
    hypotheses.push('Pokud se knowledge review rozchází s realitou shopu, cenotvorby nebo katalogu, je potřeba upravit knowledge layer dřív, než z toho budeme dělat automatické doporučení.');
    nextSteps.unshift('Projít tyto body jako schvalovací checklist a potvrdit, co je správně, co je zastaralé a co chybí.');

    if (keyTruths.length) {
      tables.push(table('Nejdůležitější business pravdy ke schválení', ['Téma', 'Název', 'Co si Pokec myslí, že ví', 'Jistota'], keyTruths.map((row) => [
        row.topic || 'bez tématu',
        row.title,
        clampText(row.body, 220),
        row.confidence || 'medium',
      ])));
    } else {
      missingData.push('Knowledge layer teď nevrátila žádné business pravdy ke schválení; bez nich by Pokec byl jen datový analytik bez merchant kontextu.');
    }

    if (safeKnowledge?.examples?.length) {
      tables.push(table('Schválené příklady chování', ['Název', 'Trigger', 'Expected behavior'], safeKnowledge.examples.slice(0, 8).map((row) => [
        row.title,
        Array.isArray(row.trigger_patterns) ? row.trigger_patterns.slice(0, 2).join(', ') : 'bez triggeru',
        Array.isArray(row.expected_behavior) ? row.expected_behavior.slice(0, 2).join(' | ') : '',
      ])));
    }

    if (safeKnowledge?.openQuestions?.length) {
      tables.push(table('Co ještě neumím dost jistě', ['Priorita', 'Téma', 'Otázka'], safeKnowledge.openQuestions.slice(0, 10).map((row) => [
        row.priority || 'medium',
        row.topic || 'bez tématu',
        row.title,
      ])));
    }
  }

  if (intent === 'trusted_best_practices') {
    facts.push('Externí doctrine beru jen z důvěryhodných primárních zdrojů: Google Ads official guidance, Meta official guidance a Baymard UX research.');
    facts.push('Best practice sama o sobě není důkaz o příčině u Regal Master; nejdřív říkám obecné doporučení a pak co z něj už je nebo není potvrzené našimi daty.');
    hypotheses.push('Největší hodnota pro Regal Master je spojit obecnou platform doctrine s našimi daty o AOV, marži, landing pages, produktovém mixu a order quality.');
    hypotheses.push('Pokud je best practice v rozporu s naším merchandisingem, skladovou realitou nebo cílem krátkodobě vytočit sklad, musí Pokec přiznat trade-off místo univerzální rady.');

    const trustedContexts = safeKnowledge?.contexts?.filter((row) => ['cro', 'ads', 'meta', 'landing_pages', 'business'].includes(row.topic)).slice(0, 8) || [];
    const regalValidatedContexts = safeKnowledge?.contexts?.filter((row) => {
      const text = cleanText(`${row.title || ''} ${row.body || ''}`);
      return /regal|storefront|balick|bundle|aov|pno|market|shipping|postovn|produkt/.test(text);
    }).slice(0, 6) || [];

    if (!trustedContexts.length) {
      missingData.push('V knowledge layer zatím nemám dost aktivních trusted doctrine kontextů pro CRO / Ads / Meta.');
    } else {
      facts.push(`K tomuto tématu mám ${formatNumber(trustedContexts.length)} trusted doctrine kontextů z knowledge layer.`);
      tables.push(table('Trusted doctrine', ['Téma', 'Doporučení', 'Zdroj'], trustedContexts.map((row) => [
        row.title,
        clampText(row.body, 180),
        summarizeKnowledgeEvidence(row) || 'zdroj neuveden v kontextu',
      ])));
    }

    if (regalValidatedContexts.length) {
      tables.push(table('Co už je potvrzené u Regal Master', ['Téma', 'Potvrzený lokální signál', 'Jistota'], regalValidatedContexts.map((row) => [
        row.title,
        clampText(row.body, 180),
        row.confidence || 'medium',
      ])));
    } else {
      missingData.push('Nemám zatím dost lokálně potvrzených Regal Master kontextů, které by přeložily obecné doctrine do konkrétních zásahů.');
    }

    if (safeKnowledge?.examples?.length) {
      facts.push('Mám i schválené příklady, že správná odpověď musí oddělit platform doctrine od lokálního důkazu a odblokovacího kroku.');
    }

    nextSteps.unshift('Použít trusted doctrine jen jako rámec a proti němu otestovat konkrétní Regal otázku: homepage, kategorie, PDP, Google Search/Shopping nebo Meta paid social.');
    nextSteps.push('Dopsat další vetted doctrine pro B2B qualification, shopping feed quality a Meta creative / audience / placement interpretaci.');
  }

  if (intent === 'assortment_strategy') {
    const strategicProducts = topProducts.map((row) => ({
      ...row,
      family: classifyProductFamily(row),
      commercialRole: classifyCommercialRole(row),
    }));
    const trafficDrivers = strategicProducts.filter((row) => row.commercialRole === 'traffic driver').slice(0, 3);
    const marginDrivers = strategicProducts.filter((row) => ['high-margin scaler', 'margin / b2b candidate', 'premium / stock-sensitive'].includes(row.commercialRole)).slice(0, 4);

    facts.push('Sortiment nečtu jen jako seznam SKU; skládám ho přes rodinu, rozměr, finish, pack-size a obchodní roli v katalogu.');
    facts.push('Traffic driver SKU a margin driver SKU musí být oddělené, jinak se míchá objem, konverzní síla a ekonomická kvalita objednávek.');
    hypotheses.push('Rozměry 1800x900x400 a 1800x900x300 fungují jako silné traffic a volume drivery, ale když dominují příliš, mohou tahat dolů AOV i maržovou kvalitu.');
    hypotheses.push('Vyšší rodiny 2000/2200/2400 mm a profesionalni / robust produkty mohou být podhodnocené, pokud jsou supply constrained nebo se jim nedává dost trafficu.');
    hypotheses.push('Finish a multipack varianta může měnit kvalitu objednávky jinak než samotný rozměr; merchant čtení proto musí oddělit lakované / zinkované a 1 ks / 3 ks / 5 ks / 10 ks chování.');

    if (trafficDrivers.length) {
      facts.push(`Nejsilnější traffic-driver teď v datech vypadá ${trafficDrivers[0].sku} (${trafficDrivers[0].dimension}) s tržbou ${formatCurrency(trafficDrivers[0].revenue)}.`);
    }
    if (marginDrivers.length) {
      facts.push(`Nejsilnější margin / premium kandidát teď v datech vypadá ${marginDrivers[0].sku} (${marginDrivers[0].dimension}) s marží ${formatPercent(marginDrivers[0].grossProfitPct)}.`);
    }
    if (missingBuyPrices.length) {
      missingData.push('Část sortimentu má chybějící nákupku, takže merchant interpretace není všude stejně silná.');
    }

    nextSteps.unshift('Oddělit v akvizici a merchandisingu traffic-driver SKU od margin-driver a B2B-candidate rodin.');
    nextSteps.push('U rodin 2000/2200/2400 mm a profesionalni / robust ověřit, jestli je nebrzdí hlavně stock-out nebo nízká expozice, ne slabá poptávka.');
    nextSteps.push('Balíčky hodnotit nejen podle kusů, ale podle toho, jestli zvedají AOV bez zhoršení maržové kvality.');

    tables.push(table('Assortment roles', ['SKU', 'Rodina', 'Rozměr', 'Role', 'Tržba', 'Hrubý zisk %'], strategicProducts.map((row) => [
      row.sku,
      row.family,
      row.dimension,
      row.commercialRole,
      formatCurrency(row.revenue),
      formatCoverageAwareMargin(row),
    ])));

    tables.push(table('Produktové rodiny', ['Rodina', 'Ks', 'Obj.', 'Tržba', 'Hrubý zisk %', 'Bundle ks'], productFamilies.map((row) => [
      row.family,
      formatNumber(row.quantity),
      formatNumber(row.orders),
      formatCurrency(row.revenue),
      formatCoverageAwareMargin(row),
      formatNumber(row.bundles),
    ])));
    tables.push(table('Rozměrové laddery', ['Výška', 'SKU', 'Ks', 'Tržba', 'Hrubý zisk %'], heightLadders.map((row) => [
      row.ladder,
      formatNumber(row.skuCount),
      formatNumber(row.quantity),
      formatCurrency(row.revenue),
      formatCoverageAwareMargin(row),
    ])));
    tables.push(table('Finish a pack-size', ['Finish', 'Pack-size', 'SKU', 'Ks', 'Tržba', 'Hrubý zisk %'], finishPackLadders.map((row) => [
      row.finish,
      row.packSize,
      formatNumber(row.skuCount),
      formatNumber(row.quantity),
      formatCurrency(row.revenue),
      formatCoverageAwareMargin(row),
    ])));
  }

  if (intent === 'storefront_walkthrough' || intent === 'landing_page_problem') {
    facts.push('Storefront walkthrough beru jako merchandising kontext, ne jako náhradu za orders, Ads a small GA data.');
    if (visualStorefrontContexts.length) {
      facts.push(`K tématu storefrontu mám ${formatNumber(visualStorefrontContexts.length)} kontextů s vizuální nebo walkthrough evidencí.`);
    } else {
      missingData.push('Nemám dost storefront kontextů s vizuální nebo screenshot/browser evidencí; vzhled a merchandising shopu proto umím popsat jen omezeně.');
    }
    hypotheses.push('Homepage, kategorie a PDP mohou zvyšovat konverzi i objem, ale zároveň tlačit levnější mix; to je potřeba vždy ověřit proti AOV, marži a produktovému mixu.');
    hypotheses.push('Pokud se mezi 4 trhy liší dostupný sortiment, první podezření je výpadek produktu nebo sync problém, ne chytrá lokální assortment strategie.');
    nextSteps.push('Pravidelně obnovovat storefront walkthrough po trzích a párovat ho s landing pages, produktovým mixem a AOV.');
    if (intent === 'storefront_walkthrough') {
      nextSteps.unshift('Oddělit potvrzené storefront signály od hypotéz a teprve potom navrhovat zásahy do homepage, kategorií nebo PDP.');
    }
    if (storefrontContexts.length) {
      tables.push(table('Potvrzené storefront signály', ['Téma', 'Potvrzený signál', 'Evidence'], storefrontContexts.slice(0, 8).map((row) => [
        row.title,
        clampText(row.body, 180),
        rowHasVisualEvidence(row) ? (summarizeKnowledgeEvidence(row) || 'walkthrough evidence') : 'bez vizuální evidence',
      ])));
    }
  }

  if (intent === 'shipping_revenue' || intent === 'daily_briefing' || intent === 'country_change') {
    tables.push(table('Tržba z poštovného po dnech', ['Den', 'Objednávky', 'Poštovné bez DPH'], shippingByDay.map((row) => [
      row.key,
      formatNumber(row.orders),
      formatCurrency(row.shipping),
    ])));
    tables.push(table('Tržba z poštovného podle země', ['Země', 'Objednávky', 'Poštovné bez DPH'], shippingByMarket.map((row) => [
      MARKET_LABELS[row.key] || row.key,
      formatNumber(row.orders),
      formatCurrency(row.shipping),
    ])));
  }

  if (intent === 'bundle_diagnostics' || intent === 'margin_drop' || bundleProducts.length) {
    const bundleRevenue = bundleProducts.reduce((sum, row) => sum + row.revenue, 0);
    const bundleExactRevenue = bundleProducts.reduce((sum, row) => sum + row.exactRevenue, 0);
    const bundleProfit = bundleProducts.reduce((sum, row) => sum + row.profit, 0);
    const bundleQty = bundleProducts.reduce((sum, row) => sum + row.quantity, 0);
    facts.push('Balíčky detekuji pravidlem: SKU končí `_5` nebo title obsahuje `5 ks` / `5buc`.');
    facts.push(`Balíčky tvoří ${formatNumber(bundleQty)} ks a ${formatCurrency(bundleRevenue)} obratu; jejich hrubý zisk z exact revenue je ${formatPercent(bundleExactRevenue ? (bundleProfit / bundleExactRevenue) * 100 : 0)}.`);
    hypotheses.push('Pokud balíčky rostou rychleji než zbytek sortimentu a mají nižší marži/AOV mix, mohou výrazně hýbat celkovou ekonomikou dne.');
    tables.push(table('Balíčky po dnech', ['Den', 'Ks balíčků', 'Obj.', 'Tržba', 'Hrubý zisk %'], bundlesByDay.map((row) => [
      row.date,
      formatNumber(row.quantity),
      formatNumber(row.orders),
      formatCurrency(row.revenue),
      formatCoverageAwareMargin(row),
    ])));
    tables.push(table('Top balíčková SKU', ['SKU', 'Rozměr', 'Ks', 'Tržba', 'Hrubý zisk %'], bundleProducts.map((row) => [
      row.sku,
      row.dimension,
      formatNumber(row.quantity),
      formatCurrency(row.revenue),
      formatCoverageAwareMargin(row),
    ])));
  }

  if (intent === 'daily_briefing') {
    hypotheses.push('Briefing je start dne, ne finální audit. Má vytáhnout, kde je největší šance, že se dnes něco láme v AOV, marži nebo PNO.');
    if (smallGaFunnel) {
      facts.push(`Small GA funnel v aktuálním filtru: ${formatPercent(smallGaFunnel.addToCartRatePct)} add-to-cart, ${formatPercent(smallGaFunnel.checkoutRatePct)} checkout a ${formatPercent(smallGaFunnel.purchaseRatePct)} purchase rate.`);
      if (smallGaFunnel.purchases?.available) {
        facts.push(`Malá GA purchase vrstva v období eviduje ${formatNumber(smallGaFunnel.purchases.count)} purchase záznamů s průměrnou hodnotou ${formatCurrency(smallGaFunnel.purchases.avgValueCzk)} v CZK normalizaci.`);
      }
    }
    if (landingPages?.length) {
      const leadPage = landingPages[0];
      hypotheses.push(`Nejsilnější landing page podle spendu je teď ${leadPage.pageType} a stojí za kontrolu, pokud se zároveň mění AOV nebo produktový mix.`);
    }
    nextSteps.unshift('Podívat se nejdřív na první watchout z briefingu a ověřit, jestli jde o datový signál, nebo už o business problém.');
  }

  if (intent === 'shipping_revenue') {
    facts.push(`Poštovné na objednávku je v tomto filtru ${formatCurrency(orderSummary.total.orders ? orderSummary.total.shipping / orderSummary.total.orders : 0)}.`);
    if (comparison?.orderSummary) {
      facts.push(`Poštovné proti předchozímu období: ${formatCurrency(orderSummary.total.shipping)} vs ${formatCurrency(comparison.orderSummary.total.shipping)} (${formatChangePct(orderSummary.total.shipping, comparison.orderSummary.total.shipping)}).`);
    }
  }

  if (intent === 'order_drop_intraday') {
    const weakestHour = hourlyOrders.slice().sort((a, b) => a.orders - b.orders)[0];
    facts.push(`Hodinový rozpad v aktuálním filtru ukazuje ${formatNumber(hourlyOrders.length)} aktivních hodin s objednávkou.`);
    if (weakestHour) {
      hypotheses.push(`Nejslabší hodina v aktuálním filtru je ${weakestHour.hour}:00 s ${formatNumber(weakestHour.orders)} objednávkami a tržbou ${formatCurrency(weakestHour.revenue)}.`);
    }
    if (smallGaSessions) {
      facts.push(`Small GA ve stejném filtru ukazuje ${formatNumber(smallGaSessions.totalSessions)} sessions, ${formatPercent(smallGaSessions.cartRatePct)} cart rate a ${formatPercent(smallGaSessions.purchaseRatePct)} purchase rate.`);
      const leadSource = smallGaSessions.topSources[0];
      if (leadSource) {
        hypotheses.push(`Nejsilnější source/medium v malé GA je ${leadSource.source} / ${leadSource.medium} (${formatNumber(leadSource.sessions)} sessions, ${formatPercent(leadSource.purchaseRatePct)} purchase rate).`);
      }
    } else {
      missingData.push('Bez small GA sessions neumím poctivě oddělit slabý traffic od slabé konverze během dne.');
    }
    if (smallGaFunnel) {
      facts.push(`Small GA funnel doplňuje ${formatPercent(smallGaFunnel.checkoutRatePct)} checkout rate a ${formatPercent(smallGaFunnel.checkoutCompletionPct)} checkout-to-purchase completion.`);
      if (smallGaFunnel.topLandingPages?.length) {
        const weakLanding = smallGaFunnel.topLandingPages
          .filter((row) => row.sessions >= 5)
          .sort((a, b) => a.checkoutCompletionPct - b.checkoutCompletionPct)[0];
        if (weakLanding) {
          hypotheses.push(`Nejslabší landing funnel v malé GA je ${weakLanding.landingPage}: ${formatPercent(weakLanding.addToCartRatePct)} add-to-cart, ${formatPercent(weakLanding.checkoutRatePct)} checkout a ${formatPercent(weakLanding.checkoutCompletionPct)} completion.`);
        }
      }
    }
    nextSteps.push('Porovnat slabé hodiny proti referenci a ověřit, jestli jde o propad trafficu, nebo o změnu konverze na webu.');
  }

  if (intent === 'margin_drop') {
    hypotheses.push('Pokles marže obvykle vzniká mixem low-margin SKU, balíčků, cenových změn, missing buy_price nebo malým vzorkem objednávek.');
    facts.push(`Velikost vzorku pro marži je dnes ${formatNumber(marginSummary.total.orders)} objednávek, z toho přesných ${formatNumber(marginSummary.total.exactOrders)}.`);
    facts.push('Do této maržové diagnostiky z principu nepočítám STORNO a Platba selhala; pokud dnes narostly failed payments mimo filtr, je to separátní provozní signál.');
    facts.push('Chybějící nákupku beru jako coverage riziko; SKU bez ceny nesmím vydávat za potvrzenou marži.');
    if (lowMarginProducts.length) {
      facts.push(`Nejslabší přesná SKU podle hrubého zisku je ${lowMarginProducts[0].sku} (${lowMarginProducts[0].dimension}) s marží ${formatPercent(lowMarginProducts[0].grossProfitPct)}.`);
    }
    tables.push(table('Low-margin SKU', ['SKU', 'Rozměr', 'Ks', 'Tržba', 'Hrubý zisk %'], lowMarginProducts.map((row) => [
      row.sku,
      row.dimension,
      formatNumber(row.quantity),
      formatCurrency(row.revenue),
      formatPercent(row.grossProfitPct),
    ])));
    nextSteps.push('Porovnat dnešní low-margin SKU proti referenčnímu období a zjistit, jestli je tlačí konkrétní kampaň nebo landing page.');
  }

  if (intent === 'aov_drop' || intent === 'landing_page_problem') {
    hypotheses.push('Pokles AOV je potřeba řešit přes produktový mix, počet kusů v objednávce a landing pages. Samotné PNO nebo počet objednávek nestačí.');
    const dominantValueBucket = orderValueBuckets.slice().sort((a, b) => b.orders - a.orders)[0];
    const dominantItemBucket = orderItemBuckets.slice().sort((a, b) => b.orders - a.orders)[0];
    if (dominantValueBucket) {
      facts.push(`Největší hodnotový bucket objednávek je teď ${dominantValueBucket.bucket} s ${formatNumber(dominantValueBucket.orders)} objednávkami (${formatPercent(dominantValueBucket.orderSharePct)} objednávek).`);
    }
    if (dominantItemBucket) {
      facts.push(`Nejčastější velikost objednávky je teď ${dominantItemBucket.bucket} s podílem ${formatPercent(dominantItemBucket.orderSharePct)} objednávek.`);
    }
    if (comparison?.productChanges?.length) {
      const mover = comparison.productChanges[0];
      hypotheses.push(`Největší změna produktového mixu proti předchozímu období je ${mover.sku} (${mover.dimension}), změna podílu na tržbě ${formatPercent(mover.sharePointChange)} bodu.`);
    }
    if (smallGaLandingPages?.length) {
      const paidLead = smallGaLandingPages.find((row) => row.channelBucket === 'paid') || smallGaLandingPages[0];
      hypotheses.push(`V malé GA teď nejsilnější landing page ve zvoleném filtru je ${paidLead.pageType} ${paidLead.landingPage} (${formatNumber(paidLead.sessions)} sessions, ${formatNumber(paidLead.purchaseEvents)} purchase eventů); to je dobrý kandidát na další kontrolu.`);
    }
    if (intent === 'landing_page_problem') {
      missingData.push('Bez vizuální kontroly stránky nesmím tvrdit, jak landing page reálně vypadá, jak má řazení nebo co je nad foldem.');
      nextSteps.push('Pokud chceš soudit vzhled landing page, je potřeba udělat browser kontrolu konkrétní URL a teprve pak tvrdit něco o řazení nebo hero části.');
    }
    nextSteps.push('Porovnat top SKU a landing pages proti období, kdy bylo AOV vyšší.');
  }

  if (intent === 'product_mix_change') {
    hypotheses.push('Změna produktového mixu má smysl až tehdy, když se oddělí změna podílu SKU od pouhého poklesu celkové poptávky.');
    if (comparison?.productChanges?.length) {
      const mover = comparison.productChanges[0];
      facts.push(`Největší mover v mixu je ${mover.sku} (${mover.dimension}) se změnou podílu ${formatPercent(mover.sharePointChange)} p. b..`);
    } else {
      missingData.push('Bez předchozího srovnání neumím poctivě určit změnu produktového mixu.');
    }
    nextSteps.push('Podívat se, jestli mixové změny současně zlepšují nebo zhoršují marži a AOV.');
  }

  if (intent === 'high_pno') {
    const pno = orderSummary.total.revenue ? (ads?.total.spend || 0) / orderSummary.total.revenue * 100 : 0;
    facts.push(`Real PNO ve filtru je orientačně ${formatPercent(pno)} proti obratu zboží bez DPH a bez poštovného.`);
    if (freshness?.length) {
      const adsFreshness = freshness.filter((row) => row.source.includes('ads'));
      facts.push(`Freshness Ads synců: ${adsFreshness.map((row) => `${row.source}=${row.status}`).join(', ')}.`);
    }
    if (metaSpend) {
      const metaPno = orderSummary.total.revenue ? (metaSpend.total.spend / orderSummary.total.revenue) * 100 : 0;
      facts.push(`Meta spend samostatně: ${formatCurrency(metaSpend.total.spend)} přes ${formatNumber(metaSpend.campaignCount)} kampaní; orientační Meta PNO proti real revenue je ${formatPercent(metaPno)}.`);
    } else {
      missingData.push('Meta spend nemám jako samostatný potvrzený vstup; Google vs Meta porovnání proto může být jen částečné.');
    }
    if (metaCampaigns?.length) {
      const leadMeta = metaCampaigns[0];
      hypotheses.push(`Nejsilnější Meta kampaň podle spendu je ${leadMeta.campaign} (${formatCurrency(leadMeta.spend)}); stojí za kontrolu, pokud paid social přivádí levnější objednávky než Google.`);
    }
    const smallGaPaidSources = smallGaSessions?.topSources?.length
      ? smallGaSessions.topSources
      : smallGaFunnel?.topSources?.length
        ? smallGaFunnel.topSources
        : [];
    if (smallGaPaidSources.length) {
      const paidSources = smallGaPaidSources.filter((row) => row.channelBucket === 'paid');
      const topPaidSource = paidSources[0] || smallGaPaidSources[0];
      if (topPaidSource) {
        facts.push(`Small GA paid signál: ${topPaidSource.source} / ${topPaidSource.medium} / ${topPaidSource.campaign} = ${formatNumber(topPaidSource.sessions)} sessions, ${formatPercent(topPaidSource.purchaseRatePct)} purchase rate.`);
      }
    } else {
      missingData.push('Small GA source/campaign vrstva se nenačetla; traffic quality vs landing quality tak neumím odlišit tak jistě.');
    }
    const smallGaPaidLandings = smallGaLandingPages?.length
      ? smallGaLandingPages
      : smallGaFunnel?.topLandingPages?.length
        ? smallGaFunnel.topLandingPages
        : [];
    if (smallGaPaidLandings.length) {
      const weakPaidLanding = smallGaPaidLandings
        .filter((row) => row.channelBucket === 'paid' && row.sessions >= 5)
        .sort((a, b) => a.purchaseRatePct - b.purchaseRatePct)[0];
      if (weakPaidLanding) {
        hypotheses.push(`Paid traffic v malé GA má slabší funnel na ${weakPaidLanding.landingPage}: ${formatNumber(weakPaidLanding.sessions)} sessions, ${formatPercent(weakPaidLanding.cartRatePct)} cart rate, ${formatPercent(weakPaidLanding.purchaseRatePct)} purchase rate.`);
      }
    }
    if (smallGaFunnel?.topSources?.length) {
      const weakestPaidFunnel = smallGaFunnel.topSources
        .filter((row) => row.channelBucket === 'paid' && row.sessions >= 5)
        .sort((a, b) => a.checkoutCompletionPct - b.checkoutCompletionPct)[0];
      if (weakestPaidFunnel) {
        facts.push(`Small GA funnel paid layer: ${weakestPaidFunnel.source} / ${weakestPaidFunnel.medium} / ${weakestPaidFunnel.campaign} má ${formatPercent(weakestPaidFunnel.addToCartRatePct)} add-to-cart, ${formatPercent(weakestPaidFunnel.checkoutRatePct)} checkout a ${formatPercent(weakestPaidFunnel.checkoutCompletionPct)} completion.`);
      }
    }
    if (smallGaFunnel?.carts?.available) {
      facts.push(`Malá GA košíky v období: ${formatNumber(smallGaFunnel.carts.count)} celkem, ${formatPercent(smallGaFunnel.carts.abandonedPct)} abandon, ${formatPercent(smallGaFunnel.carts.recoveredPct)} recovered.`);
    }
    if (ads?.campaignMix?.length) {
      const currentMixSummary = ads.campaignMix.map((row) => `${row.bucket} ${formatPercent(row.sharePct)}`).join(', ');
      facts.push(`Aktuální mix Google kampaní podle spendu: ${currentMixSummary}.`);
      if (comparison?.adsCampaignMix?.length) {
        const previousMixByBucket = new Map(comparison.adsCampaignMix.map((row) => [row.bucket, row]));
        const biggestShift = ads.campaignMix
          .map((row) => ({
            ...row,
            previousSharePct: previousMixByBucket.get(row.bucket)?.sharePct || 0,
            sharePointChange: row.sharePct - (previousMixByBucket.get(row.bucket)?.sharePct || 0),
          }))
          .sort((a, b) => Math.abs(b.sharePointChange) - Math.abs(a.sharePointChange))[0];
        if (biggestShift) {
          hypotheses.push(`Největší posun v mixu kampaní je ${biggestShift.bucket}: ${formatPercent(biggestShift.sharePct)} vs ${formatPercent(biggestShift.previousSharePct)} (${formatPercent(biggestShift.sharePointChange)} p. b.).`);
        }
      } else {
        missingData.push('Aktuální mix kampaní vidím, ale bez předchozího Ads mixu nemůžu poctivě tvrdit, že se search/shopping opravdu přepnuly.');
      }
    }
    if (adsSearchTerms?.topTerms?.length) {
      const leadTerm = adsSearchTerms.topTerms[0];
      hypotheses.push(`Nejdražší search term podle spendu je ${leadTerm.searchTerm} s útratou ${formatCurrency(leadTerm.spend)} a ${formatNumber(leadTerm.clicks)} kliky.`);
    } else {
      missingData.push('Bez Google Ads search terms nevidím, jestli spend táhnou široké nebo levné dotazy.');
    }
    if (adsShoppingProducts?.topProducts?.length) {
      const leadShoppingProduct = adsShoppingProducts.topProducts[0];
      hypotheses.push(`Nejsilnější shopping produkt podle spendu je ${leadShoppingProduct.itemId} s útratou ${formatCurrency(leadShoppingProduct.spend)}.`);
    } else {
      missingData.push('Bez Google Ads shopping produktů nevidím, které produktové listingy táhnou spend a levnější mix.');
    }
    if (adsCampaigns?.length) {
      const spendOnlyCampaign = adsCampaigns.find((row) => row.spend > 0 && row.conversions <= 0);
      if (spendOnlyCampaign) {
        hypotheses.push(`Kampaň ${spendOnlyCampaign.campaign} má spend ${formatCurrency(spendOnlyCampaign.spend)} bez konverzí v tomto filtru a stojí za kontrolu jako kandidát na slabé PNO.`);
      }
    } else {
      missingData.push('Bez detailu Google Ads kampaní nevidím, které konkrétní kampaně mají spend bez konverzí.');
    }
    nextSteps.push('Najít kampaně se spendem bez real objednávek a kampaně, které vodí na low-AOV/low-margin produkty.');
  }

  if (intent === 'campaign_mix_change') {
    if (ads?.campaignMix?.length && comparison?.adsCampaignMix?.length) {
      const previousMixByBucket = new Map(comparison.adsCampaignMix.map((row) => [row.bucket, row]));
      const shifts = ads.campaignMix
        .map((row) => ({
          ...row,
          previousSharePct: previousMixByBucket.get(row.bucket)?.sharePct || 0,
          sharePointChange: row.sharePct - (previousMixByBucket.get(row.bucket)?.sharePct || 0),
        }))
        .sort((a, b) => Math.abs(b.sharePointChange) - Math.abs(a.sharePointChange));
      if (shifts[0]) {
        facts.push(`Největší posun v kampanovém mixu je ${shifts[0].bucket}: ${formatPercent(shifts[0].sharePct)} vs ${formatPercent(shifts[0].previousSharePct)} (${formatPercent(shifts[0].sharePointChange)} p. b.).`);
      }
    } else {
      missingData.push('Bez mixu kampaní v obou obdobích neumím poctivě tvrdit, že se mix opravdu změnil.');
    }
    if (adsSearchTerms?.topTerms?.length) {
      facts.push(`Mám k dispozici ${formatNumber(adsSearchTerms.topTerms.length)} top search terms podle spendu pro kontrolu, zda Search netáhnou levnější dotazy.`);
    }
    if (adsShoppingProducts?.topProducts?.length) {
      facts.push(`Mám k dispozici ${formatNumber(adsShoppingProducts.topProducts.length)} top shopping produktů podle spendu pro kontrolu, jestli Shopping nekoncentruje levnější SKU.`);
    }
    const campaignMixSourceRows = smallGaSessions?.topSources?.length
      ? smallGaSessions.topSources
      : smallGaFunnel?.topSources?.length
        ? smallGaFunnel.topSources
        : [];
    if (campaignMixSourceRows.length) {
      const topPaidSource = campaignMixSourceRows
        .filter((row) => row.channelBucket === 'paid')
        .sort((a, b) => b.sessions - a.sessions)[0];
      if (topPaidSource) {
        facts.push(`Malá GA potvrzuje paid mix přes ${topPaidSource.source} / ${topPaidSource.medium} / ${topPaidSource.campaign}: ${formatNumber(topPaidSource.sessions)} sessions, ${formatPercent(topPaidSource.purchaseRatePct)} purchase rate.`);
      }
    } else {
      missingData.push('Small GA source/campaign vrstva chybí; změnu mixu pak čtu jen z reklamních platforem bez funnel kontextu.');
    }
    const campaignMixLandingRows = smallGaLandingPages?.length
      ? smallGaLandingPages
      : smallGaFunnel?.topLandingPages?.length
        ? smallGaFunnel.topLandingPages
        : [];
    if (campaignMixLandingRows.length) {
      const paidLanding = campaignMixLandingRows
        .filter((row) => row.channelBucket === 'paid')
        .sort((a, b) => b.sessions - a.sessions)[0];
      if (paidLanding) {
        hypotheses.push(`Paid mix v malé GA teď nejvíc padá na ${paidLanding.landingPage} (${paidLanding.pageType}), kde vidím ${formatNumber(paidLanding.sessions)} sessions a ${formatPercent(paidLanding.purchaseRatePct)} purchase rate.`);
      }
    } else {
      missingData.push('Bez small GA landing pages neověřím, jestli se změna kampanového mixu propsala i do typu landing pages a jejich kvality.');
    }
    if (smallGaFunnel?.topSources?.length) {
      const leadPaidSource = smallGaFunnel.topSources
        .filter((row) => row.channelBucket === 'paid')
        .sort((a, b) => b.sessions - a.sessions)[0];
      if (leadPaidSource) {
        facts.push(`Malá GA funnel vrstva potvrzuje lead paid source ${leadPaidSource.source} / ${leadPaidSource.medium} / ${leadPaidSource.campaign}: ${formatPercent(leadPaidSource.addToCartRatePct)} add-to-cart, ${formatPercent(leadPaidSource.checkoutRatePct)} checkout, ${formatPercent(leadPaidSource.purchaseRatePct)} purchase.`);
      }
    }
    nextSteps.push('Navázat kampanový mix na landing pages a na produktový mix objednávek, jinak je to jen mediální signál bez business interpretace.');
  }

  if (intent === 'campaign_performance') {
    if (campaignPerformance.length) {
      const topByValue = campaignPerformance.find((row) => row.conversionValue > 0) || campaignPerformance[0];
      const topByPurchaseRate = campaignPerformance
        .filter((row) => toNumber(row.purchaseRatePct) > 0 && row.smallGaSessions >= 5)
        .sort((a, b) => toNumber(b.purchaseRatePct) - toNumber(a.purchaseRatePct))[0];
      const topByMatchedPurchaseValue = campaignPerformance
        .filter((row) => toNumber(row.matchedPurchaseValueCzk) > 0)
        .sort((a, b) => toNumber(b.matchedPurchaseValueCzk) - toNumber(a.matchedPurchaseValueCzk))[0];
      if (topByValue) {
        facts.push(`Nejsilnější kampaň podle platform conversion value je ${topByValue.campaign} (${topByValue.provider === 'meta_ads' ? 'Meta' : 'Google'}) s hodnotou ${formatCurrency(topByValue.conversionValue)} a spendem ${formatCurrency(topByValue.spend)}.`);
      }
      if (topByPurchaseRate) {
        facts.push(`Nejkonverznější kampaň podle small GA purchase rate je ${topByPurchaseRate.campaign} (${topByPurchaseRate.provider === 'meta_ads' ? 'Meta' : 'Google'}) s ${formatPercent(topByPurchaseRate.purchaseRatePct)} purchase rate a ${formatNumber(topByPurchaseRate.smallGaSessions)} sessions.`);
      } else {
        missingData.push('Nemám dost small GA kampanových sessions pro jisté pořadí podle purchase rate; zůstávám u platform konverzí a conversion value.');
      }
      if (topByMatchedPurchaseValue) {
        facts.push(`Best-effort commercial signál z malé GA po visitor/session matchingu teď nejvíc sedí na ${topByMatchedPurchaseValue.campaign}: ${formatCurrency(topByMatchedPurchaseValue.matchedPurchaseValueCzk)} matched purchase value a ${formatNumber(topByMatchedPurchaseValue.matchedPurchaseCount)} purchase záznamů.`);
      } else {
        missingData.push('U kampaní zatím nemám dost small GA purchase záznamů, které by šly spolehlivě přiřadit přes visitor/session matching k jedné kampani.');
      }
      if (topByPurchaseRate?.topCartItem) {
        hypotheses.push(`U kampaně ${topByPurchaseRate.campaign} vidím v malé GA jako nejčastější cart item ${topByPurchaseRate.topCartItem} a průměrnou cart value ${formatCurrency(topByPurchaseRate.avgCartValueCzk)}.`);
      }
      hypotheses.push('Platform conversion value a small GA purchase rate nejsou totéž; nejlepší odpověď je držet je vedle sebe, ne je slévat do jedné pravdy.');
    } else {
      missingData.push('Kampaňový výkon se nenačetl; bez kampaní neumím říct top obrat ani top konverzi.');
    }
    nextSteps.push('Pokud chceme skutečný real revenue by campaign, je potřeba doplnit autoritativní order-to-campaign attribution join, ne jen platformní conversion value.');
  }

  if (intent === 'country_change') {
    const countryRow = orderSummary.byMarket.find((row) => row.market === market);
    if (countryRow) {
      facts.push(`Ve vybrané zemi vidím ${formatNumber(countryRow.orders)} objednávek, AOV ${formatCurrency(countryRow.aov)} a B2B podíl ${formatPercent(countryRow.b2bPct)}.`);
    }
    if (comparison?.orderSummary?.byMarket?.length) {
      const previousCountry = comparison.orderSummary.byMarket.find((row) => row.market === market);
      if (previousCountry && countryRow) {
        hypotheses.push(`Ve vybrané zemi se AOV změnilo z ${formatCurrency(previousCountry.aov)} na ${formatCurrency(countryRow.aov)} a stojí za srovnání s ostatními trhy.`);
      }
    }
    nextSteps.push('Srovnat vybranou zemi s ostatními trhy přes AOV, marži, B2B podíl a kampanový mix.');
  }

  if (intent === 'competitor_change') {
    if (competitorChanges?.length) {
      const latestChange = competitorChanges[0];
      facts.push(`Nejčerstvější konkurenční observation je ${latestChange.competitor}: ${latestChange.title} (${latestChange.observed_at}).`);
      hypotheses.push('Konkurenci beru jen jako doplňkový signál; bez přímého matchingu na naše SKU zůstává dopad hypotézou.');
      nextSteps.push('Spárovat konkurenční observation s konkrétními SKU nebo kategoriemi, které se teď mění i u nás.');
    } else {
      missingData.push('Konkurenci neumím férově hodnotit bez aktuálního Matrix scrape s datem ověření.');
      nextSteps.push('Spustit nebo načíst poslední Matrix scrape a propojit změny cen/skladu s naším produktovým mixem.');
    }
  }

  if (intent === 'missing_data') {
    hypotheses.push('Tady je důležitější poctivě přiznat limit než tlačit závěr přes poloviční evidenci.');
    nextSteps.push('Odblokovat nejdřív chybějící zdroj nebo sync a teprve pak dělat tvrdší business závěr.');
  }

  tables.push(table('Top produktový mix', ['SKU', 'Rozměr', 'Ks', 'Obj.', 'Tržba', 'Hrubý zisk %'], topProducts.map((row) => [
    row.sku,
    row.dimension,
    formatNumber(row.quantity),
    formatNumber(row.orders),
    formatCurrency(row.revenue),
    formatCoverageAwareMargin(row),
  ])));

  if (comparison) {
    tables.push(table('Změna produktového mixu vs předchozí období', ['SKU', 'Rozměr', 'Ks teď', 'Ks předtím', 'Podíl teď', 'Podíl předtím', 'Změna p.b.'], comparison.productChanges.slice(0, 8).map((row) => [
      row.sku,
      row.dimension,
      formatNumber(row.quantity),
      formatNumber(row.previousQuantity),
      formatPercent(row.currentShare),
      formatPercent(row.previousShare),
      formatPercent(row.sharePointChange),
    ])));
  }

  if (intent === 'aov_drop' || intent === 'daily_briefing') {
    tables.push(table('Objednávky podle hodnotových bucketů', ['Bucket', 'Obj.', 'Podíl obj.', 'Tržba', 'Podíl tržby'], orderValueBuckets.map((row) => [
      row.bucket,
      formatNumber(row.orders),
      formatPercent(row.orderSharePct),
      formatCurrency(row.revenue),
      formatPercent(row.revenueSharePct),
    ])));
    tables.push(table('Objednávky podle počtu kusů', ['Bucket', 'Obj.', 'Podíl obj.', 'Tržba', 'Podíl tržby'], orderItemBuckets.map((row) => [
      row.bucket,
      formatNumber(row.orders),
      formatPercent(row.orderSharePct),
      formatCurrency(row.revenue),
      formatPercent(row.revenueSharePct),
    ])));
  }

  if (hourlyOrders.length && intent === 'order_drop_intraday') {
    tables.push(table('Objednávky po hodinách', ['Hodina', 'Objednávky', 'Tržba'], hourlyOrders.map((row) => [
      row.hour,
      formatNumber(row.orders),
      formatCurrency(row.revenue),
    ])));
  }

  if (orderSummary.byMarket.length && (intent === 'country_change' || intent === 'daily_briefing')) {
    tables.push(table('Rozpad podle země', ['Země', 'Obj.', 'Obrat', 'AOV', 'B2B %'], orderSummary.byMarket.map((row) => [
      MARKET_LABELS[row.market] || row.market,
      formatNumber(row.orders),
      formatCurrency(row.revenue),
      formatCurrency(row.aov),
      formatPercent(row.b2bPct),
    ])));
  }

  if (adsCampaigns?.length) {
    const campaignRows = adsCampaigns.slice(0, 8).map((row) => [
      MARKET_LABELS[row.market] || row.market,
      row.campaign,
      row.channelType || row.channelSubType || 'bez channel',
      formatCurrency(row.spend),
      formatNumber(row.clicks),
      formatNumber(row.conversions),
    ]);
    tables.push(table('Top Google Ads kampaně', ['Země', 'Kampaň', 'Channel', 'Spend', 'Kliky', 'Konverze'], campaignRows));
    tables.push(table('Top kampaně podle spendu', ['Země', 'Kampaň', 'Channel', 'Spend', 'Kliky', 'Konverze'], campaignRows));
  } else if (ads?.topCampaigns?.length) {
    tables.push(table('Top kampaně podle spendu', ['Provider', 'Země', 'Kampaň', 'Spend', 'Kliky'], ads.topCampaigns.slice(0, 8).map((row) => [
      row.provider,
      MARKET_LABELS[row.market] || row.market,
      row.campaign,
      formatCurrency(row.spend),
      formatNumber(row.clicks),
    ])));
  }

  if (ads?.campaignMix?.length) {
    tables.push(table('Mix kampaní podle spendu', ['Bucket', 'Spend', 'Podíl teď', 'Podíl předtím'], ads.campaignMix.map((row) => [
      row.bucket,
      formatCurrency(row.spend),
      formatPercent(row.sharePct),
      comparison?.adsCampaignMix
        ? formatPercent(comparison.adsCampaignMix.find((item) => item.bucket === row.bucket)?.sharePct || 0)
        : 'bez srovnání',
    ])));
  }

  if (adsSearchTerms?.topTerms?.length) {
    tables.push(table('Top Ads search terms', ['Search term', 'Spend', 'Kliky', 'Konverze', 'Hodnota konverzí'], adsSearchTerms.topTerms.slice(0, 8).map((row) => [
      row.searchTerm,
      formatCurrency(row.spend),
      formatNumber(row.clicks),
      formatNumber(row.conversions),
      formatCurrency(row.conversionValue),
    ])));
  }

  if (adsShoppingProducts?.topProducts?.length) {
    tables.push(table('Top Ads shopping produkty', ['Produkt / item', 'Spend', 'Kliky', 'Konverze', 'Hodnota konverzí'], adsShoppingProducts.topProducts.slice(0, 8).map((row) => [
      row.itemId,
      formatCurrency(row.spend),
      formatNumber(row.clicks),
      formatNumber(row.conversions),
      formatCurrency(row.conversionValue),
    ])));
  }

  if (metaCampaigns?.length) {
    tables.push(table('Top Meta kampaně', ['Země', 'Kampaň', 'Status', 'Spend', 'Kliky'], metaCampaigns.slice(0, 8).map((row) => [
      MARKET_LABELS[row.market] || row.market,
      row.campaign,
      row.status || row.servingStatus || 'bez statusu',
      formatCurrency(row.spend),
      formatNumber(row.clicks),
    ])));
  }

  if (campaignPerformance.length && intent === 'campaign_performance') {
    tables.push(table('Výkon kampaní: platform value vs funnel', ['Provider', 'Země', 'Kampaň', 'Spend', 'Platform value', 'Platform CVR', 'Small GA sessions', 'Purchase rate', 'Matched purchase value'], campaignPerformance.slice(0, 10).map((row) => [
      row.provider === 'meta_ads' ? 'Meta' : row.provider === 'google_ads' ? 'Google' : 'Unknown',
      MARKET_LABELS[row.market] || row.market,
      row.campaign,
      formatCurrency(row.spend),
      formatCurrency(row.conversionValue),
      formatPercent(row.platformConvRatePct),
      formatNumber(row.smallGaSessions),
      row.purchaseRatePct == null ? '—' : formatPercent(row.purchaseRatePct),
      row.matchedPurchaseValueCzk ? formatCurrency(row.matchedPurchaseValueCzk) : '—',
    ])));
  }

  if (landingPages?.length) {
    tables.push(table('Top Ads landing pages', ['Typ', 'Landing page', 'Spend', 'Kliky'], landingPages.slice(0, 8).map((row) => [
      row.pageType,
      row.landingPage,
      formatCurrency(row.spend),
      formatNumber(row.clicks),
    ])));
  }

  if (smallGaLandingPages?.length) {
    tables.push(table('Top small GA landing pages', ['Kanál', 'Typ', 'Landing page', 'Sessions', 'Cart rate', 'Purchase rate', 'Purchase evt.', 'Top kampaň'], smallGaLandingPages.slice(0, 8).map((row) => [
      row.channelBucket,
      row.pageType,
      row.landingPage,
      formatNumber(row.sessions),
      formatPercent(row.cartRatePct),
      formatPercent(row.purchaseRatePct),
      formatNumber(row.purchaseEvents),
      row.topCampaign,
    ])));
  }

  if (smallGaFunnel?.topSources?.length || smallGaSessions?.topSources?.length) {
    const sourceRows = (smallGaFunnel?.topSources?.length ? smallGaFunnel.topSources : smallGaSessions.topSources).slice(0, 8);
    tables.push(table('Small GA source / medium', ['Kanál', 'Source', 'Medium', 'Kampaň', 'Sessions', 'ATC rate', 'Checkout rate', 'Purchase rate'], sourceRows.map((row) => [
      row.channelBucket,
      row.source,
      row.medium,
      row.campaign,
      formatNumber(row.sessions),
      formatPercent(row.addToCartRatePct ?? row.cartRatePct),
      formatPercent(row.checkoutRatePct ?? row.cartRatePct),
      formatPercent(row.purchaseRatePct),
    ])));
  }

  if (smallGaFunnel?.topLandingPages?.length) {
    tables.push(table('Small GA landing funnel', ['Kanál', 'Typ', 'Landing page', 'Sessions', 'ATC rate', 'Checkout rate', 'Completion', 'Purchase rate'], smallGaFunnel.topLandingPages.slice(0, 8).map((row) => [
      row.channelBucket,
      row.pageType,
      row.landingPage,
      formatNumber(row.sessions),
      formatPercent(row.addToCartRatePct),
      formatPercent(row.checkoutRatePct),
      formatPercent(row.checkoutCompletionPct),
      formatPercent(row.purchaseRatePct),
    ])));
  }

  if (smallGaFunnel?.carts?.available || smallGaFunnel?.purchases?.available) {
    tables.push(table('Small GA commerce signals', ['Vrstva', 'Počet', 'Průměr / míra', 'Poznámka'], [
      smallGaFunnel.carts?.available
        ? ['Košíky', formatNumber(smallGaFunnel.carts.count), formatPercent(smallGaFunnel.carts.abandonedPct), `abandon · recovered ${formatPercent(smallGaFunnel.carts.recoveredPct)}`]
        : ['Košíky', 'nedostupné', '—', smallGaFunnel?.carts?.error || 'RLS nebo tabulka není dostupná'],
      smallGaFunnel.purchases?.available
        ? ['Purchases', formatNumber(smallGaFunnel.purchases.count), formatCurrency(smallGaFunnel.purchases.avgValueCzk), `top platba: ${smallGaFunnel.purchases.topPaymentMethods?.[0]?.method || '—'}`]
        : ['Purchases', 'nedostupné', '—', smallGaFunnel?.purchases?.error || 'RLS nebo tabulka není dostupná'],
    ]));
  }

  if (freshness?.length) {
    tables.push(table('Data freshness', ['Zdroj', 'Stav', 'Poslední známý čas', 'Poznámka'], freshness.map((row) => [
      row.source,
      row.status,
      row.lastSyncAt || 'neznámé',
      row.note,
    ])));
  }
  if (sourceCoverage.length) {
    tables.push(table('Pokrytí zdrojů', ['Zdroj', 'Stav', 'Poznámka'], sourceCoverage.map((row) => [
      row.source,
      row.status,
      row.note,
    ])));
  }

  if (competitorChanges?.length) {
    tables.push(table('Konkurenční pozorování', ['Market', 'Konkurent', 'Pozorování', 'Kdy', 'Jistota'], competitorChanges.slice(0, 8).map((row) => [
      row.market || 'all',
      row.competitor,
      row.title,
      row.observed_at,
      row.confidence || 'medium',
    ])));
  }

  if (safeKnowledge?.contexts?.length || safeKnowledge?.memories?.length) {
    tables.push(table('Použitý týmový kontext a paměť', ['Typ', 'Téma', 'Název', 'Jistota'], [
      ...safeKnowledge.contexts.map((row) => ['Kontext', row.topic || 'bez tématu', row.title, row.confidence || '']),
      ...safeKnowledge.memories.map((row) => ['Paměť', row.topic || row.memory_type || 'bez tématu', row.title, row.confidence || '']),
    ].slice(0, 8)));
  }

  if (safeKnowledge?.openQuestions?.length) {
    tables.push(table('Otevřené otázky k tématu', ['Priorita', 'Téma', 'Otázka'], safeKnowledge.openQuestions.map((row) => [
      row.priority,
      row.topic || '',
      row.title,
    ])));
    nextSteps.push(`Zohlednit otevřenou otázku z knowledge layer: ${safeKnowledge.openQuestions[0].title}`);
  }

  if (safeKnowledge?.examples?.length) {
    tables.push(table('Schválené příklady chování', ['Název', 'Playbooky', 'Must include'], safeKnowledge.examples.map((row) => [
      row.title,
      Array.isArray(row.required_playbooks) ? row.required_playbooks.join(', ') : '',
      Array.isArray(row.must_include) ? row.must_include.slice(0, 3).join(', ') : '',
    ])));
  }

  if (safeKnowledge?.meetingNotes?.length) {
    tables.push(table('Relevantní meeting notes', ['Datum', 'Název', 'Shrnutí'], safeKnowledge.meetingNotes.map((row) => [
      row.meeting_date,
      row.title,
      clampText(row.summary, 140),
    ])));
    nextSteps.push(`Zkontrolovat, jestli meeting note ${safeKnowledge.meetingNotes[0].title} už nemá rozhodnutí, které odpověď zpřesní.`);
  }

  if (safeKnowledge?.experiments?.length) {
    tables.push(table('Související experimenty', ['Název', 'Status', 'Hypotéza'], safeKnowledge.experiments.map((row) => [
      row.title,
      row.status,
      clampText(row.hypothesis, 120),
    ])));
  }

  if (!nextSteps.length) {
    nextSteps.push('Zpřesnit dotaz na konkrétní zemi, období nebo problém; potom použiju užší playbook.');
  }

  let verdict = buildQuestionVerdict({ intent, productFocus, marginSummary, orderSummary, ads });
  let answer = buildConversationalAnswer({
    intent,
    productFocus,
    dateFrom,
    dateTo,
    orderSummary,
    marginSummary,
    ads,
    missingData,
    nextSteps,
  });
  if (importLogisticsIntent) {
    verdict = buildImportLogisticsVerdict(importLogistics, intent);
    answer = buildImportLogisticsAnswer(importLogistics, intent);
  }
  const confidence = missingData.length ? 'střední' : 'vyšší';

  const evidence = {
    dateFrom,
    dateTo,
    market,
    resolvedPeriod: resolvedPeriod || null,
    previousPeriod: comparison ? { dateFrom: comparison.dateFrom, dateTo: comparison.dateTo } : null,
    excludedStatuses: EXCLUDED_STATUSES,
    intent,
    playbook: {
      id: playbook.id,
      title: playbook.title,
      missingRequired: playbook.missingRequired.map((item) => item.tool),
      desirableSignals: playbook.desirableSignals,
    },
    catalog: {
      playbook: catalogSnapshot.playbook,
      sources: catalogSnapshot.sources.map((source) => ({
        id: source.id,
        label: source.label,
        system: source.system,
        freshnessRequirement: source.freshnessRequirement,
        canAnswer: source.canAnswer,
        mutationAllowed: source.mutationAllowed,
      })),
      tools: catalogSnapshot.tools.map((tool) => ({
        id: tool.id,
        label: tool.label,
        sourceId: tool.sourceId,
        sourceLabel: tool.sourceLabel,
        accessMode: tool.accessMode,
        evidenceFields: tool.evidenceFields,
      })),
    },
    knowledge: safeKnowledge ? {
      topic: safeKnowledge.topic,
      contexts: safeKnowledge.contexts.length,
      memories: safeKnowledge.memories.length,
      examples: safeKnowledge.examples.length,
      meetingNotes: safeKnowledge.meetingNotes.length,
      experiments: safeKnowledge.experiments.length,
      openQuestions: safeKnowledge.openQuestions.length,
      dataQualityIssues: safeKnowledge.dataQualityIssues.length,
    } : null,
    importLogistics: importLogistics ? {
      source: importLogistics.source,
      checkedAt: importLogistics.coverage?.checkedAt || null,
      views: importLogistics.coverage?.views || [],
      orderCount: importLogistics.coverage?.orderCount || 0,
      orderNames: importLogistics.coverage?.orderNames || [],
      missingPriceLines: importLogistics.coverage?.missingPriceLines || 0,
      missingFreightOrders: importLogistics.coverage?.missingFreightOrders || 0,
      matchGapCount: importLogistics.coverage?.matchGapCount || 0,
      china13QtyUnknown: importLogistics.coverage?.china13QtyUnknown || 0,
      velocityWindows: IMPORT_LOGISTICS_VELOCITY_WINDOWS,
      monthlyGrowth: IMPORT_LOGISTICS_GROWTH_MONTHLY,
      businessCleanOrders: true,
      warnings: importLogistics.warnings || [],
    } : null,
    toolCalls,
    warnings,
    note: 'Toto je tool-first Pokec. Odpověď je složená z read-only datových nástrojů a týmového kontextu; LLM interpretační vrstva bude další krok.',
  };

  return {
    mode: 'tool_first_mvp',
    responseMode,
    detailLevel: detailRequested ? 'full' : 'compact',
    question,
    verdict,
    answer,
    confidence,
    facts,
    hypotheses,
    missingData,
    nextSteps,
    tables,
    briefing: intent === 'daily_briefing'
      ? buildBriefing({
          dateFrom,
          dateTo,
          market,
          orderSummary,
          marginSummary,
          ads,
          comparison,
          topProducts,
          playbook,
          missingData,
          nextSteps,
        })
      : null,
    memoryCandidate: buildMemoryCandidate({ question, dateFrom, dateTo, market, intent, facts, hypotheses, missingData, nextSteps, evidence }),
    evidence,
  };
}

async function handle(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Použijte POST.' });

  const auth = await authenticate(req);
  if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message });
  const readSupabase = auth.readSupabase || auth.supabase;
  const writeSupabase = auth.writeSupabase || auth.supabase;

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  if (body.action === 'save_memory_candidate') {
    const result = await saveMemoryCandidate({ supabase: writeSupabase, user: auth.user, body });
    return res.status(result.status).json(result.payload);
  }
  if (body.action === 'save_example_candidate') {
    const result = await saveExampleCandidate({ supabase: writeSupabase, user: auth.user, body });
    return res.status(result.status).json(result.payload);
  }

  const responseMode = body.action === 'daily_briefing' ? 'daily_briefing' : 'question';
  const question = responseMode === 'daily_briefing'
    ? buildDailyBriefingQuestion(String(body.dateFrom || '').slice(0, 10), String(body.dateTo || '').slice(0, 10), String(body.market || 'all').toLowerCase())
    : String(body.question || '').trim();
  const requestedDateFrom = String(body.dateFrom || '').slice(0, 10);
  const requestedDateTo = String(body.dateTo || '').slice(0, 10);
  const market = String(body.market || 'all').toLowerCase();
  const inferredRange = responseMode === 'question' ? inferRelativeDateRange(question) : null;
  const dateFrom = (inferredRange?.dateFrom || requestedDateFrom || '').slice(0, 10);
  const dateTo = (inferredRange?.dateTo || requestedDateTo || '').slice(0, 10);
  const resolvedPeriod = inferredRange || ((requestedDateFrom && requestedDateTo)
    ? { dateFrom: requestedDateFrom, dateTo: requestedDateTo, source: 'request_filter', label: 'explicitní filtr' }
    : null);

  if (!question) return res.status(400).json({ error: 'Chybí otázka.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return res.status(400).json({ error: 'Chybí platné období dateFrom/dateTo.' });
  }
  if (!SUPPORTED_MARKETS.includes(market)) {
    return res.status(400).json({ error: `Nepodporovaný market: ${market}` });
  }

  const intent = responseMode === 'daily_briefing' ? 'daily_briefing' : detectIntent(question);
  const toolCalls = [];
  const warnings = [];

  try {
    const orders = await getOrders({ supabase: readSupabase, dateFrom, dateTo, market });
    toolCalls.push({ tool: 'get_orders_summary', status: 'ok', rows: orders.length });

    const orderSummary = summarizeOrders(orders);
    const marginSummary = summarizeMargin(orders);
    const products = summarizeProducts(orders);
    const bundlesByDay = summarizeBundlesByDay(orders);
    const shippingByDay = summarizeShippingRevenue(orders, 'date');
    const missingBuyPrices = summarizeMissingBuyPrices(products);
    toolCalls.push({ tool: 'get_margin_breakdown', status: 'ok', exactOrders: marginSummary.total.exactOrders, missingCostOrders: marginSummary.total.missingCostOrders });
    toolCalls.push({ tool: 'get_product_mix', status: 'ok', rows: products.length });
    toolCalls.push({ tool: 'get_bundle_analysis', status: 'ok', rows: bundlesByDay.length });
    toolCalls.push({ tool: 'get_shipping_revenue', status: 'ok', rows: shippingByDay.length });
    toolCalls.push({ tool: 'get_missing_buy_prices', status: 'ok', rows: missingBuyPrices.length });

    let purchaseRows = [];
    if (intent === 'product_lookup') {
      try {
        purchaseRows = await getPurchasePriceRows({ supabase: readSupabase });
        toolCalls.push({ tool: 'get_upgates_purchase_prices', status: 'ok', rows: purchaseRows.length });
      } catch (error) {
        warnings.push(`UpGates nákupky se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
        toolCalls.push({ tool: 'get_upgates_purchase_prices', status: 'error', message: error.message || 'neznámá chyba' });
      }
    }

    const periodDays = daysInclusive(dateFrom, dateTo);
    let comparison = null;
    if (isImportLogisticsIntent(intent)) {
      toolCalls.push({ tool: 'compare_periods', status: 'skipped', message: 'not_required_for_import_logistics' });
    } else if (periodDays <= 62) {
      try {
        const previous = previousPeriod(dateFrom, dateTo);
        const previousOrders = await getOrders({ supabase: readSupabase, dateFrom: previous.dateFrom, dateTo: previous.dateTo, market });
        const previousProducts = summarizeProducts(previousOrders);
        comparison = {
          ...previous,
          orderSummary: summarizeOrders(previousOrders),
          marginSummary: summarizeMargin(previousOrders),
          productChanges: compareProductMix(products, previousProducts),
        };
        toolCalls.push({ tool: 'compare_periods', status: 'ok', rows: previousOrders.length });
      } catch (error) {
        warnings.push(`Srovnání s předchozím obdobím se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
        toolCalls.push({ tool: 'compare_periods', status: 'error', message: error.message || 'neznámá chyba' });
      }
    } else {
      warnings.push(`Automatické srovnání vynecháno: období má ${periodDays} dní, limit pro endpoint je 62 dní.`);
      toolCalls.push({ tool: 'compare_periods', status: 'skipped', message: 'period_too_long' });
    }

    const knowledge = await getKnowledgeContext({ supabase: readSupabase, intent, market, question });
    warnings.push(...knowledge.warnings);
    toolCalls.push(...knowledge.toolCalls);

    let freshness = null;
    try {
      freshness = await getDataFreshness({ supabase: readSupabase, market });
      toolCalls.push({ tool: 'get_data_freshness', status: 'ok', rows: freshness.length });
    } catch (error) {
      warnings.push(`Data freshness se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
      toolCalls.push({ tool: 'get_data_freshness', status: 'error', message: error.message || 'neznámá chyba' });
    }

    let importLogistics = null;
    if (isImportLogisticsIntent(intent)) {
      importLogistics = await getImportLogisticsBundle({ supabase: readSupabase, question, market, intent });
      warnings.push(...importLogistics.warnings);
      toolCalls.push(...importLogistics.toolCalls);
    }

    let ads = null;
    let adsCampaigns = null;
    if (!isImportLogisticsIntent(intent)) {
      try {
        ads = await getAdsSpend({ supabase: readSupabase, dateFrom, dateTo, market });
        toolCalls.push({ tool: 'get_ads_spend', status: 'ok', rows: ads.rows.length });
        try {
          adsCampaigns = await getAdsCampaigns({ supabase: readSupabase, dateFrom, dateTo, market });
          toolCalls.push({ tool: 'get_ads_campaigns', status: 'ok', rows: adsCampaigns.length });
        } catch (error) {
          warnings.push(`Ads kampaně se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
          toolCalls.push({ tool: 'get_ads_campaigns', status: 'error', message: error.message || 'neznámá chyba' });
        }
        if (comparison) {
          try {
            const previousAds = await getAdsSpend({ supabase: readSupabase, dateFrom: comparison.dateFrom, dateTo: comparison.dateTo, market });
            comparison.adsCampaignMix = previousAds.campaignMix;
          } catch (error) {
            warnings.push(`Ads campaign mix pro předchozí období se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
          }
        }
      } catch (error) {
        warnings.push(`Ads spend se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
        toolCalls.push({ tool: 'get_ads_spend', status: 'error', message: error.message || 'neznámá chyba' });
      }
    }

    let metaCampaigns = null;
    let metaSpend = null;
    if (['daily_briefing', 'high_pno', 'campaign_performance', 'missing_data'].includes(intent)) {
      try {
        metaSpend = await getMetaSpend({ supabase: readSupabase, dateFrom, dateTo, market });
        toolCalls.push({ tool: 'get_meta_spend', status: 'ok', rows: metaSpend.rows.length });
      } catch (error) {
        warnings.push(`Meta spend se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
        toolCalls.push({ tool: 'get_meta_spend', status: 'error', message: error.message || 'neznámá chyba' });
      }
    }

    if (['daily_briefing', 'high_pno', 'campaign_performance', 'missing_data'].includes(intent)) {
      try {
        metaCampaigns = await getMetaCampaigns({ supabase: readSupabase, dateFrom, dateTo, market });
        toolCalls.push({ tool: 'get_meta_campaigns', status: 'ok', rows: metaCampaigns.length });
      } catch (error) {
        warnings.push(`Meta kampaně se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
        toolCalls.push({ tool: 'get_meta_campaigns', status: 'error', message: error.message || 'neznámá chyba' });
      }
    }

    let landingPages = null;
    if (['daily_briefing', 'aov_drop', 'landing_page_problem', 'high_pno'].includes(intent)) {
      try {
        landingPages = await getLandingPages({ supabase: readSupabase, dateFrom, dateTo, market });
        toolCalls.push({ tool: 'get_ads_landing_pages', status: 'ok', rows: landingPages.length });
      } catch (error) {
        warnings.push(`Ads landing pages se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
        toolCalls.push({ tool: 'get_ads_landing_pages', status: 'error', message: error.message || 'neznámá chyba' });
      }
    }

    let adsSearchTerms = null;
    let adsShoppingProducts = null;
    if (['high_pno', 'campaign_mix_change', 'campaign_performance', 'missing_data'].includes(intent)) {
      try {
        adsSearchTerms = await getAdsSearchTerms({ supabase: readSupabase, dateFrom, dateTo, market });
        toolCalls.push({ tool: 'get_ads_search_terms', status: 'ok', rows: adsSearchTerms.rows.length });
      } catch (error) {
        warnings.push(`Ads search terms se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
        toolCalls.push({ tool: 'get_ads_search_terms', status: 'error', message: error.message || 'neznámá chyba' });
      }

      try {
        adsShoppingProducts = await getAdsShoppingProducts({ supabase: readSupabase, dateFrom, dateTo, market });
        toolCalls.push({ tool: 'get_ads_shopping_products', status: 'ok', rows: adsShoppingProducts.rows.length });
      } catch (error) {
        warnings.push(`Ads shopping produkty se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
        toolCalls.push({ tool: 'get_ads_shopping_products', status: 'error', message: error.message || 'neznámá chyba' });
      }
    }

    let competitorChanges = null;
    if (intent === 'competitor_change') {
      try {
        competitorChanges = await getCompetitorChanges({ supabase: readSupabase, market, question });
        toolCalls.push({ tool: 'get_competitor_changes', status: 'ok', rows: competitorChanges.length });
      } catch (error) {
        warnings.push(`Konkurenční pozorování se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
        toolCalls.push({ tool: 'get_competitor_changes', status: 'error', message: error.message || 'neznámá chyba' });
      }
    }

    let smallGaLandingPages = null;
    let smallGaSessions = null;
    let smallGaFunnel = null;
    const smallGaBudget = smallGaRuntimeBudget(intent, dateFrom, dateTo);
    const needsStandaloneSmallGaLandingPages = ['daily_briefing', 'aov_drop', 'landing_page_problem', 'storefront_walkthrough', 'order_drop_intraday'].includes(intent);
    const needsStandaloneSmallGaSessions = ['daily_briefing', 'aov_drop', 'landing_page_problem', 'order_drop_intraday'].includes(intent);
    if (['daily_briefing', 'aov_drop', 'landing_page_problem', 'order_drop_intraday', 'high_pno', 'campaign_mix_change', 'campaign_performance'].includes(intent)) {
      if (needsStandaloneSmallGaLandingPages) {
        try {
          smallGaLandingPages = await getSmallGaLandingPages({
            supabase: readSupabase,
            dateFrom,
            dateTo,
            market,
            currentEventLimit: smallGaBudget.landingCurrentEventLimit,
            previousEventLimit: smallGaBudget.landingPreviousEventLimit,
          });
          toolCalls.push({ tool: 'get_small_ga_landing_pages', status: 'ok', rows: smallGaLandingPages.length });
        } catch (error) {
          warnings.push(`Small GA landing pages se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
          toolCalls.push({ tool: 'get_small_ga_landing_pages', status: 'error', message: error.message || 'neznámá chyba' });
        }
      }

      if (needsStandaloneSmallGaSessions) {
        try {
          smallGaSessions = await getSmallGaSessions({
            supabase: readSupabase,
            dateFrom,
            dateTo,
            market,
            sessionLimit: smallGaBudget.sessionLimit,
            eventLimit: smallGaBudget.eventLimit,
          });
          toolCalls.push({ tool: 'get_small_ga_sessions', status: 'ok', rows: smallGaSessions.topSources.length });
        } catch (error) {
          warnings.push(`Small GA sessions se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
          toolCalls.push({ tool: 'get_small_ga_sessions', status: 'error', message: error.message || 'neznámá chyba' });
        }
      }

      if (['daily_briefing', 'order_drop_intraday', 'high_pno', 'campaign_mix_change', 'campaign_performance'].includes(intent)) {
        try {
          smallGaFunnel = await getSmallGaFunnel({
            supabase: readSupabase,
            dateFrom,
            dateTo,
            market,
            includeLandingPages: intent !== 'campaign_performance',
            includeCommerceTables: intent !== 'campaign_performance',
            sessionLimit: smallGaBudget.sessionLimit,
            eventLimit: smallGaBudget.eventLimit,
          });
          toolCalls.push({ tool: 'get_small_ga_funnel', status: 'ok', rows: smallGaFunnel.topSources.length });
        } catch (error) {
          warnings.push(`Small GA funnel / commerce se nepodařilo načíst: ${error.message || 'neznámá chyba'}`);
          toolCalls.push({ tool: 'get_small_ga_funnel', status: 'error', message: error.message || 'neznámá chyba' });
        }
      }
    }

    const toolFirstResponse = buildResponse({
      question,
      dateFrom,
      dateTo,
      market,
      intent,
      resolvedPeriod,
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
      knowledge,
      importLogistics,
      purchaseRows,
      toolCalls,
      warnings,
      responseMode,
    });

    try {
      const aiResult = await runAiInterpretation({ toolFirstResponse, user: auth.user });
      return res.status(200).json(mergeAiInterpretation(toolFirstResponse, aiResult));
    } catch (error) {
      const aiWarning = `LLM interpretace selhala: ${error.message || 'neznámá chyba'}; vracím tool-first odpověď.`;
      return res.status(200).json(mergeAiInterpretation(toolFirstResponse, { interpretation: null, warning: aiWarning }));
    }
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Pokec analýza selhala.',
      evidence: { dateFrom, dateTo, market, intent, toolCalls, warnings },
    });
  }
}

export const __pokecTestKit = {
  EXCLUDED_STATUSES,
  MARKET_LABELS,
  buildDailyBriefingQuestion,
  buildResponse,
  compareProductMix,
  dateKey,
  daysInclusive,
  detectIntent,
  getSmallGaFunnel,
  getSmallGaLandingPages,
  getSmallGaSessions,
  isImportLogisticsIntent,
  inferRelativeDateRange,
  orderMargin,
  orderRevenue,
  orderShipping,
  previousPeriod,
  summarizeBundlesByDay,
  summarizeMargin,
  summarizeOrders,
  summarizeProducts,
};

export default handle;
