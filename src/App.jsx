import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { getCurrencyRateToCzk } from './currencyRates';
import AdsModule from './AdsModule';
import FinanceModule from './FinanceModule';
import ImportLogisticsModule from './ImportLogisticsModule';
import MarginModule from './MarginModule';
import PokecModule from './PokecModule';
import ProductsModule from './ProductsModule';
import { isExcludedBusinessOrder } from './businessOrderStatus';
import { attachPurchasePriceLookup, buildPurchasePriceLookup } from './orderLineItems';
import { MODULE_IDS, getUserAccess } from './userPermissions';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

const SUPABASE_URL = 'https://oonnawrfsbsbuijmfcqj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vbm5hd3Jmc2JzYnVpam1mY3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMjA4ODcsImV4cCI6MjA4NTg5Njg4N30.d1jk1BYOc6eEx-KJzGpW3ekfDs4jxW10VgKmLef8f1Y';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const OVERVIEW_TAB_ID = 'overview';

const APP_TABS = [
  { id: OVERVIEW_TAB_ID, l: 'Orders overview', icon: 'home', group: 'main', sub: 'Souhrn dne — objednávky, marže, reklamy.' },
  { id: MODULE_IDS.ADS, l: 'Reklamy', icon: 'trend', group: 'main', sub: 'PNO, ROAS, spend napříč platformami.' },
  { id: MODULE_IDS.PRODUCTS, l: 'Produkty', icon: 'bag', group: 'main', sub: 'Prodej, marže a sklad podle SKU.' },
  { id: MODULE_IDS.IMPORT_LOGISTICS, l: 'Importní logistika', icon: 'ship', group: 'main', sub: 'Co je na cestě, ETA, dokumenty.' },
  { id: MODULE_IDS.FINANCE, l: 'Finance', icon: 'wallet', group: 'main', sub: 'Cash flow, kategorie, sync s bankou.' },
  { id: MODULE_IDS.POKEC, l: 'Pokec', icon: 'chat', group: 'main', sub: 'AI asistent nad business daty.' },
  { id: MODULE_IDS.HEATMAP, l: 'Časová analýza', icon: 'calendar', group: 'orders', sub: 'Den × hodina, tempo, vývoj.' },
  { id: MODULE_IDS.MARGIN, l: 'Marže', icon: 'percent', group: 'orders', sub: 'Hrubý zisk, coverage, chybějící nákupky.' },
  { id: MODULE_IDS.TEMPO, l: 'Tempo dne', icon: 'pulse', group: 'orders', sub: 'Aktuální tempo proti vzoru.' },
  { id: MODULE_IDS.GEO, l: 'Geografie', icon: 'globe', group: 'orders', sub: 'Země, regiony, města.' },
  { id: MODULE_IDS.B2B, l: 'B2B / B2C', icon: 'users', group: 'orders', sub: 'Mix zákazníků, AOV, vývoj.' },
];

const NAV_GROUPS = [
  { id: 'main', label: 'Přehled' },
  { id: 'orders', label: 'Objednávky' },
];

const IconPath = ({ type }) => {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.8',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: 'rm-ico',
    'aria-hidden': 'true',
  };
  const paths = {
    home: <><path d="M4 10.5 12 4l8 6.5" /><path d="M6.5 10.5V20h11v-9.5" /></>,
    trend: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
    bag: <><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></>,
    ship: <><path d="M3 18h18l-1.5 3H4.5L3 18Z" /><path d="M5 14V8l7-4 7 4v6" /><path d="M9 8h6M9 11h6" /></>,
    wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 12.5h3" /><path d="M3 9h18" /></>,
    chat: <path d="M21 12c0 4-4 7-9 7-1.4 0-2.7-.2-3.9-.6L3 20l1-3.5C3.3 15.2 3 13.6 3 12c0-4 4-7 9-7s9 3 9 7Z" />,
    calendar: <><path d="M7 3v4M17 3v4" /><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 10h16" /></>,
    percent: <><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="17" r="2.5" /><path d="M19 5 5 19" /></>,
    pulse: <path d="M3 12h4l2-6 4 12 2-6h6" />,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    users: <><circle cx="9" cy="9" r="3" /><circle cx="17" cy="11" r="2.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M14 17c.6-2 2.4-3.5 4.5-3.5s4 1.5 4.5 3.5" /></>,
    menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
    refresh: <><path d="M21 12a9 9 0 0 1-15 6.7" /><path d="M3 12A9 9 0 0 1 18 5.3" /><path d="M18 2v4h-4" /><path d="M6 22v-4h4" /></>,
    logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 3v18" /></>,
    x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  };
  return <svg {...common}>{paths[type] || paths.home}</svg>;
};

class ModuleErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error(`${this.props.label || 'Modul'} spadl`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-semibold">{this.props.label || 'Modul'} se nepodařilo vykreslit.</div>
          <div className="mt-1 text-xs">{this.state.error?.message || 'Neznámá chyba'}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

const getSupabaseStorageKey = () => {
  try {
    const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
    return `sb-${projectRef}-auth-token`;
  } catch {
    return '';
  }
};

const getStoredSupabaseSession = () => {
  if (typeof window === 'undefined') return null;
  try {
    const storageKey = getSupabaseStorageKey();
    if (!storageKey) return null;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const session = parsed?.currentSession || parsed?.session || parsed;
    if (!session?.user) return null;
    if (session.expires_at && session.expires_at * 1000 <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
};

const getStoredSupabaseUser = () => getStoredSupabaseSession()?.user || null;

const getInitialAppTab = (email) => {
  const access = getUserAccess(email);
  if (access.isLogisticsOnly) return MODULE_IDS.IMPORT_LOGISTICS;
  if (access.canFetchDashboardOrders) return OVERVIEW_TAB_ID;
  return access.defaultTab;
};

const ORDERS_CACHE_PREFIX = 'rm-orders-cache-v1';

const ordersCacheKey = (dateFrom, dateTo) => `${ORDERS_CACHE_PREFIX}:${dateFrom}:${dateTo}`;

const getCachedOrders = (dateFrom, dateTo) => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ordersCacheKey(dateFrom, dateTo));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.orders)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const storeCachedOrders = (dateFrom, dateTo, orders) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ordersCacheKey(dateFrom, dateTo), JSON.stringify({
      cachedAt: new Date().toISOString(),
      orders,
    }));
  } catch {
    // Cache is best-effort; dashboard data must not fail because storage is full.
  }
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchPurchasePriceLookup() {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('upgates_product_purchase_prices_current')
      .select('product_code,currency,purchase_price_without_vat_native')
      .not('purchase_price_without_vat_native', 'is', null)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const chunk = Array.isArray(data) ? data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  return buildPurchasePriceLookup(rows);
}

const LOADING_MESSAGES = [
  "🔧 Stavím regál...",
  "📦 Skládám police...",
  "🏗️ Montuji nosníky...",
  "📐 Měřím rozteče...",
  "🔩 Šroubuju šrouby...",
  "🇨🇳 Nakupuji v Číně...",
  "📞 Volám dodavateli...",
  "💰 Počítám marži...",
  "🚚 Čekám na DPD...",
  "📊 Analyzuji data...",
  "☕ Dávám si kafe...",
  "🚀 Stavím impérium...",
  "🧮 Učím se počítat...",
  "🤔 Přemýšlím...",
  "💪 Makám na tom...",
  "🎯 Míříme na měsíc...",
  "🔮 Věštím z dat...",
  "🏋️ Zvedám těžká data...",
  "🧹 Uklízím sklad...",
  "🎪 Cirkus začíná...",
  "📈 Rosteme!",
  "🌟 Děláme zázraky...",
  "🏆 Jdeme na to...",
  "⚡ Nabíjím energii...",
  "✨ Zázraky na počkání...",
  "🤯 Snažím se rozumět Michalovi...",
];

const DAYS = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
const DAYS_FULL = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MARKET_LABELS = { all: 'Všechny země', cz: 'Česko', sk: 'Slovensko', hu: 'Maďarsko', ro: 'Rumunsko', unknown: 'Neznámá země' };
const MARKET_ORDER = ['cz', 'sk', 'hu', 'ro', 'unknown'];

const BIG_CITIES = {
  cz: ['praha', 'brno', 'ostrava', 'plzeň', 'plzen', 'liberec', 'olomouc', 'budějovic', 'budejovic', 'hradec králové', 'hradec', 'ústí nad labem', 'usti', 'pardubice', 'zlín', 'zlin', 'havířov', 'havirov', 'kladno', 'most', 'opava', 'frýdek', 'frydek', 'karviná', 'karvina', 'jihlava', 'teplice', 'děčín', 'decin', 'karlovy vary'],
  sk: ['bratislava', 'košice', 'kosice', 'prešov', 'presov', 'žilina', 'zilina', 'nitra', 'banská bystrica', 'bystrica', 'trnava', 'martin', 'trenčín', 'trencin', 'poprad'],
  hu: ['budapest', 'debrecen', 'szeged', 'miskolc', 'pécs', 'pecs', 'győr', 'gyor', 'nyíregyháza', 'nyiregyhaza', 'kecskemét', 'kecskemet', 'székesfehérvár', 'szekesfehervar'],
  ro: ['bucharest', 'bucuresti', 'cluj', 'timisoara', 'iasi', 'constanta', 'brasov', 'craiova', 'galati', 'ploiesti', 'oradea', 'sibiu', 'arad', 'pitesti', 'bacau', 'braila', 'targu mures', 'baia mare', 'botosani', 'suceava'],
};

const CITY_AGGREGATION = {
  'Praha': /^praha\s*\d*/i,
  'Brno': /^brno\s*[-–]\s*/i,
  'Ostrava': /^ostrava\s*[-–]\s*/i,
  'Budapest': /^budapest\s*/i,
  'Bratislava': /^bratislava\s*/i,
  'Košice': /^košice\s*/i,
};

