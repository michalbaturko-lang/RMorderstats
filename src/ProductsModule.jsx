import React, { useEffect, useMemo, useState } from 'react';
import {
  attachPurchasePriceLookup,
  buildPurchasePriceLookup,
  getOrderLineItems,
  getLineBuyPriceWithoutVat,
  getLineQuantity,
  getLineRevenueWithoutVat,
  getLineUnitPriceWithoutVat,
} from './orderLineItems';
import { isExcludedBusinessOrder } from './businessOrderStatus';

const MARKET_CONFIG = {
  cz: { label: 'Česko', currency: 'CZK', priceField: 'price_cz', nameField: 'name_cz' },
  sk: { label: 'Slovensko', currency: 'EUR', priceField: 'price_sk', nameField: 'name_sk' },
  hu: { label: 'Maďarsko', currency: 'HUF', priceField: 'price_hu', nameField: 'name_hu' },
  ro: { label: 'Rumunsko', currency: 'RON', priceField: null, nameField: 'name_cz' },
};

const MARKET_ORDER = ['cz', 'sk', 'hu', 'ro'];

const SORT_OPTIONS = {
  name: 'name',
  code: 'code',
  ean: 'ean',
  buyPrice: 'buyPrice',
  sellPrice: 'sellPrice',
  stock: 'stock',
  marginPct: 'marginPct',
  syncedAt: 'syncedAt',
};

const BUY_PRICE_SOURCE_NOTE = 'Nákupka a marže používají kanonické UpGates nákupky; objednávkový snapshot je až fallback.';
const ALL_MARKETS_NOTE = 'V režimu „Všechny země“ rozepisujeme nákupku, prodejní cenu i marži zvlášť pro každý stát podle objednávek za posledních 90 dní.';

const toNumber = (value) => {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
};

const formatNumber = (value) => Math.round(value || 0).toLocaleString('cs-CZ');