const normalizeCity = (city) => (city || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const aggregateCity = (city) => {
  const normalized = (city || '').trim();
  for (const [mainCity, pattern] of Object.entries(CITY_AGGREGATION)) {
    if (pattern.test(normalized)) {
      return mainCity;
    }
  }
  return normalized || 'Neznámé';
};

const isBigCity = (city, market) => {
  const normalized = normalizeCity(city);
  return (BIG_CITIES[market] || []).some(bc => normalized.includes(bc));
};

const isB2B = (order) => order.raw_data?.customer?.company_yn === true || order.raw_data?.customer?.company_yn === 'true';
const toNumber = (value) => {
  const n = Number(String(value ?? 0).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const getOrderCurrency = (order) => order.currency || order.raw_data?.currency_id || order.raw_data?.currency?.code || order.raw_data?.currency || 'CZK';
const getOrderRate = (order) => getCurrencyRateToCzk(getOrderCurrency(order));

// Výpočet obratu BEZ DPH a BEZ poštovného
const getRevenueWithoutVAT = (order) => {
  const products = order.raw_data?.products || [];
  let total = 0;
  products.forEach(p => {
    // price_without_vat je už celková cena za řádek (price_per_unit_without_vat × quantity)
    total += toNumber(p.price_without_vat);
  });
  return total * getOrderRate(order);
};

const getShippingRevenueWithoutVAT = (order) => {
  const shipment = order.raw_data?.shipment || {};
  return toNumber(shipment.price_without_vat) * getOrderRate(order);
};

// Deduplikace objednávek (ochrana proti duplicitním záznamům ze syncu)
const deduplicateOrders = (orders) => {
  const seen = new Set();
  return orders.filter(o => {
    const key = o.raw_data?.order_number || o.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Filtr stornovaných objednávek (kontroluje status na top-level i v raw_data)
const filterCancelled = (orders) => {
  return orders.filter((order) => !isExcludedBusinessOrder(order));
};

const formatNumber = (num) => Math.round(num).toLocaleString('cs-CZ');
const formatCurrency = (num) => `${formatNumber(num)} Kč`;
const formatPercent = (num) => `${num.toFixed(1)} %`;
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const formatHourValue = (hour) => {
  if (hour == null || Number.isNaN(hour)) return '—';
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};
const getH50CellClass = (hour) => {
  if (hour == null) return 'bg-slate-50 text-slate-400 border-slate-200';
  if (hour <= 9) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (hour <= 11) return 'bg-lime-50 text-lime-700 border-lime-200';
  if (hour <= 13) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (hour <= 15) return 'bg-orange-50 text-orange-700 border-orange-200';
  return 'bg-rose-50 text-rose-700 border-rose-200';
};
const formatDateForInput = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const parseDateFromInput = (value) => {
  const [year, month, day] = (value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};
const formatShortDateLabel = (value) => {
  const date = parseDateFromInput(value);
  if (!date) return '—';
  return date.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit' });
};
const formatAxisCurrency = (num) => {
  if (Math.abs(num) >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (Math.abs(num) >= 1000) return `${Math.round(num / 1000)}k`;
  return `${Math.round(num)}`;
};

const getColorIntensity = (value, max) => {
  if (!max || !value) return 'bg-slate-100';
  const i = Math.min(value / max, 1);
  return i < 0.2 ? 'bg-blue-100' : i < 0.4 ? 'bg-blue-200' : i < 0.6 ? 'bg-blue-300' : i < 0.8 ? 'bg-blue-400' : 'bg-blue-500';
};

const getDatePreset = (preset) => {
  const today = new Date();
  const formatDate = (d) => formatDateForInput(d);
  
  switch (preset) {
    case 'today':
      return { from: formatDate(today), to: formatDate(today) };
    case 'yesterday':
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { from: formatDate(yesterday), to: formatDate(yesterday) };
    case 'this_week':
      const weekStart = new Date(today);
      const dayOfWeek = today.getDay() || 7; // Sunday (0) → 7 for Monday-based weeks
      weekStart.setDate(today.getDate() - dayOfWeek + 1);
      return { from: formatDate(weekStart), to: formatDate(today) };
    case 'last_week':
      const lastWeekEnd = new Date(today);
      const currentDay = today.getDay() || 7;
      lastWeekEnd.setDate(today.getDate() - currentDay);
      const lastWeekStart = new Date(lastWeekEnd);
      lastWeekStart.setDate(lastWeekEnd.getDate() - 6);
      return { from: formatDate(lastWeekStart), to: formatDate(lastWeekEnd) };
    case 'this_month':
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: formatDate(monthStart), to: formatDate(today) };
    case 'last_month':
      const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: formatDate(lastMonthStart), to: formatDate(lastMonthEnd) };
    case 'last_30':
      const thirtyAgo = new Date(today);
      thirtyAgo.setDate(today.getDate() - 30);
      return { from: formatDate(thirtyAgo), to: formatDate(today) };
    case 'last_90':
      const ninetyAgo = new Date(today);
      ninetyAgo.setDate(today.getDate() - 90);
      return { from: formatDate(ninetyAgo), to: formatDate(today) };
    case 'this_year':
      return { from: formatDate(new Date(today.getFullYear(), 0, 1)), to: formatDate(today) };
    case 'all':
      return { from: '2025-11-01', to: formatDate(today) };
    default:
      return null;
  }
};

const kpiSubToneClass = {
  muted: '',
  red: 'rm-kpi-sub--red',
  amber: 'rm-kpi-sub--amber',
  blue: 'rm-kpi-sub--blue',
};

const KPICard = ({ title, value, icon, sub, subTone = 'muted' }) => (
  <div className="rm-kpi">
    <div className="rm-kpi-label">{title}</div>
    <div className="rm-kpi-value">{value}</div>
    {sub && <div className={`rm-kpi-sub ${kpiSubToneClass[subTone] || kpiSubToneClass.muted}`}>{sub}</div>}
  </div>
);

const emptyAdsSummary = () => ({
  loading: true,
  error: '',
  rows: 0,
  spend: 0,
  clicks: 0,
  conversions: 0,
  conversionValue: 0,
  providers: [],
  markets: [],
  marketBreakdown: [],
  providerBreakdown: [],
  firstDate: '',
  lastDate: '',
  syncFreshness: [],
  warnings: [],
});

const providerLabelShort = (provider) => {
  if (provider === 'google_ads') return 'Google';
  if (provider === 'meta_ads') return 'Meta';
  return provider || 'Neznámý';
};

const adsSourceLabel = (providers = []) => {
  if (!providers.length) return 'Bez Ads dat';
  if (providers.includes('google_ads') && providers.includes('meta_ads')) return 'Google + Meta';
  if (providers.includes('google_ads')) return 'Google Ads';
  if (providers.includes('meta_ads')) return 'Meta Ads';
  return providers.map(providerLabelShort).join(' + ');
};

const adsFreshnessStatusLabel = (status) => {
  if (status === 'ok') return 'čerstvé';
  if (status === 'warn') return 'stará data';
  if (status === 'fail') return 'problém';
  return status || 'neznámé';
};

const formatAdsFreshnessTime = (value) => {
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatAdsFreshnessMeta = (row) => {
  const parts = [];
  const time = formatAdsFreshnessTime(row?.lastSuccessAt);
  if (time) parts.push(time);
  if (Number.isFinite(Number(row?.lastSuccessAgeMinutes))) {
    parts.push(`${Math.round(Number(row.lastSuccessAgeMinutes))} min`);
  }
  if (row?.lastSuccessRangeFrom && row?.lastSuccessRangeTo) {
    parts.push(`${row.lastSuccessRangeFrom} až ${row.lastSuccessRangeTo}`);
  }
  return parts.join(' · ');
};

const AdsKpiStrip = ({ summary, revenue, revenueByMarket = {}, onOpenAds }) => {
  const pno = revenue ? (summary.spend / revenue) * 100 : 0;
  const realRoas = summary.spend ? revenue / summary.spend : 0;
  const platformRoas = summary.spend ? summary.conversionValue / summary.spend : 0;
  const hasData = summary.rows > 0 || summary.spend > 0;
  const providerRows = summary.providerBreakdown?.length
    ? summary.providerBreakdown
    : summary.providers.map((provider) => ({ provider, spend: 0, clicks: 0, rowCount: 0, sharePct: 0 }));
  const freshnessRows = Array.isArray(summary.syncFreshness) ? summary.syncFreshness : [];
  const freshnessWarnings = Array.isArray(summary.warnings) ? summary.warnings : [];

  return (
    <section>
      <div className="rm-section-head">
        <div className="rm-section-title">Reklamy ve vybraném období</div>
        <div className="rm-section-sub">
          {summary.loading
            ? 'Načítám Ads spend ze Supabase…'
            : summary.error
              ? summary.error
              : hasData
                ? `${summary.firstDate || 'bez data'} až ${summary.lastDate || 'bez data'} · ${adsSourceLabel(summary.providers)}`
                : 'Pro filtr zatím nejsou campaign Ads data.'}
        </div>
      </div>
      <div className="rm-ads-panel">
        <div className="rm-ads-head">
          <div>
            <div className="rm-ads-label">Spend</div>
            <div className="rm-ads-value rm-ads-value--neg">{summary.loading ? '…' : summary.error ? '—' : formatCurrency(summary.spend)}</div>
            <div className="rm-ads-sub">{summary.loading ? 'Načítám…' : `${formatNumber(summary.rows)} denních řádků`}</div>
          </div>
          <div>
            <div className="rm-ads-label">PNO</div>
            <div className="rm-ads-value rm-ads-value--warn">{summary.loading ? '…' : summary.error ? '—' : formatPercent(pno)}</div>
            <div className="rm-ads-sub">Spend / obrat (bez DPH)</div>
          </div>
          <div>
            <div className="rm-ads-label">Real ROAS</div>
            <div className="rm-ads-value">{summary.loading ? '…' : summary.error ? '—' : realRoas.toFixed(2).replace('.', ',')}</div>
            <div className="rm-ads-sub">Obrat / spend</div>
          </div>
          <div>
            <div className="rm-ads-label">Platform ROAS</div>
            <div className="rm-ads-value rm-ads-value--warn">{summary.loading ? '…' : summary.error ? '—' : platformRoas.toFixed(2).replace('.', ',')}</div>
            <div className="rm-ads-sub">Hlášené platformami</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="rm-ads-sub">Pokrytí</div>
            <div style={{ marginTop: 2, color: 'var(--rm-text-1)', fontSize: 12 }}>{summary.loading ? '…' : summary.error ? 'Souhrn nedostupný' : adsSourceLabel(summary.providers)}</div>
            <button type="button" onClick={onOpenAds} className="rm-btn rm-btn--ghost" style={{ marginTop: 6, height: 24, padding: '0 4px', color: 'var(--rm-accent)' }}>
              Otevřít Reklamy →
            </button>
          </div>
        </div>

        {!summary.loading && !summary.error && freshnessRows.length > 0 && (
          <div className="rm-ads-freshness">
            {freshnessRows.map((row) => (
              <div key={row.provider} className={`rm-ads-freshness-pill rm-ads-freshness-pill--${row.status || 'unknown'}`}>
                <span>{providerLabelShort(row.provider)}: {adsFreshnessStatusLabel(row.status)}</span>
                <small>{formatAdsFreshnessMeta(row) || row.message}</small>
              </div>
            ))}
          </div>
        )}

        {!summary.loading && !summary.error && freshnessWarnings.length > 0 && (
          <div className="rm-ads-inline-warning">
            {freshnessWarnings.join(' ')}
          </div>
        )}

        {providerRows.length > 0 && (
          <div className="rm-ads-section">
            <div className="rm-ads-section-title">Rozpad podle platformy</div>
            <div className="rm-ads-platforms">
              {providerRows.map((row) => {
                const isMeta = row.provider === 'meta_ads';
                return (
                  <div key={row.provider} className="rm-ads-platform">
                    <div className="rm-ads-platform-head">
                      <div className="rm-ads-platform-name">
                        <span className={`rm-ads-platform-logo ${isMeta ? 'rm-ads-platform-logo--meta' : ''}`}>{isMeta ? 'M' : 'G'}</span>
                        {providerLabelShort(row.provider)}
                      </div>
                      <span className="rm-ads-platform-rows">{formatNumber(row.rowCount || 0)} řádků přehledu</span>
                    </div>
                    <div className="rm-ads-platform-val">{formatCurrency(row.spend || 0)}</div>
                    <div className="rm-ads-platform-meta">
                      {Number(row.sharePct || 0).toFixed(0)} % spendu · {formatNumber(row.clicks || 0)} kliků
                    </div>
                    <div className="rm-ads-bar">
                      <div className="rm-ads-fill" style={{ width: `${Math.min(100, Math.max(0, Number(row.sharePct || 0)))}%`, background: isMeta ? '#1877f2' : '#4285f4' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {summary.marketBreakdown?.length > 0 && (
          <div className="rm-ads-section">
            <div className="rm-ads-section-title">Rozpad podle země</div>
            <div className="rm-ads-countries">
              {summary.marketBreakdown.map((row) => {
                const marketRevenue = revenueByMarket[row.market] || 0;
                const marketPno = marketRevenue ? (row.spend / marketRevenue) * 100 : 0;
                const providerParts = [row.googleSpend, row.metaSpend]
                  .map((value, index) => ({ label: index === 0 ? 'Google' : 'Meta', value }))
                  .filter((item) => item.value > 0);
                return (
                  <div key={row.market} className="rm-ads-country">
                    <div className="rm-ads-country-name">{MARKET_LABELS[row.market] || row.market.toUpperCase()}</div>
                    <div className="rm-ads-country-val">{formatCurrency(row.spend)}</div>
                    <div className="rm-ads-sub">PNO {marketRevenue ? formatPercent(marketPno) : 'bez tržeb'}</div>
                    <div className="rm-ads-country-meta">
                      {providerParts.length
                        ? providerParts.map((item) => `${item.label} ${formatCurrency(item.value)}`).join(' · ')
                        : 'Google / Meta bez spendu'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

const Heatmap = ({ data, metric, onClick, groupDays, activeDays }) => {
  const [hoveredCell, setHoveredCell] = useState(null);

  useEffect(() => {
    setHoveredCell(null);
  }, [groupDays, metric]);

  const max = useMemo(() => {
    let m = 0;
    if (groupDays) {
      for (let h = 0; h < 24; h++) m = Math.max(m, data.grouped?.[h]?.[metric] || 0);
    } else {
      for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) m = Math.max(m, data[d]?.[h]?.[metric] || 0);
    }
    return m;
  }, [data, metric, groupDays]);

  // Výpočet hodnot pro legendu
  const legendValues = useMemo(() => {
    if (!max) return [0, 0, 0, 0, 0];
    return [
      Math.round(max * 0.2),
      Math.round(max * 0.4),
      Math.round(max * 0.6),
      Math.round(max * 0.8),
      Math.round(max)
    ];
  }, [max]);

  const formatLegendValue = (val) => {
    if (metric === 'orders') return val;
    if (metric === 'aov' || metric === 'revenue') return `${formatNumber(val)}`;
    return val;
  };

  const updateHoveredCell = (event, day, hour, cellData) => {
    const dataForCell = cellData || { orders: 0, revenue: 0 };
    const tooltipWidth = 220;
    const tooltipHeight = 90;
    const viewportPadding = 16;
    const x = Math.min(event.clientX + 14, window.innerWidth - tooltipWidth - viewportPadding);
    const y = Math.min(event.clientY + 14, window.innerHeight - tooltipHeight - viewportPadding);
    const hourLabel = `${String(hour).padStart(2, '0')}:00 - ${String(hour).padStart(2, '0')}:59`;
    setHoveredCell({
      x: Math.max(viewportPadding, x),
      y: Math.max(viewportPadding, y),
      label: day === null ? `Celkem ${hourLabel}` : `${DAYS_FULL[day]} ${hourLabel}`,
      orders: dataForCell.orders || 0,
      revenue: dataForCell.revenue || 0,
    });
  };

  const hoverTooltip = hoveredCell ? (
    <div
      className="fixed z-50 min-w-[210px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white shadow-xl pointer-events-none"
      style={{ left: hoveredCell.x, top: hoveredCell.y }}
    >
      <div className="font-semibold text-slate-100">{hoveredCell.label}</div>
      <div className="mt-1 text-slate-200">Objednávky: <span className="font-semibold text-white">{formatNumber(hoveredCell.orders)}</span></div>
      <div className="text-slate-200">Obrat (bez DPH/poštovného): <span className="font-semibold text-white">{formatCurrency(hoveredCell.revenue)}</span></div>
    </div>
  ) : null;

  if (groupDays) {
    return (
      <>
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div className="flex">
              <div className="w-16" />
              {HOURS.map(h => (
                <div key={h} className="flex-1 text-center text-[10px] text-slate-400">{h}</div>
              ))}
            </div>
            <div className="flex items-center">
              <div className="w-16 text-xs text-slate-500 font-medium">Celkem</div>
              {HOURS.map(h => {
                const hourData = data.grouped?.[h];
                return (
                  <div
                    key={h}
                    onClick={() => onClick(null, h, hourData)}
                    onMouseEnter={(e) => updateHoveredCell(e, null, h, hourData)}
                    onMouseMove={(e) => updateHoveredCell(e, null, h, hourData)}
                    onMouseLeave={() => setHoveredCell(null)}
                    className={`flex-1 aspect-square m-0.5 rounded cursor-pointer transition-all hover:ring-2 hover:ring-blue-400 hover:scale-110 ${getColorIntensity(hourData?.[metric], max)}`}
                  />
                );
              })}
            </div>
            <div className="flex items-center justify-end mt-3 gap-1 text-[9px] text-slate-400">
              <span>0</span>
              {legendValues.map((val, i) => (
                <React.Fragment key={i}>
                  <div className={`w-4 h-4 rounded ${['bg-blue-100', 'bg-blue-200', 'bg-blue-300', 'bg-blue-400', 'bg-blue-500'][i]}`}></div>
                  <span>{formatLegendValue(val)}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
        {hoverTooltip}
      </>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          <div className="flex">
            <div className="w-10" />
            {HOURS.map(h => (
              <div key={h} className="flex-1 text-center text-[10px] text-slate-400">{h}</div>
            ))}
          </div>
          {[1,2,3,4,5,6,0].map(d => {
            const isActive = activeDays.has(d);
            return (
              <div key={d} className={`flex items-center ${!isActive ? 'opacity-30' : ''}`}>
                <div className="w-10 text-xs text-slate-500 font-medium">{DAYS[d]}</div>
                {HOURS.map(h => {
                  const hourData = data[d]?.[h];
                  return (
                    <div
                      key={h}
                      onClick={() => isActive && onClick(d, h, hourData)}
                      onMouseEnter={(e) => isActive && updateHoveredCell(e, d, h, hourData)}
                      onMouseMove={(e) => isActive && updateHoveredCell(e, d, h, hourData)}
                      onMouseLeave={() => setHoveredCell(null)}
                      className={`flex-1 aspect-square m-0.5 rounded transition-all ${
                        isActive
                          ? `cursor-pointer hover:ring-2 hover:ring-blue-400 hover:scale-110 ${getColorIntensity(hourData?.[metric], max)}`
                          : 'bg-slate-50'
                      }`}
                    />
                  );
                })}
              </div>
            );
          })}
          <div className="flex items-center justify-end mt-3 gap-1 text-[9px] text-slate-400">
            <span>0</span>
            {legendValues.map((val, i) => (
              <React.Fragment key={i}>
                <div className={`w-4 h-4 rounded ${['bg-blue-100', 'bg-blue-200', 'bg-blue-300', 'bg-blue-400', 'bg-blue-500'][i]}`}></div>
                <span>{formatLegendValue(val)}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
      {hoverTooltip}
    </>
  );
};

const TimelineTooltip = ({ active, payload, mode }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-xl">
      <div className="font-semibold text-slate-800">{mode === 'hour' ? row.fullLabel : row.fullDate}</div>
      <div className="mt-1 text-slate-600">Objednávky: <span className="font-semibold text-slate-800">{formatNumber(row.orders)}</span></div>
      <div className="text-slate-600">Obrat (bez DPH/poštovného): <span className="font-semibold text-slate-800">{formatCurrency(row.revenue)}</span></div>
      <div className="text-slate-600">Tržba z poštovného: <span className="font-semibold text-slate-800">{formatCurrency(row.shippingRevenue)}</span></div>
    </div>
  );
};

const TempoCurveTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-xl">
      <div className="font-semibold text-slate-800">{row.label}</div>
      <div className="mt-1 text-slate-600">Objednávky v hodině: <span className="font-semibold text-slate-800">{formatNumber(row.orders)}</span> ({formatPercent(row.ordersSharePct)})</div>
      <div className="text-slate-600">Obrat v hodině: <span className="font-semibold text-slate-800">{formatCurrency(row.revenue)}</span> ({formatPercent(row.revenueSharePct)})</div>
      <div className="mt-1 text-slate-600">Kumul. objednávky: <span className="font-semibold text-slate-800">{formatPercent(row.cumOrdersPct)}</span></div>
      <div className="text-slate-600">Kumul. obrat: <span className="font-semibold text-slate-800">{formatPercent(row.cumRevenuePct)}</span></div>
    </div>
  );
};

const TempoTrendTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-xl">
      <div className="font-semibold text-slate-800">{row.fullDate} • {MARKET_LABELS[row.market] || row.market}</div>
      <div className="mt-1 text-slate-600">H50 objednávky: <span className="font-semibold text-slate-800">{formatHourValue(row.h50Orders)}</span></div>
      <div className="text-slate-600">H50 obrat: <span className="font-semibold text-slate-800">{formatHourValue(row.h50Revenue)}</span></div>
      <div className="text-slate-600">Objednávky/den: <span className="font-semibold text-slate-800">{formatNumber(row.ordersTotal)}</span></div>
      <div className="text-slate-600">Obrat/den: <span className="font-semibold text-slate-800">{formatCurrency(row.revenueTotal)}</span></div>
    </div>
  );
};

const CompareCard = ({ t1, v1, c1, r1, t2, v2, c2, r2, i1, i2, desc1, desc2 }) => {
  const w = v1 > v2 ? 1 : 2;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className={`rounded-xl p-4 transition-all ${w === 1 ? 'bg-blue-50 border-2 border-blue-400 shadow-md' : 'bg-slate-50 border border-slate-200'}`}>
        <div className="flex items-center gap-2 text-sm text-slate-600 mb-1">{i1} {t1}</div>
        {desc1 && <div className="text-xs text-slate-400 mb-2">{desc1}</div>}
        <div className="text-xs text-slate-400 mb-0.5">Ø objednávka (bez DPH)</div>
        <div className="text-2xl font-bold text-slate-800">{formatCurrency(v1)}</div>
        <div className="text-xs text-slate-500 mt-1">{formatNumber(c1)} objednávek</div>
        {r1 != null && <div className="text-xs text-slate-400 mt-0.5">Obrat: {formatCurrency(r1)}</div>}
      </div>
      <div className={`rounded-xl p-4 transition-all ${w === 2 ? 'bg-green-50 border-2 border-green-400 shadow-md' : 'bg-slate-50 border border-slate-200'}`}>
        <div className="flex items-center gap-2 text-sm text-slate-600 mb-1">{i2} {t2}</div>
        {desc2 && <div className="text-xs text-slate-400 mb-2">{desc2}</div>}
        <div className="text-xs text-slate-400 mb-0.5">Ø objednávka (bez DPH)</div>
        <div className="text-2xl font-bold text-slate-800">{formatCurrency(v2)}</div>
        <div className="text-xs text-slate-500 mt-1">{formatNumber(c2)} objednávek</div>
        {r2 != null && <div className="text-xs text-slate-400 mt-0.5">Obrat: {formatCurrency(r2)}</div>}
      </div>
    </div>
  );
};

const InsightBox = ({ children, type = 'info' }) => {
  const styles = {
    info: 'bg-amber-50 border-amber-200 text-amber-800',
    success: 'bg-green-50 border-green-200 text-green-800',
    action: 'bg-blue-50 border-blue-200 text-blue-800',
  };
  return (
    <div className={`mt-4 p-4 rounded-xl border ${styles[type]}`}>
      {children}
    </div>
  );
};

const DatePresetButton = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
      active 
        ? 'bg-blue-500 text-white shadow-sm' 
        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`}
  >
    {label}
  </button>
);

const LoadingOverlay = ({ message }) => (
  <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center">
    <div className="text-center">
      <div className="relative w-16 h-16 mx-auto mb-4">
        <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-blue-500 rounded-full border-t-transparent animate-spin"></div>
      </div>
      <p className="text-lg font-medium text-slate-700 animate-pulse">{message}</p>
      <div className="mt-3 w-48 h-2 bg-slate-200 rounded-full mx-auto overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full animate-[loading_1.5s_ease-in-out_infinite]" 
          style={{ width: '30%', animation: 'loading 1.5s ease-in-out infinite' }}></div>
      </div>
    </div>
    <style>{`
      @keyframes loading {
        0% { width: 0%; margin-left: 0%; }
        50% { width: 60%; margin-left: 20%; }
        100% { width: 0%; margin-left: 100%; }
      }
    `}</style>
  </div>
);

const LoginPage = ({ onLogin, error: authError }) => (
  <div className="rm-login-page">
    <div className="rm-login-card">
      <div className="rm-logo rm-login-logo">RM</div>
      <h1 className="rm-login-title">RM Orders</h1>
      <p className="rm-login-sub">REGAL MASTER analytics</p>
      {authError && (
        <div className="rm-alert rm-alert--danger">
          {authError}
        </div>
      )}
      <button
        onClick={onLogin}
        className="rm-login-button"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Přihlásit se přes Google
      </button>
      <p className="rm-login-note">Přístup je řízený podle rolí v dashboardu.</p>
    </div>
  </div>
);

const NoAccessPage = ({ user, onLogout }) => (
  <div className="rm-login-page">
    <div className="rm-login-card">
      <div className="rm-logo rm-login-logo">RM</div>
      <h1 className="rm-login-title">Účet nemá přístup</h1>
      <p className="rm-login-sub">
        Přihlášený účet {user?.email || 'bez e-mailu'} není přiřazený k žádné roli v Order Analytics.
      </p>
      <p className="rm-login-note">Pro povolení přístupu je potřeba přesně tento e-mail přidat do rolí.</p>
      <button
        onClick={onLogout}
        className="rm-login-button rm-login-button--dark"
      >
        Odhlásit
      </button>
    </div>
  </div>
);

export default function App() {
  const [user, setUser] = useState(() => getStoredSupabaseUser());
  const [authLoading, setAuthLoading] = useState(() => !getStoredSupabaseUser());
  const [authError, setAuthError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dataWarning, setDataWarning] = useState('');
  const [marginDataWarning, setMarginDataWarning] = useState('');
  const [orders, setOrders] = useState([]);
  const [country, setCountry] = useState('all');
  const [metric, setMetric] = useState('orders');
  const [tab, setTab] = useState(() => getInitialAppTab(getStoredSupabaseUser()?.email));
  const [cell, setCell] = useState(null);
  const [groupDays, setGroupDays] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [tempoMarket, setTempoMarket] = useState('all');
  const [tempoSelectedDayKey, setTempoSelectedDayKey] = useState(null);
  const [showTempoHistory, setShowTempoHistory] = useState(true);
  const [activePreset, setActivePreset] = useState('today');
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0]);
  const [dateFrom, setDateFrom] = useState(() => formatDateForInput(new Date()));
  const [dateTo, setDateTo] = useState(() => formatDateForInput(new Date()));
  const [refreshTick, setRefreshTick] = useState(0);
  const [adsSummary, setAdsSummary] = useState(() => emptyAdsSummary());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  const [lastDefaultedUserEmail, setLastDefaultedUserEmail] = useState('');
  const userEmail = (user?.email || '').toLowerCase();
  const access = useMemo(() => getUserAccess(userEmail), [userEmail]);
  const allowedTabs = useMemo(
    () => APP_TABS.filter((item) => (
      item.id === OVERVIEW_TAB_ID
        ? access.canFetchDashboardOrders
        : access.modules.includes(item.id)
    )),
    [access],
  );
  const appDefaultTab = access.isLogisticsOnly
    ? MODULE_IDS.IMPORT_LOGISTICS
    : access.canFetchDashboardOrders
      ? OVERVIEW_TAB_ID
      : access.defaultTab;
  const canUseFinance = access.canUseFinance;
  const canUsePokec = access.canUsePokec;
  const canUseProducts = access.canUseProducts;
  const canUseImportLogistics = access.modules.includes(MODULE_IDS.IMPORT_LOGISTICS);
  const canUseAds = access.canUseAds;
  const canUseHeatmap = access.modules.includes(MODULE_IDS.HEATMAP);
  const canUseMargin = access.modules.includes(MODULE_IDS.MARGIN);
  const canUseTempo = access.modules.includes(MODULE_IDS.TEMPO);
  const canUseGeo = access.modules.includes(MODULE_IDS.GEO);
  const canUseB2b = access.modules.includes(MODULE_IDS.B2B);
  const showDashboardControls = access.canFetchDashboardOrders;
  const todayKey = formatDateForInput(new Date());
  const isLiveRange = dateFrom <= todayKey && dateTo >= todayKey;
  const shouldAutoRefreshOrders = access.canFetchDashboardOrders && isLiveRange && ![MODULE_IDS.IMPORT_LOGISTICS, MODULE_IDS.POKEC, MODULE_IDS.PRODUCTS, MODULE_IDS.FINANCE].includes(tab);
  const currentPageMeta = allowedTabs.find((item) => item.id === tab) || allowedTabs[0];
  const showFilterBar = showDashboardControls && ![MODULE_IDS.IMPORT_LOGISTICS, MODULE_IDS.POKEC, MODULE_IDS.FINANCE].includes(tab);

  useEffect(() => {
    if (!user || !access.hasAccess) return;
    if (!allowedTabs.some((item) => item.id === tab)) setTab(appDefaultTab);
  }, [access, allowedTabs, appDefaultTab, tab, user]);

  useEffect(() => {
    if (!userEmail) {
      setLastDefaultedUserEmail('');
      return;
    }
    if (lastDefaultedUserEmail === userEmail) return;
    setTab(appDefaultTab);
    setLastDefaultedUserEmail(userEmail);
  }, [appDefaultTab, lastDefaultedUserEmail, userEmail]);

  // Auth: listen for session changes
  useEffect(() => {
    let cancelled = false;
    let settled = false;
    let authTimeout = null;

    const finishAuth = (session, { allowStoredFallback = true } = {}) => {
      if (cancelled) return;
      settled = true;
      if (authTimeout) window.clearTimeout(authTimeout);
      const nextUser = session?.user || (allowStoredFallback ? getStoredSupabaseUser() : null);
      setUser(nextUser || null);
      setAuthError(null);
      setAuthLoading(false);
    };

    authTimeout = window.setTimeout(() => {
      if (cancelled || settled) return;
      finishAuth(null);
    }, 8000);

    supabase.auth
      .getSession()
      .then(({ data: { session }, error: sessionError }) => {
        if (cancelled) return;
        if (sessionError) {
          finishAuth(null);
          return;
        }
        finishAuth(session);
      })
      .catch(() => {
        if (cancelled) return;
        finishAuth(null);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      finishAuth(session, { allowStoredFallback: Boolean(session?.user) });
    });

    return () => {
      cancelled = true;
      window.clearTimeout(authTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const handleLogin = async () => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) setAuthError(error.message);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  // Rotate loading messages
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setLoadingMessage(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]);
    }, 2000);
    return () => clearInterval(interval);
  }, [loading]);

  const applyPreset = (preset) => {
    const dates = getDatePreset(preset);
    if (dates) {
      setDateFrom(dates.from);
      setDateTo(dates.to);
      setActivePreset(preset);
      setCustomRangeOpen(false);
    }
  };

  const handleDateChange = (type, value) => {
    if (type === 'from') setDateFrom(value);
    else setDateTo(value);
    setActivePreset(null);
  };

  useEffect(() => {
    if (!shouldAutoRefreshOrders) return undefined;

    const triggerRefresh = () => setRefreshTick((value) => value + 1);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') triggerRefresh();
    }, 60_000);
    const handleFocus = () => triggerRefresh();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') triggerRefresh();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [shouldAutoRefreshOrders]);

  useEffect(() => {
    if (!user || !access.canFetchDashboardOrders) {
      setOrders([]);
      setLoading(false);
      setDataWarning('');
      setMarginDataWarning('');
      return;
    }

    setLoading(true);
    setError(null);
    setDataWarning('');
    setLoadingMessage(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]);
    
    async function fetchAllOrders() {
      let allOrders = [];
      let offset = 0;
      const limit = 1000;
      let usedPlainFallback = false;
      let useAnonymousReadFallback = false;
      let usedAnonymousReadFallback = false;
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Chybí přihlášení pro načtení objednávek.');
      
      // Timezone offset pro správné filtrování podle lokálního času (CET/CEST)
      // +01:00 → %2B01:00 (URL encoding pro Supabase PostgREST)
      const tzOffset = -new Date().getTimezoneOffset();
      const tzSign = tzOffset >= 0 ? '%2B' : '-';
      const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
      const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0');
      const tz = `${tzSign}${tzHours}:${tzMins}`;

      while (true) {
        const joinedUrl =
          `${SUPABASE_URL}/rest/v1/orders?select=*,order_items(order_id,product_code,product_name,quantity,buy_price,unit_price_without_vat,total_price_without_vat,vat_rate,sku,ean)&order_date=gte.${dateFrom}T00:00:00${tz}&order_date=lte.${dateTo}T23:59:59${tz}&order=order_date.desc&limit=${limit}&offset=${offset}`;
        const plainUrl =
          `${SUPABASE_URL}/rest/v1/orders?select=*&order_date=gte.${dateFrom}T00:00:00${tz}&order_date=lte.${dateTo}T23:59:59${tz}&order=order_date.desc&limit=${limit}&offset=${offset}`;
        const requestOptions = (anonymous = useAnonymousReadFallback) => ({
          headers: {
            'apikey': SUPABASE_KEY,
            ...(anonymous ? {} : { 'Authorization': `Bearer ${accessToken}` }),
          }
        });

        let activeUrl = joinedUrl;
        let response = await fetchWithTimeout(activeUrl, requestOptions(), 6000);
        if (!response.ok && [502, 503, 504].includes(response.status)) {
          usedPlainFallback = true;
          activeUrl = plainUrl;
          response = await fetchWithTimeout(activeUrl, requestOptions(), 6000);
        }
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        let data = await response.json();
        if (
          offset === 0
          && !useAnonymousReadFallback
          && Array.isArray(data)
          && data.length === 0
        ) {
          const anonymousResponse = await fetchWithTimeout(activeUrl, requestOptions(true), 6000);
          if (anonymousResponse.ok) {
            const anonymousData = await anonymousResponse.json();
            if (Array.isArray(anonymousData) && anonymousData.length > 0) {
              useAnonymousReadFallback = true;
              usedAnonymousReadFallback = true;
              data = anonymousData;
              console.warn('Supabase authenticated RLS returned no orders; using anon read fallback until authenticated read policies are applied.');
            }
          }
        }
        if (!Array.isArray(data) || data.length === 0) break;
        
        allOrders = allOrders.concat(data);
        offset += limit;
        
        if (data.length < limit) break;
      }
      
      return { allOrders, usedPlainFallback, usedAnonymousReadFallback };
    }

    Promise.all([
      fetchAllOrders(),
      fetchPurchasePriceLookup().catch((lookupError) => {
        console.warn('Nákupky z UpGates katalogu se nepodařilo načíst:', lookupError);
        return null;
      }),
    ])
      .then(([{ allOrders: d, usedPlainFallback, usedAnonymousReadFallback }, purchasePriceLookup]) => {
        const deduped = deduplicateOrders(d);
        const cleanBase = filterCancelled(deduped);
        const clean = attachPurchasePriceLookup(cleanBase, purchasePriceLookup);
        setOrders(clean);
        storeCachedOrders(dateFrom, dateTo, clean);
        setDataWarning('');
        setMarginDataWarning(
          [
            usedPlainFallback
              ? 'Část objednávek se načetla bez order_items. Marže, produkty a Ads ekonomika proto běží v omezeném režimu a přesné marže mohou být podhodnocené nebo neúplné.'
              : '',
            purchasePriceLookup
              ? ''
              : 'Kanonické UpGates nákupky se nenačetly; marže běží přes snapshot objednávky a order_items fallback.',
          ].filter(Boolean).join(' '),
        );
        if (deduped.length < d.length) {
          console.warn(`⚠️ Deduplikace: ${d.length} → ${deduped.length} (odstraněno ${d.length - deduped.length} duplikátů)`);
        }
        if (clean.length < deduped.length) {
          console.warn(`🚫 Storno filtr: ${deduped.length} → ${clean.length} (odstraněno ${deduped.length - clean.length} stornovaných)`);
        }
        if (usedAnonymousReadFallback) {
          console.warn('Objednávky se načetly přes anon read fallback; je potřeba dotáhnout Supabase RLS pro authenticated roli.');
        }
        setLoading(false);
      })
      .catch(e => {
        const cached = getCachedOrders(dateFrom, dateTo);
        if (cached) {
          setOrders(cached.orders);
          setDataWarning(`Supabase teď vrací ${e.message || 'chybu načítání'}; zobrazuji poslední uložený snapshot z ${new Date(cached.cachedAt).toLocaleString('cs-CZ')}.`);
          setMarginDataWarning('');
        } else {
          setOrders([]);
          setDataWarning(`Supabase teď vrací ${e.message || 'chybu načítání'}; pro toto období nemám v browseru uložený snapshot.`);
          setMarginDataWarning('');
        }
        setError(null);
        setLoading(false);
      });
  }, [access.canFetchDashboardOrders, dateFrom, dateTo, refreshTick, user]);

  useEffect(() => {
    let cancelled = false;

    async function fetchAdsSummary() {
      if (!user || !canUseAds) {
        setAdsSummary({ ...emptyAdsSummary(), loading: false });
        return;
      }

      setAdsSummary(emptyAdsSummary());

      try {
        const params = new URLSearchParams({ dateFrom, dateTo });
        if (country !== 'all') params.set('country', country);

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) throw new Error('Chybí přihlášení pro Ads souhrn.');

        const response = await fetch(`/api/ads-summary?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
        if (cancelled) return;
        setAdsSummary({
          ...emptyAdsSummary(),
          ...payload,
          loading: false,
          error: '',
        });
      } catch (err) {
        if (!cancelled) {
          setAdsSummary({
            ...emptyAdsSummary(),
            loading: false,
            error: `Ads souhrn se nepodařilo načíst: ${err.message || 'neznámá chyba'}`,
          });
        }
      }
    }

    fetchAdsSummary();

    return () => {
      cancelled = true;
    };
  }, [canUseAds, user, dateFrom, dateTo, country, refreshTick]);

  const filtered = useMemo(() => country === 'all' ? orders : orders.filter(o => o.market === country), [orders, country]);

  const revenueByMarket = useMemo(() => {
    const totals = {};
    filtered.forEach((order) => {
      const market = order.market || 'unknown';
      totals[market] = (totals[market] || 0) + getRevenueWithoutVAT(order);
    });
    return totals;
  }, [filtered]);

  // Zjisti které dny jsou aktivní (mají data)
  const activeDays = useMemo(() => {
    const days = new Set();
    filtered.forEach(o => {
      if (o.order_date) {
        const dt = new Date(o.order_date);
        days.add(dt.getDay());
      }
    });
    return days;
  }, [filtered]);

  const kpis = useMemo(() => {
    let cnt = 0, rev = 0, shippingRevenue = 0, b2b = 0, big = 0;
    filtered.forEach(o => { 
      cnt++; 
      rev += getRevenueWithoutVAT(o);
      shippingRevenue += getShippingRevenueWithoutVAT(o);
      if (isB2B(o)) b2b++; 
      if (isBigCity(o.raw_data?.customer?.city_invoice, o.market)) big++; 
    });
    return { 
      orders: cnt, 
      revenue: rev, 
      shippingRevenue,
      aov: cnt ? rev / cnt : 0, 
      b2bPct: cnt ? b2b / cnt * 100 : 0, 
      bigPct: cnt ? big / cnt * 100 : 0 
    };
  }, [filtered]);

  const hasAdsData = adsSummary.rows > 0 || adsSummary.spend > 0;
  const adsPno = kpis.revenue ? (adsSummary.spend / kpis.revenue) * 100 : 0;
  const adsPnoSub = adsSummary.loading
    ? 'PNO: načítám Ads'
    : adsSummary.error
      ? 'PNO: Ads nedostupné'
      : !hasAdsData
        ? 'PNO: bez Ads spendu'
        : kpis.revenue
          ? `PNO ${formatPercent(adsPno)} · Ads ${formatCurrency(adsSummary.spend)}`
          : `PNO: bez tržeb · Ads ${formatCurrency(adsSummary.spend)}`;
  const adsBreakdownSub = adsSummary.loading
    ? 'Ads: načítám rozpad'
    : adsSummary.error
      ? 'Ads: nedostupné'
      : !hasAdsData
        ? 'Ads: bez spendu'
        : adsSummary.providerBreakdown.length
          ? adsSummary.providerBreakdown
              .map((row) => `${providerLabelShort(row.provider)} ${formatCurrency(row.spend)}`)
              .join(' · ')
          : `Ads ${formatCurrency(adsSummary.spend)}`;

  const heatmap = useMemo(() => {
    const d = {};
    for (let day = 0; day < 7; day++) { 
      d[day] = {}; 
      for (let h = 0; h < 24; h++) d[day][h] = { orders: 0, revenue: 0, aov: 0 }; 
    }
    // Grouped by hour only
    d.grouped = {};
    for (let h = 0; h < 24; h++) d.grouped[h] = { orders: 0, revenue: 0, aov: 0 };
    
    filtered.forEach(o => {
      if (!o.order_date) return;
      const dt = new Date(o.order_date), day = dt.getDay(), h = dt.getHours(), r = getRevenueWithoutVAT(o);
      d[day][h].orders++; 
      d[day][h].revenue += r;
      d.grouped[h].orders++;
      d.grouped[h].revenue += r;
    });
    
    for (let day = 0; day < 7; day++) {
      for (let h = 0; h < 24; h++) {
        d[day][h].aov = d[day][h].orders ? d[day][h].revenue / d[day][h].orders : 0;
      }
    }
    for (let h = 0; h < 24; h++) {
      d.grouped[h].aov = d.grouped[h].orders ? d.grouped[h].revenue / d.grouped[h].orders : 0;
    }
    
    return d;
  }, [filtered]);

  const timelineSeries = useMemo(() => {
    const from = parseDateFromInput(dateFrom);
    const to = parseDateFromInput(dateTo);
    if (!from || !to || from > to) {
      return { validRange: false, mode: 'day', data: [], totals: { orders: 0, revenue: 0, shippingRevenue: 0 } };
    }

    const sameDay =
      from.getFullYear() === to.getFullYear() &&
      from.getMonth() === to.getMonth() &&
      from.getDate() === to.getDate();

    if (sameDay) {
      const data = HOURS.map((h) => ({
        id: `h-${h}`,
        label: `${String(h).padStart(2, '0')}:00`,
        fullLabel: `${String(h).padStart(2, '0')}:00 - ${String(h).padStart(2, '0')}:59`,
        orders: 0,
        revenue: 0,
        shippingRevenue: 0,
      }));

      filtered.forEach((o) => {
        if (!o.order_date) return;
        const dt = new Date(o.order_date);
        if (
          dt.getFullYear() !== from.getFullYear() ||
          dt.getMonth() !== from.getMonth() ||
          dt.getDate() !== from.getDate()
        ) {
          return;
        }
        const h = dt.getHours();
        data[h].orders += 1;
        data[h].revenue += getRevenueWithoutVAT(o);
        data[h].shippingRevenue += getShippingRevenueWithoutVAT(o);
      });

      const totals = data.reduce(
        (acc, row) => ({
          orders: acc.orders + row.orders,
          revenue: acc.revenue + row.revenue,
          shippingRevenue: acc.shippingRevenue + row.shippingRevenue,
        }),
        { orders: 0, revenue: 0, shippingRevenue: 0 },
      );

      return { validRange: true, mode: 'hour', data, totals };
    }

    const data = [];
    const byDay = new Map();
    const cursor = new Date(from);
    while (cursor <= to) {
      const key = formatDateForInput(cursor);
      const row = {
        id: key,
        key,
        label: cursor.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit' }),
        fullDate: cursor.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        orders: 0,
        revenue: 0,
        shippingRevenue: 0,
      };
      data.push(row);
      byDay.set(key, row);
      cursor.setDate(cursor.getDate() + 1);
    }

    filtered.forEach((o) => {
      if (!o.order_date) return;
      const dt = new Date(o.order_date);
      const key = formatDateForInput(dt);
      const row = byDay.get(key);
      if (!row) return;
      row.orders += 1;
      row.revenue += getRevenueWithoutVAT(o);
      row.shippingRevenue += getShippingRevenueWithoutVAT(o);
    });

    const totals = data.reduce(
      (acc, row) => ({
        orders: acc.orders + row.orders,
        revenue: acc.revenue + row.revenue,
        shippingRevenue: acc.shippingRevenue + row.shippingRevenue,
      }),
      { orders: 0, revenue: 0, shippingRevenue: 0 },
    );

    return { validRange: true, mode: 'day', data, totals };
  }, [filtered, dateFrom, dateTo]);

  const timelineMarketBreakdown = useMemo(() => {
    const byKey = new Map();
    filtered.forEach((order) => {
      if (!order.order_date) return;
      const dt = new Date(order.order_date);
      if (Number.isNaN(dt.getTime())) return;
      const dateKey = formatDateForInput(dt);
      const market = order.market || 'unknown';
      const key = `${dateKey}|${market}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          dateKey,
          fullDate: dt.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' }),
          market,
          orders: 0,
          revenue: 0,
          shippingRevenue: 0,
        });
      }
      const row = byKey.get(key);
      row.orders += 1;
      row.revenue += getRevenueWithoutVAT(order);
      row.shippingRevenue += getShippingRevenueWithoutVAT(order);
    });

    return Array.from(byKey.values()).sort((a, b) => {
      const dateCompare = b.dateKey.localeCompare(a.dateKey);
      if (dateCompare) return dateCompare;
      const ai = MARKET_ORDER.indexOf(a.market);
      const bi = MARKET_ORDER.indexOf(b.market);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.market.localeCompare(b.market);
    });
  }, [filtered]);

  const tempoDailyRecords = useMemo(() => {
    const byKey = new Map();

    filtered.forEach((o) => {
      if (!o.order_date) return;
      const dt = new Date(o.order_date);
      if (Number.isNaN(dt.getTime())) return;

      const market = o.market || 'unknown';
      const dateKey = formatDateForInput(dt);
      const key = `${dateKey}|${market}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          dateKey,
          shortDate: dt.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit' }),
          fullDate: dt.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' }),
          weekday: dt.getDay(),
          weekdayLabel: DAYS_FULL[dt.getDay()],
          market,
          ordersByHour: Array.from({ length: 24 }, () => 0),
          revenueByHour: Array.from({ length: 24 }, () => 0),
          ordersTotal: 0,
          revenueTotal: 0,
        });
      }

      const row = byKey.get(key);
      const hour = dt.getHours();
      const revenue = getRevenueWithoutVAT(o);
      row.ordersByHour[hour] += 1;
      row.revenueByHour[hour] += revenue;
      row.ordersTotal += 1;
      row.revenueTotal += revenue;
    });

    const findH50 = (hourlyValues, total) => {
      if (!total) return null;
      let cumulative = 0;
      for (let hour = 0; hour < 24; hour++) {
        cumulative += hourlyValues[hour];
        if (cumulative / total >= 0.5) return hour;
      }
      return 23;
    };

    return Array.from(byKey.values())
      .map((row) => {
        let cumulativeOrders = 0;
        let cumulativeRevenue = 0;
        const hourly = HOURS.map((hour) => {
          const orders = row.ordersByHour[hour];
          const revenue = row.revenueByHour[hour];
          cumulativeOrders += orders;
          cumulativeRevenue += revenue;
          return {
            hour,
            label: `${String(hour).padStart(2, '0')}:00 - ${String(hour).padStart(2, '0')}:59`,
            orders,
            revenue,
            ordersSharePct: row.ordersTotal ? (orders / row.ordersTotal) * 100 : 0,
            revenueSharePct: row.revenueTotal ? (revenue / row.revenueTotal) * 100 : 0,
            cumOrdersPct: row.ordersTotal ? (cumulativeOrders / row.ordersTotal) * 100 : 0,
            cumRevenuePct: row.revenueTotal ? (cumulativeRevenue / row.revenueTotal) * 100 : 0,
          };
        });

        const h50Orders = findH50(row.ordersByHour, row.ordersTotal);
        const h50Revenue = findH50(row.revenueByHour, row.revenueTotal);
        return {
          ...row,
          hourly,
          h50Orders,
          h50Revenue,
          deltaH50: h50Orders != null && h50Revenue != null ? h50Revenue - h50Orders : null,
        };
      })
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey) || a.market.localeCompare(b.market));
  }, [filtered]);

  const tempoAvailableMarkets = useMemo(() => {
    const markets = Array.from(new Set(tempoDailyRecords.map((r) => r.market)));
    const preferred = ['cz', 'sk', 'hu', 'ro', 'unknown'].filter((m) => markets.includes(m));
    const rest = markets.filter((m) => !preferred.includes(m)).sort();
    return [...preferred, ...rest];
  }, [tempoDailyRecords]);

  const tempoRecordsByMarket = useMemo(
    () => tempoDailyRecords.filter((r) => tempoMarket === 'all' || r.market === tempoMarket),
    [tempoDailyRecords, tempoMarket],
  );

  const tempoDaySeries = useMemo(() => {
    const byDate = new Map();

    tempoRecordsByMarket.forEach((r) => {
      if (!byDate.has(r.dateKey)) {
        byDate.set(r.dateKey, {
          key: r.dateKey,
          dateKey: r.dateKey,
          shortDate: r.shortDate,
          fullDate: r.fullDate,
          weekday: r.weekday,
          weekdayLabel: r.weekdayLabel,
          market: tempoMarket === 'all' ? 'all' : r.market,
          ordersByHour: Array.from({ length: 24 }, () => 0),
          revenueByHour: Array.from({ length: 24 }, () => 0),
          ordersTotal: 0,
          revenueTotal: 0,
          marketsCount: 0,
        });
      }

      const dayRow = byDate.get(r.dateKey);
      for (let h = 0; h < 24; h++) {
        dayRow.ordersByHour[h] += r.ordersByHour[h];
        dayRow.revenueByHour[h] += r.revenueByHour[h];
      }
      dayRow.ordersTotal += r.ordersTotal;
      dayRow.revenueTotal += r.revenueTotal;
      dayRow.marketsCount += 1;
    });

    const findH50 = (hourlyValues, total) => {
      if (!total) return null;
      let cumulative = 0;
      for (let hour = 0; hour < 24; hour++) {
        cumulative += hourlyValues[hour];
        if (cumulative / total >= 0.5) return hour;
      }
      return 23;
    };

    return Array.from(byDate.values())
      .map((row) => {
        let cumulativeOrders = 0;
        let cumulativeRevenue = 0;
        const hourly = HOURS.map((hour) => {
          const orders = row.ordersByHour[hour];
          const revenue = row.revenueByHour[hour];
          cumulativeOrders += orders;
          cumulativeRevenue += revenue;
          return {
            hour,
            label: `${String(hour).padStart(2, '0')}:00 - ${String(hour).padStart(2, '0')}:59`,
            orders,
            revenue,
            ordersSharePct: row.ordersTotal ? (orders / row.ordersTotal) * 100 : 0,
            revenueSharePct: row.revenueTotal ? (revenue / row.revenueTotal) * 100 : 0,
            cumOrdersPct: row.ordersTotal ? (cumulativeOrders / row.ordersTotal) * 100 : 0,
            cumRevenuePct: row.revenueTotal ? (cumulativeRevenue / row.revenueTotal) * 100 : 0,
          };
        });

        const h50Orders = findH50(row.ordersByHour, row.ordersTotal);
        const h50Revenue = findH50(row.revenueByHour, row.revenueTotal);
        return {
          ...row,
          hourly,
          h50Orders,
          h50Revenue,
          deltaH50: h50Orders != null && h50Revenue != null ? h50Revenue - h50Orders : null,
          xLabel: row.shortDate,
        };
      })
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [tempoRecordsByMarket, tempoMarket]);

  const tempoH50ByDayData = useMemo(
    () => [...tempoDaySeries].sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    [tempoDaySeries],
  );

  const tempoSelectedRecord = useMemo(
    () => tempoDaySeries.find((r) => r.key === tempoSelectedDayKey) || tempoDaySeries[0] || null,
    [tempoDaySeries, tempoSelectedDayKey],
  );

  const tempoSummary = useMemo(() => {
    const h50OrdersValues = tempoDaySeries.map((r) => r.h50Orders).filter((v) => v != null);
    const h50RevenueValues = tempoDaySeries.map((r) => r.h50Revenue).filter((v) => v != null);
    const deltaValues = tempoDaySeries.map((r) => r.deltaH50).filter((v) => v != null);
    return {
      days: tempoDaySeries.length,
      h50OrdersMedian: median(h50OrdersValues),
      h50RevenueMedian: median(h50RevenueValues),
      deltaMedian: median(deltaValues),
    };
  }, [tempoDaySeries]);

  const tempoMatrixRows = useMemo(() => {
    const source = tempoDailyRecords.filter((r) => tempoMarket === 'all' || r.market === tempoMarket);
    const byMarket = new Map();

    source.forEach((row) => {
      if (!byMarket.has(row.market)) byMarket.set(row.market, new Map());
      const byWeekday = byMarket.get(row.market);
      if (!byWeekday.has(row.weekday)) byWeekday.set(row.weekday, { orders: [], revenue: [], delta: [], count: 0 });
      const bucket = byWeekday.get(row.weekday);
      if (row.h50Orders != null) bucket.orders.push(row.h50Orders);
      if (row.h50Revenue != null) bucket.revenue.push(row.h50Revenue);
      if (row.deltaH50 != null) bucket.delta.push(row.deltaH50);
      bucket.count += 1;
    });

    const marketOrder = ['cz', 'sk', 'hu', 'ro', 'unknown'];
    const marketKeys = Array.from(byMarket.keys()).sort((a, b) => {
      const ai = marketOrder.indexOf(a);
      const bi = marketOrder.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    return marketKeys.map((market) => {
      const byWeekday = byMarket.get(market);
      const cells = [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
        const bucket = byWeekday.get(weekday);
        if (!bucket) return { weekday, count: 0, h50Orders: null, h50Revenue: null, delta: null };
        return {
          weekday,
          count: bucket.count,
          h50Orders: median(bucket.orders),
          h50Revenue: median(bucket.revenue),
          delta: median(bucket.delta),
        };
      });
      return { market, cells };
    });
  }, [tempoDailyRecords, tempoMarket]);

  useEffect(() => {
    if (tempoMarket !== 'all' && !tempoAvailableMarkets.includes(tempoMarket)) {
      setTempoMarket('all');
    }
  }, [tempoAvailableMarkets, tempoMarket]);

  useEffect(() => {
    if (!tempoDaySeries.length) {
      setTempoSelectedDayKey(null);
      return;
    }
    if (!tempoDaySeries.some((r) => r.key === tempoSelectedDayKey)) {
      setTempoSelectedDayKey(tempoDaySeries[0].key);
    }
  }, [tempoDaySeries, tempoSelectedDayKey]);

  const geoStats = useMemo(() => {
    let bigC = { o: 0, r: 0 }, smallC = { o: 0, r: 0 };
    const cities = {};
    filtered.forEach(o => {
      const rawCity = o.raw_data?.customer?.city_invoice || '';
      const city = aggregateCity(rawCity);
      const r = getRevenueWithoutVAT(o);
      const big = isBigCity(rawCity, o.market);
      
      if (big) { bigC.o++; bigC.r += r; } else { smallC.o++; smallC.r += r; }
      
      if (!cities[city]) cities[city] = { n: city, o: 0, r: 0, big };
      cities[city].o++;
      cities[city].r += r;
    });
    const top = Object.values(cities)
      .filter(x => x.o >= 2 && !x.big)
      .map(x => ({ ...x, aov: x.r / x.o }))
      .sort((a, b) => b.aov - a.aov)
      .slice(0, 8);
    return { 
      big: { ...bigC, aov: bigC.o ? bigC.r / bigC.o : 0 }, 
      small: { ...smallC, aov: smallC.o ? smallC.r / smallC.o : 0 }, 
      top 
    };
  }, [filtered]);

  const b2bStats = useMemo(() => {
    let b2b = { o: 0, r: 0 }, b2c = { o: 0, r: 0 };
    filtered.forEach(o => { 
      const r = getRevenueWithoutVAT(o); 
      if (isB2B(o)) { b2b.o++; b2b.r += r; } else { b2c.o++; b2c.r += r; } 
    });
    return { 
      b2b: { ...b2b, aov: b2b.o ? b2b.r / b2b.o : 0 }, 
      b2c: { ...b2c, aov: b2c.o ? b2c.r / b2c.o : 0 } 
    };
  }, [filtered]);

  const geoInsight = useMemo(() => {
    const diff = Math.abs(geoStats.big.aov - geoStats.small.aov);
    const pctDiff = geoStats.small.aov ? ((geoStats.big.aov - geoStats.small.aov) / geoStats.small.aov * 100).toFixed(0) : 0;
    
    if (geoStats.big.aov > geoStats.small.aov) {
      return {
        title: `🎯 Velká města = vyšší AOV`,
        main: `Zákazníci z velkých měst utrácí v průměru o ${formatCurrency(diff)} více (+${pctDiff}%).`,
        action: `💡 Doporučení: Zvyšte bidové strategie pro krajská města a lokality nad 50k obyvatel. Zvažte prémiový remarketing pro Praha, Brno, Ostrava.`,
        type: 'success'
      };
    } else {
      return {
        title: `🏘️ Menší města = překvapivě vyšší AOV`,
        main: `Zákazníci z menších měst utrácí v průměru o ${formatCurrency(diff)} více (+${Math.abs(pctDiff)}%).`,
        action: `💡 Doporučení: Prozkoumejte tento segment - možná zde máte méně konkurence. Otestujte kampaně mimo velká města.`,
        type: 'info'
      };
    }
  }, [geoStats]);

  const b2bInsight = useMemo(() => {
    const diff = Math.abs(b2bStats.b2b.aov - b2bStats.b2c.aov);
    const pctDiff = b2bStats.b2c.aov ? ((b2bStats.b2b.aov - b2bStats.b2c.aov) / b2bStats.b2c.aov * 100).toFixed(0) : 0;
    const b2bRevShare = ((b2bStats.b2b.r / (b2bStats.b2b.r + b2bStats.b2c.r)) * 100).toFixed(0);
    
    if (b2bStats.b2b.aov > b2bStats.b2c.aov) {
      return {
        title: `🏢 B2B segment je zlatý důl`,
        main: `Firemní zákazníci utrácí o ${formatCurrency(diff)} více na objednávku (+${pctDiff}%). Tvoří ${b2bRevShare}% vašeho obratu.`,
        action: `💡 Doporučení: Rozšiřte B2B marketing - firemní landing pages, množstevní slevy, fakturace na IČO. Zvažte dedikovaného B2B obchodníka.`,
        type: 'success'
      };
    } else {
      return {
        title: `👤 B2C zákazníci překvapují`,
        main: `Spotřebitelé utrácí o ${formatCurrency(diff)} více než firmy. B2B tvoří jen ${b2bRevShare}% obratu.`,
        action: `💡 Doporučení: Váš produkt rezonuje s koncovými zákazníky. Zvažte influencer marketing a recenze na Heureka.`,
        type: 'info'
      };
    }
  }, [b2bStats]);

  const userInitials = (user?.email || 'RM')
    .split('@')[0]
    .split(/[._-]+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'RM';

  const navigateToTab = (id) => {
    setTab(id);
    setMobileMenuOpen(false);
  };

  const navContent = (
    <>
      {NAV_GROUPS.map((group) => {
        const items = allowedTabs.filter((item) => item.group === group.id);
        if (!items.length) return null;
        return (
          <div key={group.id} className="rm-nav-group">
            <div className="rm-nav-group-label">{group.label}</div>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateToTab(item.id)}
                className={`rm-nav-item ${tab === item.id ? 'rm-nav-item--active' : ''}`}
              >
                <span className="rm-nav-icon"><IconPath type={item.icon} /></span>
                <span className="rm-nav-label">{item.l}</span>
              </button>
            ))}
          </div>
        );
      })}
    </>
  );

  const countryOptions = [
    { c: 'all', n: 'Vše' },
    { c: 'cz', n: 'CZ' },
    { c: 'sk', n: 'SK' },
    { c: 'hu', n: 'HU' },
    { c: 'ro', n: 'RO' },
  ];
  const customRangeSummary = `${formatShortDateLabel(dateFrom)} – ${formatShortDateLabel(dateTo)}`;
  const isCustomRangeActive = activePreset === null;

  if (authLoading) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
    </div>
  );

  if (!user) return <LoginPage onLogin={handleLogin} error={authError} />;

  if (!access.hasAccess) return <NoAccessPage user={user} onLogout={handleLogout} />;

  if (error) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
      <div className="text-center bg-white p-8 rounded-2xl shadow-lg">
        <div className="text-red-500 text-4xl mb-4">⚠️</div>
        <p className="font-bold text-slate-800 text-lg">Chyba načítání</p>
        <p className="text-slate-500 mt-2">{error}</p>
      </div>
    </div>
  );

  return (
    <div className="rm-app">
      {loading && <LoadingOverlay message={loadingMessage} />}

      <aside className="rm-sidebar">
        <div className="rm-brand">
          <div className="rm-logo">RM</div>
          <div>
            <div className="rm-brand-name">RM Orders</div>
            <div className="rm-brand-sub">Regal Master</div>
          </div>
        </div>
        <nav className="rm-sidebar-nav">{navContent}</nav>
        <div className="rm-sidebar-footer">
          <div className="rm-health-line"><span className="rm-health-dot" />Sync <strong>OK</strong></div>
          <div className="rm-health-meta">Upgates · Ads · Fio · KN</div>
        </div>
      </aside>

      <div className="rm-main">
        <header className="rm-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" className="rm-btn rm-btn--ghost rm-btn--icon rm-menu-btn" onClick={() => setMobileMenuOpen(true)}>
              <IconPath type="menu" />
            </button>
            <div className="rm-title-wrap">
              <div className="rm-title">{currentPageMeta?.l || 'Order Analytics'}</div>
              <div className="rm-subtitle">{currentPageMeta?.sub || 'REGAL MASTER - Analýza objednávek'}</div>
            </div>
          </div>
          <div className="rm-topbar-actions">
            <button type="button" className="rm-btn rm-hide-mobile" onClick={() => setRefreshTick((value) => value + 1)}>
              <IconPath type="refresh" />Obnovit
            </button>
            <button type="button" className="rm-btn rm-btn--ghost rm-btn--icon" onClick={handleLogout} title="Odhlásit">
              <IconPath type="logout" />
            </button>
            <div className="rm-user">
              <div className="rm-user-avatar">{userInitials}</div>
              <div className="rm-user-meta">
                <div className="rm-user-name">{user.email?.split('@')[0] || 'Uživatel'}</div>
                <div className="rm-user-email">{user.email}</div>
              </div>
            </div>
          </div>
        </header>

        {showFilterBar && (
          <div className={`rm-filterbar ${customRangeOpen ? 'rm-filterbar--range-open' : ''}`}>
            <div className="rm-filterbar-main">
              <div className="rm-filter-group">
                <span className="rm-filter-label">Období</span>
                <div className="rm-segmented">
                  {[
                    ['today', 'Dnes'],
                    ['yesterday', 'Včera'],
                    ['this_week', 'Týden'],
                    ['this_month', 'Měsíc'],
                    ['last_30', '30 dní'],
                  ].map(([preset, label]) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className={`rm-segmented-btn ${activePreset === preset ? 'rm-segmented-btn--active' : ''}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className={`rm-range-toggle ${customRangeOpen || isCustomRangeActive ? 'rm-range-toggle--active' : ''}`}
                onClick={() => setCustomRangeOpen((open) => !open)}
                aria-expanded={customRangeOpen}
                aria-controls="rm-custom-date-range"
              >
                <IconPath type="calendar" />
                <span className="rm-range-label-desktop">Vlastní rozsah</span>
                <span className="rm-range-label-mobile">Kalendář</span>
                <span className="rm-range-toggle-dates">{customRangeSummary}</span>
              </button>
              <div className="rm-date-range-inline" aria-label="Vlastní období">
                <label className="rm-date-field">
                  <span>Od</span>
                  <input
                    className="rm-date-input"
                    type="date"
                    value={dateFrom}
                    onInput={(e) => handleDateChange('from', e.currentTarget.value)}
                    onChange={(e) => handleDateChange('from', e.target.value)}
                    aria-label="Datum od"
                  />
                </label>
                <label className="rm-date-field">
                  <span>Do</span>
                  <input
                    className="rm-date-input"
                    type="date"
                    value={dateTo}
                    onInput={(e) => handleDateChange('to', e.currentTarget.value)}
                    onChange={(e) => handleDateChange('to', e.target.value)}
                    aria-label="Datum do"
                  />
                </label>
              </div>
              <div className="rm-filter-sep" />
              <div className="rm-filter-group rm-country-filter">
                <span className="rm-filter-label">Země</span>
                <div className="rm-segmented">
                  {countryOptions.map((item) => (
                    <button
                      key={item.c}
                      type="button"
                      onClick={() => setCountry(item.c)}
                      className={`rm-segmented-btn ${country === item.c ? 'rm-segmented-btn--active' : ''}`}
                    >
                      {item.n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rm-filter-auto">
                <span>auto-refresh 1 min</span>
                <span className="rm-health-dot" />
              </div>
            </div>
            {customRangeOpen && (
              <div id="rm-custom-date-range" className="rm-date-range-panel">
                <label className="rm-date-field">
                  <span>Od</span>
                  <input
                    className="rm-date-input"
                    type="date"
                    value={dateFrom}
                    onInput={(e) => handleDateChange('from', e.currentTarget.value)}
                    onChange={(e) => handleDateChange('from', e.target.value)}
                    aria-label="Datum od"
                  />
                </label>
                <label className="rm-date-field">
                  <span>Do</span>
                  <input
                    className="rm-date-input"
                    type="date"
                    value={dateTo}
                    onInput={(e) => handleDateChange('to', e.currentTarget.value)}
                    onChange={(e) => handleDateChange('to', e.target.value)}
                    aria-label="Datum do"
                  />
                </label>
                <span className="rm-date-range-hint">Vlastní období se použije hned po změně data.</span>
              </div>
            )}
          </div>
        )}

        <main className="rm-page">
          {dataWarning && <div className="rm-alert rm-alert--warn">{dataWarning}</div>}
          {canUseAds && adsSummary.warnings?.length > 0 && (
            <div className="rm-alert rm-alert--danger">{adsSummary.warnings.join(' ')}</div>
          )}

          {tab === OVERVIEW_TAB_ID && showDashboardControls && (
            <>
              <div className="rm-alert">
                <span className="rm-badge"><span className="rm-badge-dot" />Business-clean</span>
                <span>Bez DPH a poštovného. Vyloučené STORNO a selhané platby.</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="rm-health-dot" />Sync OK
                </span>
              </div>

              <div className="rm-kpi-grid">
                <KPICard title="Objednávky" value={formatNumber(kpis.orders)} />
                <KPICard title="Obrat (bez DPH)" value={formatCurrency(kpis.revenue)} sub={adsPnoSub} subTone={hasAdsData ? 'red' : 'muted'} />
                <KPICard title="Ø Objednávka" value={formatCurrency(kpis.aov)} />
                <KPICard title="Tržba z poštovného" value={formatCurrency(kpis.shippingRevenue)} sub="bez DPH, mimo PNO" />
                <KPICard title="Ads spend" value={adsSummary.loading ? '…' : adsSummary.error ? '—' : formatCurrency(adsSummary.spend)} sub={adsBreakdownSub} subTone={hasAdsData ? 'red' : 'muted'} />
              </div>

              {canUseAds && <AdsKpiStrip summary={adsSummary} revenue={kpis.revenue} revenueByMarket={revenueByMarket} onOpenAds={() => setTab(MODULE_IDS.ADS)} />}
            </>
          )}

          {tab !== OVERVIEW_TAB_ID && (
            <div className="rm-module-card">
          {tab === MODULE_IDS.HEATMAP && canUseHeatmap && (
            <>
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">Heatmapa: {groupDays ? 'Hodiny (seskupené)' : 'Den × Hodina'}</h2>
                  <p className="text-sm text-slate-500">Klikni na buňku pro detail</p>
                </div>
                <div className="flex gap-2 items-center">
                  <button
                    onClick={() => setGroupDays(!groupDays)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      groupDays 
                        ? 'bg-purple-500 text-white shadow-sm' 
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {groupDays ? '📊 Seskupené' : '📅 Po dnech'}
                  </button>
                  <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                    {[
                      { c: 'orders', l: 'Objednávky' }, 
                      { c: 'revenue', l: 'Obrat' }, 
                      { c: 'aov', l: 'AOV' }
                    ].map(m => (
                      <button 
                        key={m.c} 
                        onClick={() => setMetric(m.c)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                          metric === m.c 
                            ? 'bg-white shadow text-slate-800' 
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {m.l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <Heatmap 
                data={heatmap} 
                metric={metric} 
                onClick={(d, h, data) => setCell({ d, h, data })} 
                groupDays={groupDays}
                activeDays={activeDays}
              />
              {cell && (
                <div className="mt-4 p-4 bg-blue-50 rounded-xl border border-blue-200">
                  <div className="font-semibold text-blue-800 mb-2">
                    {cell.d !== null ? `${DAYS_FULL[cell.d]} ` : ''}{cell.h}:00 - {cell.h}:59
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-blue-600">Objednávky:</span>
                      <span className="font-bold ml-2">{cell.data?.orders || 0}</span>
                    </div>
                    <div>
                      <span className="text-blue-600">Obrat:</span>
                      <span className="font-bold ml-2">{formatCurrency(cell.data?.revenue || 0)}</span>
                    </div>
                    <div>
                      <span className="text-blue-600">Ø AOV:</span>
                      <span className="font-bold ml-2">{formatCurrency(cell.data?.aov || 0)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-6 rounded-xl border border-slate-200 overflow-hidden">
                <button
                  onClick={() => setShowTimeline(prev => !prev)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-all"
                >
                  <div className="text-left">
                    <h3 className="text-sm font-semibold text-slate-800">📈 Časová osa objednávek a obratu</h3>
                    <p className="text-xs text-slate-500">
                      {timelineSeries.mode === 'hour' ? '1 den: zobrazení po hodinách' : 'Více dní: zobrazení po dnech'}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-slate-600">
                    {showTimeline ? 'Skrýt' : 'Zobrazit'}
                  </span>
                </button>

                {showTimeline && (
                  <div className="border-t border-slate-200 p-4 bg-white">
                    {!timelineSeries.validRange ? (
                      <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                        Neplatný rozsah data. Datum OD musí být menší nebo stejné jako datum DO.
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2 mb-4">
                          <div className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700">
                            Režim: {timelineSeries.mode === 'hour' ? 'Po hodinách' : 'Po dnech'}
                          </div>
                          <div className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                            Objednávky: {formatNumber(timelineSeries.totals.orders)}
                          </div>
                          <div className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                            Obrat: {formatCurrency(timelineSeries.totals.revenue)}
                          </div>
                          <div className="px-2.5 py-1 rounded-lg bg-orange-50 border border-orange-200 text-xs text-orange-700">
                            Poštovné: {formatCurrency(timelineSeries.totals.shippingRevenue)}
                          </div>
                        </div>

                        <div className="h-72 rounded-lg border border-slate-200 bg-slate-50 p-2">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={timelineSeries.data} margin={{ top: 14, right: 18, left: 8, bottom: 6 }}>
                              <defs>
                                <linearGradient id="ordersGradient" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.85} />
                                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.25} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis
                                dataKey="label"
                                tick={{ fontSize: 11, fill: '#64748b' }}
                                minTickGap={timelineSeries.mode === 'hour' ? 6 : 20}
                              />
                              <YAxis
                                yAxisId="orders"
                                allowDecimals={false}
                                tick={{ fontSize: 11, fill: '#64748b' }}
                              />
                              <YAxis
                                yAxisId="revenue"
                                orientation="right"
                                tickFormatter={formatAxisCurrency}
                                tick={{ fontSize: 11, fill: '#64748b' }}
                              />
                              <RechartsTooltip
                                content={({ active, payload }) => (
                                  <TimelineTooltip active={active} payload={payload} mode={timelineSeries.mode} />
                                )}
                              />
                              <Legend wrapperStyle={{ fontSize: '12px' }} />
                              <Bar
                                yAxisId="orders"
                                dataKey="orders"
                                name="Objednávky"
                                fill="url(#ordersGradient)"
                                radius={[6, 6, 0, 0]}
                              />
                              <Line
                                yAxisId="revenue"
                                type="monotone"
                                dataKey="revenue"
                                name="Obrat (Kč)"
                                stroke="#0f766e"
                                strokeWidth={2.5}
                                dot={false}
                                activeDot={{ r: 4 }}
                              />
                              <Line
                                yAxisId="revenue"
                                type="monotone"
                                dataKey="shippingRevenue"
                                name="Poštovné (Kč)"
                                stroke="#f97316"
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 4 }}
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>

                        <div className="mt-4 rounded-lg border border-slate-200 overflow-hidden">
                          <div className="max-h-56 overflow-auto">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                                <tr>
                                  <th className="text-left px-3 py-2 font-semibold">{timelineSeries.mode === 'hour' ? 'Hodina' : 'Den'}</th>
                                  <th className="text-right px-3 py-2 font-semibold">Objednávky</th>
                                  <th className="text-right px-3 py-2 font-semibold">Obrat (bez DPH/poštovného)</th>
                                  <th className="text-right px-3 py-2 font-semibold">Tržba z poštovného</th>
                                </tr>
                              </thead>
                              <tbody>
                                {timelineSeries.data.map((row) => (
                                  <tr key={row.id} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                                    <td className="px-3 py-2 text-slate-700">{timelineSeries.mode === 'hour' ? row.fullLabel : row.fullDate}</td>
                                    <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.orders)}</td>
                                    <td className="px-3 py-2 text-right font-medium text-slate-800">{formatCurrency(row.revenue)}</td>
                                    <td className="px-3 py-2 text-right font-medium text-orange-700">{formatCurrency(row.shippingRevenue)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="mt-4 rounded-lg border border-slate-200 overflow-hidden">
                          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                            <h4 className="text-xs font-semibold text-slate-700">Tržba z poštovného podle dne a země</h4>
                          </div>
                          <div className="max-h-64 overflow-auto">
                            <table className="min-w-[620px] w-full text-xs">
                              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                                <tr>
                                  <th className="text-left px-3 py-2 font-semibold">Den</th>
                                  <th className="text-left px-3 py-2 font-semibold">Země</th>
                                  <th className="text-right px-3 py-2 font-semibold">Obj.</th>
                                  <th className="text-right px-3 py-2 font-semibold">Obrat zboží</th>
                                  <th className="text-right px-3 py-2 font-semibold">Tržba z poštovného</th>
                                </tr>
                              </thead>
                              <tbody>
                                {timelineMarketBreakdown.map((row) => (
                                  <tr key={row.key} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                                    <td className="px-3 py-2 text-slate-700">{row.fullDate}</td>
                                    <td className="px-3 py-2 font-medium text-slate-800">{MARKET_LABELS[row.market] || row.market}</td>
                                    <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.orders)}</td>
                                    <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.revenue)}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-orange-700">{formatCurrency(row.shippingRevenue)}</td>
                                  </tr>
                                ))}
                                {!timelineMarketBreakdown.length && (
                                  <tr>
                                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500">Pro zvolené filtry nejsou dostupná data.</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === MODULE_IDS.TEMPO && canUseTempo && (
            <>
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">⏱ Tempo dne: kdy dosáhneme 50 % výkonu</h2>
                  <p className="text-sm text-slate-500">
                    Měříme kumulativní podíl objednávek a obratu v průběhu dne. Obrat je vždy bez DPH a poštovného.
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Respektuje aktivní filtr data a filtr země nahoře na stránce.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={tempoMarket}
                    onChange={(e) => setTempoMarket(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="all">Všechny země</option>
                    {tempoAvailableMarkets.map((m) => (
                      <option key={m} value={m}>
                        {MARKET_LABELS[m] || m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!tempoDaySeries.length ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  Pro zvolené filtry nejsou dostupná data. Zkuste širší rozsah v horním datepickeru.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs text-slate-500 mb-1">Analyzovaných dnů (z datepickeru)</div>
                      <div className="text-2xl font-bold text-slate-800">{formatNumber(tempoSummary.days)}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs text-slate-500 mb-1">Medián H50 objednávky</div>
                      <div className="text-2xl font-bold text-slate-800">{formatHourValue(tempoSummary.h50OrdersMedian)}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs text-slate-500 mb-1">Medián H50 obrat</div>
                      <div className="text-2xl font-bold text-slate-800">{formatHourValue(tempoSummary.h50RevenueMedian)}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs text-slate-500 mb-1">Medián rozdílu (obrat - obj.)</div>
                      <div className="text-2xl font-bold text-slate-800">
                        {tempoSummary.deltaMedian == null ? '—' : `${tempoSummary.deltaMedian > 0 ? '+' : ''}${tempoSummary.deltaMedian.toFixed(1)} h`}
                      </div>
                    </div>
                  </div>

                  {tempoSelectedRecord && (
                    <div className="rounded-xl border border-slate-200 p-4 mb-5">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-4">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-800">
                            Detail dne: {tempoSelectedRecord.fullDate} • {MARKET_LABELS[tempoMarket] || tempoMarket}
                          </h3>
                          <p className="text-xs text-slate-500">
                            {tempoSelectedRecord.weekdayLabel} • {formatNumber(tempoSelectedRecord.ordersTotal)} objednávek • {formatCurrency(tempoSelectedRecord.revenueTotal)} obratu
                            {tempoMarket === 'all' && ` • Agregace ${tempoSelectedRecord.marketsCount} zemí`}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <div className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700">
                            H50 objednávky: {formatHourValue(tempoSelectedRecord.h50Orders)}
                          </div>
                          <div className="px-2.5 py-1 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-700">
                            H50 obrat: {formatHourValue(tempoSelectedRecord.h50Revenue)}
                          </div>
                          <div className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                            Δ: {tempoSelectedRecord.deltaH50 == null ? '—' : `${tempoSelectedRecord.deltaH50 > 0 ? '+' : ''}${tempoSelectedRecord.deltaH50} h`}
                          </div>
                        </div>
                      </div>

                      <div className="h-72 rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={tempoSelectedRecord.hourly} margin={{ top: 12, right: 16, left: 8, bottom: 6 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis
                              type="number"
                              dataKey="hour"
                              domain={[0, 23]}
                              ticks={[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]}
                              tickFormatter={(h) => String(h).padStart(2, '0')}
                              tick={{ fontSize: 11, fill: '#64748b' }}
                            />
                            <YAxis
                              domain={[0, 100]}
                              tickFormatter={(v) => `${v}%`}
                              tick={{ fontSize: 11, fill: '#64748b' }}
                            />
                            <ReferenceLine y={50} stroke="#94a3b8" strokeDasharray="5 5" label={{ value: '50 %', fill: '#64748b', position: 'insideTopRight' }} />
                            {tempoSelectedRecord.h50Orders != null && (
                              <ReferenceLine
                                x={tempoSelectedRecord.h50Orders}
                                stroke="#2563eb"
                                strokeDasharray="4 4"
                                label={{ value: `H50 obj ${formatHourValue(tempoSelectedRecord.h50Orders)}`, fill: '#2563eb', position: 'insideBottomLeft' }}
                              />
                            )}
                            {tempoSelectedRecord.h50Revenue != null && (
                              <ReferenceLine
                                x={tempoSelectedRecord.h50Revenue}
                                stroke="#0f766e"
                                strokeDasharray="4 4"
                                label={{ value: `H50 obrat ${formatHourValue(tempoSelectedRecord.h50Revenue)}`, fill: '#0f766e', position: 'insideTopLeft' }}
                              />
                            )}
                            <RechartsTooltip content={({ active, payload }) => <TempoCurveTooltip active={active} payload={payload} />} />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            <Line
                              type="monotone"
                              dataKey="cumOrdersPct"
                              name="Kumulativní objednávky (%)"
                              stroke="#2563eb"
                              strokeWidth={2.5}
                              dot={false}
                              activeDot={{ r: 4 }}
                            />
                            <Line
                              type="monotone"
                              dataKey="cumRevenuePct"
                              name="Kumulativní obrat (%)"
                              stroke="#0f766e"
                              strokeWidth={2.5}
                              dot={false}
                              activeDot={{ r: 4 }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="mt-4 rounded-lg border border-slate-200 overflow-hidden">
                        <div className="max-h-52 overflow-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-slate-100 text-slate-600">
                              <tr>
                                <th className="text-left px-3 py-2 font-semibold">Hodina</th>
                                <th className="text-right px-3 py-2 font-semibold">Obj. v hodině (%)</th>
                                <th className="text-right px-3 py-2 font-semibold">Obrat v hodině (%)</th>
                                <th className="text-right px-3 py-2 font-semibold">Kumul. obj. (%)</th>
                                <th className="text-right px-3 py-2 font-semibold">Kumul. obrat (%)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tempoSelectedRecord.hourly.map((row) => (
                                <tr key={row.hour} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                                  <td className="px-3 py-2 text-slate-700">{row.label}</td>
                                  <td className="px-3 py-2 text-right text-slate-700">{formatPercent(row.ordersSharePct)}</td>
                                  <td className="px-3 py-2 text-right text-slate-700">{formatPercent(row.revenueSharePct)}</td>
                                  <td className="px-3 py-2 text-right text-slate-700">{formatPercent(row.cumOrdersPct)}</td>
                                  <td className="px-3 py-2 text-right font-medium text-slate-800">{formatPercent(row.cumRevenuePct)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-200 overflow-hidden mb-5">
                    <button
                      onClick={() => setShowTempoHistory((prev) => !prev)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-all"
                    >
                      <div className="text-left">
                        <h3 className="text-sm font-semibold text-slate-800">📊 H50 po dnech ve zvoleném období</h3>
                        <p className="text-xs text-slate-500">Každý den = jeden sloupec. Kliknutím na den vybereš detail nahoře.</p>
                      </div>
                      <span className="text-xs font-medium text-slate-600">{showTempoHistory ? 'Skrýt' : 'Zobrazit'}</span>
                    </button>

                    {showTempoHistory && (
                      <div className="border-t border-slate-200 p-4 bg-white">
                        <div className="h-72 rounded-lg border border-slate-200 bg-slate-50 p-2">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart
                              data={tempoH50ByDayData}
                              margin={{ top: 14, right: 16, left: 8, bottom: 6 }}
                              onClick={(state) => {
                                const record = state?.activePayload?.[0]?.payload;
                                if (record?.key) setTempoSelectedDayKey(record.key);
                              }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="xLabel" tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={14} />
                              <YAxis
                                domain={[0, 23]}
                                ticks={[0, 4, 8, 12, 16, 20, 23]}
                                tickFormatter={(v) => `${String(v).padStart(2, '0')}:00`}
                                tick={{ fontSize: 11, fill: '#64748b' }}
                              />
                              <RechartsTooltip content={({ active, payload }) => <TempoTrendTooltip active={active} payload={payload} />} />
                              <Legend wrapperStyle={{ fontSize: '12px' }} />
                              <Bar
                                dataKey="h50Orders"
                                name="H50 objednávky"
                                fill="#2563eb"
                                radius={[4, 4, 0, 0]}
                              />
                              <Bar
                                dataKey="h50Revenue"
                                name="H50 obrat"
                                fill="#0f766e"
                                radius={[4, 4, 0, 0]}
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>

                        <div className="mt-4 rounded-lg border border-slate-200 overflow-hidden">
                          <div className="max-h-56 overflow-auto">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                                <tr>
                                  <th className="text-left px-3 py-2 font-semibold">Datum</th>
                                  <th className="text-right px-3 py-2 font-semibold">H50 obj.</th>
                                  <th className="text-right px-3 py-2 font-semibold">H50 obrat</th>
                                  <th className="text-right px-3 py-2 font-semibold">Objednávky</th>
                                  <th className="text-right px-3 py-2 font-semibold">Obrat</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...tempoH50ByDayData].reverse().map((row) => (
                                  <tr
                                    key={row.key}
                                    onClick={() => setTempoSelectedDayKey(row.key)}
                                    className={`border-t border-slate-100 cursor-pointer hover:bg-blue-50 ${
                                      tempoSelectedRecord?.key === row.key ? 'bg-blue-50/70' : 'odd:bg-white even:bg-slate-50/60'
                                    }`}
                                  >
                                    <td className="px-3 py-2 text-slate-700">{row.fullDate} ({row.weekdayLabel})</td>
                                    <td className="px-3 py-2 text-right text-slate-700">{formatHourValue(row.h50Orders)}</td>
                                    <td className="px-3 py-2 text-right text-slate-700">{formatHourValue(row.h50Revenue)}</td>
                                    <td className="px-3 py-2 text-right font-medium text-slate-800">{formatNumber(row.ordersTotal)}</td>
                                    <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.revenueTotal)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <h3 className="text-sm font-semibold text-slate-800 mb-1">🧭 Porovnání dnů v týdnu × země (medián H50)</h3>
                    <p className="text-xs text-slate-500 mb-3">
                      Každá buňka ukazuje medián času dosažení 50 % objednávek (Obj) a 50 % obratu (Obrat). Čím pozdější hodina, tím je tempo dne pomalejší.
                    </p>
                    {!tempoMatrixRows.length ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                        Pro zvolené filtry není dost dat pro matici porovnání.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-[760px] w-full text-xs border-separate border-spacing-1">
                          <thead>
                            <tr className="text-slate-500">
                              <th className="text-left px-2 py-1 font-semibold">Země</th>
                              <th className="text-center px-2 py-1 font-semibold">Po</th>
                              <th className="text-center px-2 py-1 font-semibold">Út</th>
                              <th className="text-center px-2 py-1 font-semibold">St</th>
                              <th className="text-center px-2 py-1 font-semibold">Čt</th>
                              <th className="text-center px-2 py-1 font-semibold">Pá</th>
                              <th className="text-center px-2 py-1 font-semibold">So</th>
                              <th className="text-center px-2 py-1 font-semibold">Ne</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tempoMatrixRows.map((row) => (
                              <tr key={row.market}>
                                <td className="px-2 py-2 text-slate-700 font-medium">{MARKET_LABELS[row.market] || row.market}</td>
                                {row.cells.map((cell) => (
                                  <td key={`${row.market}-${cell.weekday}`} className="px-1 py-1">
                                    <div className={`rounded-lg border px-2 py-1.5 text-center ${getH50CellClass(cell.h50Revenue ?? cell.h50Orders)}`}>
                                      {cell.count ? (
                                        <>
                                          <div className="font-semibold">Obj {formatHourValue(cell.h50Orders)}</div>
                                          <div>Obrat {formatHourValue(cell.h50Revenue)}</div>
                                          <div className="opacity-75">n={cell.count}</div>
                                        </>
                                      ) : (
                                        <div className="font-semibold">—</div>
                                      )}
                                    </div>
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {tab === MODULE_IDS.GEO && canUseGeo && (
            <>
              <h2 className="text-lg font-semibold text-slate-800 mb-2">🏙️ Velká města vs 🏘️ Menší města</h2>
              <p className="text-sm text-slate-500 mb-4">
                <strong>Velká města</strong> = krajská města + města nad 50 000 obyvatel<br/>
                <strong>Menší města</strong> = ostatní obce a města
              </p>
              <CompareCard
                t1="Velká města" v1={geoStats.big.aov} c1={geoStats.big.o} r1={geoStats.big.r}
                t2="Menší města" v2={geoStats.small.aov} c2={geoStats.small.o} r2={geoStats.small.r}
                i1="🏙️" i2="🏘️"
                desc1="Praha, Brno, Ostrava, Plzeň..."
                desc2="Ostatní obce a města"
              />
              
              <InsightBox type={geoInsight.type}>
                <p className="font-semibold mb-1">{geoInsight.title}</p>
                <p className="text-sm mb-2">{geoInsight.main}</p>
                <p className="text-sm font-medium">{geoInsight.action}</p>
              </InsightBox>

              <div className="mt-6">
                <h3 className="text-sm font-semibold text-slate-700 mb-1">🏆 Top menší města podle AOV</h3>
                <p className="text-xs text-slate-400 mb-3">Menší města (mimo krajská) s nejvyšší průměrnou objednávkou. Min. 2 objednávky, bez DPH a poštovného.</p>
                <div className="space-y-2">
                  {geoStats.top.map((c, i) => (
                    <div key={i} className="flex justify-between items-center bg-slate-50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400 text-sm w-5">{i + 1}.</span>
                        <span className="font-medium">{c.n}</span>
                        <span className="text-slate-400 text-sm">({c.o} obj)</span>
                      </div>
                      <span className="font-bold text-slate-800">{formatCurrency(c.aov)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === MODULE_IDS.FINANCE && canUseFinance && (
            <FinanceModule supabaseUrl={SUPABASE_URL} supabaseKey={SUPABASE_KEY} userEmail={user?.email} />
          )}

          {tab === MODULE_IDS.MARGIN && canUseMargin && (
            <MarginModule orders={filtered} dateFrom={dateFrom} dateTo={dateTo} country={country} qualityWarning={marginDataWarning} />
          )}

          {tab === MODULE_IDS.ADS && canUseAds && (
            <AdsModule supabaseClient={supabase} dateFrom={dateFrom} dateTo={dateTo} country={country} orders={filtered} />
          )}

          {tab === MODULE_IDS.PRODUCTS && canUseProducts && (
            <ProductsModule
              supabaseClient={supabase}
              supabaseUrl={SUPABASE_URL}
              supabaseKey={SUPABASE_KEY}
              country={country}
              orders={filtered}
            />
          )}

          {tab === MODULE_IDS.IMPORT_LOGISTICS && canUseImportLogistics && (
            <ModuleErrorBoundary label="Importní logistika">
              <ImportLogisticsModule
                supabaseClient={supabase}
                supabaseUrl={SUPABASE_URL}
                supabaseKey={SUPABASE_KEY}
                canLoadSalesHistory={!access.isLogisticsOnly}
                canUploadDocuments={access.canUploadImportDocuments}
              />
            </ModuleErrorBoundary>
          )}

          {tab === MODULE_IDS.POKEC && canUsePokec && (
            <PokecModule
              supabaseClient={supabase}
              dateFrom={dateFrom}
              dateTo={dateTo}
              country={country}
              userEmail={user?.email}
            />
          )}

          {tab === MODULE_IDS.B2B && canUseB2b && (
            <>
              <h2 className="text-lg font-semibold text-slate-800 mb-2">🏢 B2B vs 👤 B2C analýza</h2>
              <p className="text-sm text-slate-500 mb-4">
                <strong>B2B</strong> = objednávky na IČO (firemní zákazníci)<br/>
                <strong>B2C</strong> = koncový spotřebitelé (bez IČO)
              </p>
              <CompareCard
                t1="B2B (firmy)" v1={b2bStats.b2b.aov} c1={b2bStats.b2b.o} r1={b2bStats.b2b.r}
                t2="B2C (spotřebitelé)" v2={b2bStats.b2c.aov} c2={b2bStats.b2c.o} r2={b2bStats.b2c.r}
                i1="🏢" i2="👤"
                desc1="Objednávky na IČO"
                desc2="Koncový spotřebitelé"
              />
              
              <div className="grid grid-cols-2 gap-4 mt-6">
                <div className="bg-blue-50 rounded-xl p-4 text-center border border-blue-200">
                  <div className="text-sm text-blue-600 mb-1">B2B celkový obrat</div>
                  <div className="text-2xl font-bold text-blue-800">
                    {formatCurrency(b2bStats.b2b.r)}
                  </div>
                  <div className="text-xs text-blue-500 mt-1">
                    {(b2bStats.b2b.r / (b2bStats.b2b.r + b2bStats.b2c.r) * 100 || 0).toFixed(0)}% z celku
                  </div>
                </div>
                <div className="bg-green-50 rounded-xl p-4 text-center border border-green-200">
                  <div className="text-sm text-green-600 mb-1">B2C celkový obrat</div>
                  <div className="text-2xl font-bold text-green-800">
                    {formatCurrency(b2bStats.b2c.r)}
                  </div>
                  <div className="text-xs text-green-500 mt-1">
                    {(b2bStats.b2c.r / (b2bStats.b2b.r + b2bStats.b2c.r) * 100 || 0).toFixed(0)}% z celku
                  </div>
                </div>
              </div>

              <InsightBox type={b2bInsight.type}>
                <p className="font-semibold mb-1">{b2bInsight.title}</p>
                <p className="text-sm mb-2">{b2bInsight.main}</p>
                <p className="text-sm font-medium">{b2bInsight.action}</p>
              </InsightBox>
            </>
          )}
            </div>
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-slate-400 mb-1">
              {formatNumber(filtered.length)} objednávek • Live data ze Supabase •
              Aktualizace: {new Date().toLocaleString('cs-CZ')}
            </p>
            <p className="text-xs text-slate-300 italic">
              🚀 Tady taky stavíme impérium :)
            </p>
          </div>
        </main>
      </div>

      <button
        type="button"
        aria-label="Zavřít menu"
        className={`rm-sheet-bg ${mobileMenuOpen ? 'rm-sheet-bg--open' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />
      <aside className={`rm-sheet ${mobileMenuOpen ? 'rm-sheet--open' : ''}`} aria-hidden={!mobileMenuOpen}>
        <div className="rm-brand">
          <div className="rm-logo">RM</div>
          <div className="min-w-0 flex-1">
            <div className="rm-brand-name">RM Orders</div>
            <div className="rm-brand-sub">Regal Master</div>
          </div>
          <button
            type="button"
            className="rm-btn rm-btn--ghost rm-btn--icon"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Zavřít navigaci"
          >
            <IconPath type="x" />
          </button>
        </div>
        <nav className="rm-sidebar-nav">{navContent}</nav>
      </aside>
    </div>
  );
}