const formatKpiValue = (value, loading) => (loading ? '—' : formatNumber(value));

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const formatCurrency = (value, currency) => {
  if (value == null) return '—';
  const formatted = currency === 'HUF'
    ? Math.round(value).toLocaleString('cs-CZ')
    : Number(value).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${currency === 'CZK' ? 'Kč' : currency}`;
};

const formatMargin = (marginPct, marginValue, currency) => {
  if (marginPct == null) return '—';
  return `${marginPct.toFixed(1)} % · ${formatCurrency(marginValue, currency)}`;
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

const compareMaybeNull = (a, b, direction = 'asc') => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a < b) return direction === 'asc' ? -1 : 1;
  if (a > b) return direction === 'asc' ? 1 : -1;
  return 0;
};

const formatDateForInput = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const SortHeader = ({ active, direction, label, onClick, align = 'left' }) => (
  <button
    type="button"
    onClick={onClick}
    className={`group inline-flex items-center gap-1 font-semibold ${align === 'right' ? 'justify-end text-right' : 'text-left'} text-slate-700 hover:text-slate-900`}
  >
    <span>{label}</span>
    <span className={`text-xs ${active ? 'text-blue-600' : 'text-slate-300 group-hover:text-slate-500'}`}>
      {active ? (direction === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  </button>
);

const marginClass = (marginPct) => {
  if (marginPct == null) return 'text-slate-400';
  if (marginPct >= 60) return 'font-semibold text-emerald-700';
  if (marginPct >= 40) return 'font-semibold text-amber-700';
  return 'font-semibold text-red-700';
};

const coverageClass = (rowsMissingBuyPrice, rowsWithBuyPrice) => {
  if (!rowsMissingBuyPrice) return 'text-slate-400';
  if (!rowsWithBuyPrice) return 'text-red-600';
  return 'text-amber-600';
};

const createEmptyStats = () => ({
  revenueNative: 0,
  costNative: 0,
  quantity: 0,
  rowsWithBuyPrice: 0,
  rowsMissingBuyPrice: 0,
  buyPrices: [],
  sellPrices: [],
  latestSaleAt: null,
});

const getOrderProducts = (order) => {
  return getOrderLineItems(order, { allowRawFallback: false });
};

const getOrderKey = (order) => {
  return String(
    order?.id
      || order?.raw_data?.uuid
      || order?.raw_data?.order_number
      || order?.raw_data?.number
      || `${order?.market || 'unknown'}:${order?.order_date || order?.raw_data?.created_at || ''}`,
  );
};

const mergeOrders = (...orderGroups) => {
  const merged = new Map();

  for (const group of orderGroups) {
    for (const order of group || []) {
      if (!order) continue;
      merged.set(getOrderKey(order), order);
    }
  }

  return Array.from(merged.values());
};

const finalizeStats = (stats) => {
  const marginValue = stats.rowsWithBuyPrice > 0 ? stats.revenueNative - stats.costNative : null;
  const marginPct = stats.rowsWithBuyPrice > 0 && stats.revenueNative > 0
    ? ((stats.revenueNative - stats.costNative) / stats.revenueNative) * 100
    : null;

  return {
    buyPrice: stats.buyPrices.length ? median(stats.buyPrices) : null,
    sellPrice: stats.sellPrices.length ? median(stats.sellPrices) : null,
    marginValue,
    marginPct,
    revenueNative: stats.revenueNative,
    costNative: stats.costNative,
    quantity: stats.quantity,
    rowsWithBuyPrice: stats.rowsWithBuyPrice,
    rowsMissingBuyPrice: stats.rowsMissingBuyPrice,
    latestSaleAt: stats.latestSaleAt,
  };
};

const buildMetricsByCodeFromOrders = (orders) => {
  const byCode = {};

  for (const order of orders || []) {
    if (isExcludedBusinessOrder(order)) continue;

    const market = String(order.market || order.raw_data?.language_id || 'unknown').toLowerCase();
    const currency = MARKET_CONFIG[market]?.currency || order.raw_data?.currency_id || order.raw_data?.currency?.code || order.raw_data?.currency || 'CZK';
    const orderDate = order.order_date || order.raw_data?.creation_time || null;

    for (const product of getOrderProducts(order)) {
      const code = String(product.code || '').trim();
      if (!code) continue;

      const quantity = getLineQuantity(product);
      const lineRevenueNative = getLineRevenueWithoutVat(product);
      const unitSellPriceNative = getLineUnitPriceWithoutVat(product)
        || (quantity > 0 && lineRevenueNative != null && lineRevenueNative > 0 ? (lineRevenueNative / quantity) : null);
      const buyPricePerUnitNative = getLineBuyPriceWithoutVat(product);

      byCode[code] ||= {
        title: product.title || null,
        ean: product.ean || null,
        markets: {},
      };
      byCode[code].markets[market] ||= { currency, raw: createEmptyStats() };

      const marketStats = byCode[code].markets[market];
      marketStats.raw.quantity += quantity;
      if (unitSellPriceNative != null && unitSellPriceNative > 0) {
        marketStats.raw.sellPrices.push(unitSellPriceNative);
      }
      if (orderDate) {
        const incoming = new Date(orderDate).getTime();
        const current = marketStats.raw.latestSaleAt ? new Date(marketStats.raw.latestSaleAt).getTime() : 0;
        if (Number.isFinite(incoming) && incoming > current) {
          marketStats.raw.latestSaleAt = orderDate;
        }
      }

      if (buyPricePerUnitNative != null && buyPricePerUnitNative > 0 && lineRevenueNative != null && lineRevenueNative > 0) {
        marketStats.raw.revenueNative += lineRevenueNative;
        marketStats.raw.costNative += buyPricePerUnitNative * quantity;
        marketStats.raw.rowsWithBuyPrice += 1;
        marketStats.raw.buyPrices.push(buyPricePerUnitNative);
      } else {
        marketStats.raw.rowsMissingBuyPrice += 1;
      }
    }
  }

  return Object.fromEntries(
    Object.entries(byCode).map(([code, value]) => [
      code,
      {
        ...value,
        markets: Object.fromEntries(
          Object.entries(value.markets).map(([market, stats]) => [
            market,
            {
              currency: stats.currency,
              ...finalizeStats(stats.raw),
            },
          ]),
        ),
      },
    ]),
  );
};

const fetchOrdersViaRest = async ({ supabaseUrl, supabaseKey, accessToken, fromDate, toDate }) => {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Chybí Supabase URL nebo anon key pro načtení objednávek.');
  }
  if (!accessToken) throw new Error('Chybí přihlášení pro načtení objednávek.');

  const allRows = [];
  let offset = 0;
  const pageSize = 1000;
  let useAnonymousReadFallback = false;

  while (true) {
    const url =
      `${supabaseUrl}/rest/v1/orders?select=market,order_date,status,raw_data,order_items(order_id,product_code,product_name,quantity,buy_price,unit_price_without_vat,total_price_without_vat,vat_rate,sku,ean)&order_date=gte.${fromDate}T00:00:00&order_date=lte.${toDate}T23:59:59&order=order_date.desc&limit=${pageSize}&offset=${offset}`;
    const requestOptions = (anonymous = useAnonymousReadFallback) => ({
      headers: {
        apikey: supabaseKey,
        ...(anonymous ? {} : { Authorization: `Bearer ${accessToken}` }),
      },
    });
    const response = await fetch(url, requestOptions());

    if (!response.ok) {
      throw new Error(`Orders HTTP ${response.status}`);
    }

    const rows = await response.json();
    let batch = Array.isArray(rows) ? rows : [];
    if (offset === 0 && !useAnonymousReadFallback && batch.length === 0) {
      const anonymousResponse = await fetch(url, requestOptions(true));
      if (anonymousResponse.ok) {
        const anonymousRows = await anonymousResponse.json();
        if (Array.isArray(anonymousRows) && anonymousRows.length > 0) {
          useAnonymousReadFallback = true;
          batch = anonymousRows;
          console.warn('Products: Supabase authenticated RLS returned no orders; using anon read fallback until authenticated read policies are applied.');
        }
      }
    }
    allRows.push(...batch);

    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return allRows.filter((order) => {
    return !isExcludedBusinessOrder(order);
  });
};

const fetchPurchasePriceLookup = async (supabaseClient) => {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseClient
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
};

function AllMarketsMetricCell({ product }) {
  return (
    <div className="grid min-w-[720px] grid-cols-4 gap-3">
      {MARKET_ORDER.map((market) => {
        const stats = product.perMarket[market];
        const marketConfig = MARKET_CONFIG[market];
        const currency = stats?.currency || marketConfig.currency;
        return (
          <div key={market} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{marketConfig.label}</div>
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Nákupka</span>
                <span className="font-medium text-slate-700">{formatCurrency(stats?.buyPrice ?? null, currency)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Prodej</span>
                <span className="font-medium text-slate-700">{formatCurrency(stats?.sellPrice ?? null, currency)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Marže</span>
                <span className={marginClass(stats?.marginPct)}>
                  {formatMargin(stats?.marginPct ?? null, stats?.marginValue ?? null, currency)}
                </span>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-400">
              <span>Prodáno: {formatNumber(stats?.quantity ?? 0)} ks</span>
              <span className={coverageClass(stats?.rowsMissingBuyPrice ?? 0, stats?.rowsWithBuyPrice ?? 0)}>
                {stats?.rowsMissingBuyPrice ? `bez nákupky: ${formatNumber(stats.rowsMissingBuyPrice)}` : 'pokrytí OK'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ProductsModule({ supabaseClient, supabaseUrl, supabaseKey, country, orders = [] }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [products, setProducts] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(SORT_OPTIONS.name);
  const [sortDirection, setSortDirection] = useState('asc');

  useEffect(() => {
    let cancelled = false;

    async function fetchProductsAndOrders() {
      setLoading(true);
      setError('');
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const fromDate = formatDateForInput(ninetyDaysAgo);
      const today = formatDateForInput(new Date());

      const productsPromise = supabaseClient
        .from('products')
        .select('id, code, ean, name_cz, name_sk, name_hu, price_cz, price_sk, price_hu, stock_quantity, synced_at, is_deleted')
        .eq('is_deleted', false)
        .range(0, 4999);

      try {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const accessToken = sessionData?.session?.access_token;

        const [productsResult, ordersResult, purchasePriceLookup] = await Promise.all([
          productsPromise,
          fetchOrdersViaRest({ supabaseUrl, supabaseKey, accessToken, fromDate, toDate: today }),
          fetchPurchasePriceLookup(supabaseClient).catch(() => null),
        ]);
        if (cancelled) return;

        if (productsResult.error) {
          throw productsResult.error;
        }

        const fallbackOrders = Array.isArray(orders) ? orders : [];
        const mergedOrders = attachPurchasePriceLookup(mergeOrders(ordersResult, fallbackOrders), purchasePriceLookup);

        setProducts(Array.isArray(productsResult.data) ? productsResult.data : []);
        setRecentOrders(mergedOrders);
      } catch (fetchError) {
        if (cancelled) return;
        setError(fetchError?.message || 'Produkty se nepodařilo načíst.');
        setProducts([]);
        const fallbackOrders = Array.isArray(orders) ? orders : [];
        setRecentOrders(fallbackOrders);
      }
      if (!cancelled) setLoading(false);
    }

    fetchProductsAndOrders();
    return () => {
      cancelled = true;
    };
  }, [orders, supabaseClient, supabaseKey, supabaseUrl]);

  const isAllMarketsMode = country === 'all';
  const marketKey = isAllMarketsMode ? null : country;
  const marketConfig = marketKey ? (MARKET_CONFIG[marketKey] || MARKET_CONFIG.cz) : null;
  const selectedMarketLabel = isAllMarketsMode ? 'Všechny země' : marketConfig.label;
  const selectedCurrency = marketConfig?.currency || null;
  const roPriceUnavailable = marketKey === 'ro' && !marketConfig.priceField;

  const metricsByCode = useMemo(() => buildMetricsByCodeFromOrders(recentOrders), [recentOrders]);

  const enrichedProducts = useMemo(() => {
    const productMap = new Map(products.map((product) => [product.code || '', product]));
    const allCodes = new Set([
      ...products.map((product) => product.code || ''),
      ...Object.keys(metricsByCode),
    ]);

    return Array.from(allCodes)
      .filter(Boolean)
      .map((code) => {
        const product = productMap.get(code) || {};
        const metrics = metricsByCode[code] || { title: null, ean: null, markets: {} };
        const selectedStats = marketKey ? (metrics.markets[marketKey] || null) : null;
        const perMarket = Object.fromEntries(
          MARKET_ORDER.map((market) => {
            const stats = metrics.markets[market] || null;
            return [market, stats ? {
              currency: stats.currency,
              marginPct: stats.marginPct,
              marginValue: stats.marginValue,
              buyPrice: stats.buyPrice,
              sellPrice: stats.sellPrice,
              quantity: stats.quantity,
              rowsWithBuyPrice: stats.rowsWithBuyPrice,
              rowsMissingBuyPrice: stats.rowsMissingBuyPrice,
            } : null];
          }),
        );

        const localizedName = (marketConfig?.nameField ? product[marketConfig.nameField] : null)
          || product.name_cz
          || product.name_sk
          || product.name_hu
          || metrics.title
          || code
          || 'Bez názvu';

        const catalogPrice = marketConfig?.priceField ? toNumber(product[marketConfig.priceField]) : null;
        const sellPrice = catalogPrice != null && catalogPrice > 0 ? catalogPrice : (selectedStats?.sellPrice ?? null);
        const latestSaleAt = MARKET_ORDER
          .map((market) => metrics.markets[market]?.latestSaleAt)
          .filter(Boolean)
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

        return {
          ...product,
          id: product.id || code,
          code,
          localizedName,
          eanResolved: product.ean || metrics.ean || null,
          sellPrice,
          buyPrice: selectedStats?.buyPrice ?? null,
          marginPct: selectedStats?.marginPct ?? null,
          marginValue: selectedStats?.marginValue ?? null,
          marginCoverageMissing: selectedStats?.rowsMissingBuyPrice ?? 0,
          syncedAt: product.synced_at || latestSaleAt || null,
          perMarket,
          hasCatalogRecord: productMap.has(code),
          latestSaleAt,
        };
      });
  }, [marketConfig?.nameField, marketConfig?.priceField, marketKey, metricsByCode, products]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const baseRows = normalizedQuery
      ? enrichedProducts.filter((product) => {
          const stateMarginText = MARKET_ORDER
            .map((market) => product.perMarket[market]?.marginPct)
            .filter((value) => value != null)
            .join(' ');
          const haystack = [
            product.localizedName,
            product.code,
            product.eanResolved,
            product.buyPrice,
            product.sellPrice,
            product.stock_quantity,
            product.marginPct,
            stateMarginText,
          ]
            .filter((value) => value != null)
            .join(' ')
            .toLowerCase();
          return haystack.includes(normalizedQuery);
        })
      : enrichedProducts;

    const rows = [...baseRows];
    rows.sort((a, b) => {
      switch (sortKey) {
        case SORT_OPTIONS.name:
          return (sortDirection === 'asc' ? 1 : -1) * a.localizedName.localeCompare(b.localizedName, 'cs');
        case SORT_OPTIONS.code:
          return (sortDirection === 'asc' ? 1 : -1) * (a.code || '').localeCompare(b.code || '', 'cs');
        case SORT_OPTIONS.ean:
          return (sortDirection === 'asc' ? 1 : -1) * (a.eanResolved || '').localeCompare(b.eanResolved || '', 'cs');
        case SORT_OPTIONS.buyPrice:
          return compareMaybeNull(a.buyPrice, b.buyPrice, sortDirection);
        case SORT_OPTIONS.sellPrice:
          return compareMaybeNull(a.sellPrice, b.sellPrice, sortDirection);
        case SORT_OPTIONS.stock:
          return compareMaybeNull(toNumber(a.stock_quantity), toNumber(b.stock_quantity), sortDirection);
        case SORT_OPTIONS.marginPct:
          return compareMaybeNull(a.marginPct, b.marginPct, sortDirection);
        case SORT_OPTIONS.syncedAt:
          return compareMaybeNull(
            a.syncedAt ? new Date(a.syncedAt).getTime() : null,
            b.syncedAt ? new Date(b.syncedAt).getTime() : null,
            sortDirection,
          );
        default:
          return 0;
      }
    });

    return rows;
  }, [enrichedProducts, query, sortDirection, sortKey]);

  const latestSync = useMemo(() => {
    const times = enrichedProducts
      .map((product) => (product.syncedAt ? new Date(product.syncedAt).getTime() : null))
      .filter((value) => value != null);
    if (!times.length) return null;
    return new Date(Math.max(...times));
  }, [enrichedProducts]);

  const sortableHeader = (key, label, align = 'left') => (
    <SortHeader
      label={label}
      align={align}
      active={sortKey === key}
      direction={sortDirection}
      onClick={() => {
        if (sortKey === key) {
          setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
          return;
        }
        setSortKey(key);
        setSortDirection(key === SORT_OPTIONS.name ? 'asc' : 'desc');
      }}
    />
  );

  const productsWithMargin = enrichedProducts.filter((product) => (
    isAllMarketsMode
      ? MARKET_ORDER.some((market) => product.perMarket[market]?.marginPct != null)
      : product.marginPct != null
  )).length;

  const productsWithoutMargin = enrichedProducts.length - productsWithMargin;
  const soldOnlyCount = enrichedProducts.filter((product) => !product.hasCatalogRecord).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">📦 Produkty a sklad</h2>
          <p className="text-sm text-slate-500">
            Rychlý produktový výpis s nákupkou, prodejkou, skladem a marží z objednávek za posledních 90 dní. Filtruje průběžně už při psaní.
          </p>
        </div>
        <div className="md:w-[360px]">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Hledání
          </label>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Název, kód, EAN, cena, sklad..."
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <strong className="text-slate-700">Aktivní cenový pohled:</strong> {selectedMarketLabel}
            {isAllMarketsMode && <span className="text-slate-500"> — {ALL_MARKETS_NOTE}</span>}
            {roPriceUnavailable && <span className="text-amber-700"> — rumunská prodejní cena v tabulce `products` zatím chybí, proto ji tady nebudeme předstírat.</span>}
            <span className="text-slate-500"> — {BUY_PRICE_SOURCE_NOTE}</span>
            <span className="text-slate-500"> — Včetně prodaných SKU, které už v master katalogu nemusí být aktivní.</span>
          </div>
          <div className="text-slate-500">
            Poslední sync: <strong className="text-slate-700">{loading ? 'Načítám…' : (latestSync ? formatDateTime(latestSync) : '—')}</strong>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Aktivní v katalogu</div>
          <div className="text-2xl font-bold text-slate-800">{formatKpiValue(products.length, loading)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">V přehledu</div>
          <div className="text-2xl font-bold text-slate-800">{formatKpiValue(enrichedProducts.length, loading)}</div>
          <div className="text-xs text-slate-500">{loading ? 'počítám prodané SKU…' : `vč. ${formatNumber(soldOnlyCount)} prodaných SKU mimo katalog`}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Po filtru</div>
          <div className="text-2xl font-bold text-slate-800">{formatKpiValue(filteredProducts.length, loading)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">S marží</div>
          <div className="text-2xl font-bold text-slate-800">{formatKpiValue(productsWithMargin, loading)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">Bez marže</div>
          <div className="text-2xl font-bold text-amber-700">{formatKpiValue(productsWithoutMargin, loading)}</div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3">{sortableHeader(SORT_OPTIONS.name, 'Název')}</th>
                <th className="px-4 py-3">{sortableHeader(SORT_OPTIONS.code, 'Kód')}</th>
                <th className="px-4 py-3">{sortableHeader(SORT_OPTIONS.ean, 'EAN')}</th>
                {isAllMarketsMode ? (
                  <th className="px-4 py-3 text-left">
                    <div className="font-semibold text-slate-700">Státy</div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Nákupka · Prodej · Marže</div>
                  </th>
                ) : (
                  <>
                    <th className="px-4 py-3 text-right">{sortableHeader(SORT_OPTIONS.buyPrice, `Nákupka bez DPH (${selectedMarketLabel})`, 'right')}</th>
                    <th className="px-4 py-3 text-right">{sortableHeader(SORT_OPTIONS.sellPrice, `Prodej bez DPH (${selectedMarketLabel})`, 'right')}</th>
                  </>
                )}
                <th className="px-4 py-3 text-right">{sortableHeader(SORT_OPTIONS.stock, 'Skladem', 'right')}</th>
                {isAllMarketsMode ? null : (
                  <th className="px-4 py-3 text-right">{sortableHeader(SORT_OPTIONS.marginPct, 'Marže', 'right')}</th>
                )}
                <th className="px-4 py-3 text-right">{sortableHeader(SORT_OPTIONS.syncedAt, 'Sync', 'right')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={isAllMarketsMode ? 6 : 8} className="px-4 py-10 text-center text-slate-500">
                    Načítám produkty a objednávkovou marži…
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={isAllMarketsMode ? 6 : 8} className="px-4 py-10 text-center text-slate-500">
                    Ve filtru teď nic nesedí.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-slate-800">{product.localizedName}</div>
                      {!product.hasCatalogRecord && (
                        <div className="mt-1 text-xs text-amber-700">SKU je vidět v objednávkách, ale chybí v aktuálním master katalogu.</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top font-mono text-xs text-slate-700">{product.code || '—'}</td>
                    <td className="px-4 py-3 align-top font-mono text-xs text-slate-700">{product.eanResolved || '—'}</td>
                    {isAllMarketsMode ? (
                      <td className="px-4 py-3 align-top">
                        <AllMarketsMetricCell product={product} />
                      </td>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-right align-top text-slate-700">
                          {formatCurrency(product.buyPrice, selectedCurrency)}
                        </td>
                        <td className="px-4 py-3 text-right align-top font-medium text-slate-800">
                          {formatCurrency(product.sellPrice, selectedCurrency)}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-3 text-right align-top text-slate-700">
                      {product.stock_quantity == null ? '—' : formatNumber(product.stock_quantity)}
                    </td>
                    {isAllMarketsMode ? null : (
                      <td className="px-4 py-3 text-right align-top">
                        <span className={marginClass(product.marginPct)}>
                          {formatMargin(product.marginPct, product.marginValue, selectedCurrency)}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3 text-right align-top text-xs text-slate-500">
                      {formatDateTime(product.syncedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
