import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

const PROVIDER_LABELS = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
};

const MARKET_LABELS = {
  cz: 'CZ',
  sk: 'SK',
  hu: 'HU',
  ro: 'RO',
  unknown: 'Neznámé',
};

const CURRENCY_RATES = { CZK: 1, EUR: 25.2, HUF: 0.063, RON: 5.1 };

const LEVEL_LABELS = {
  ad_group: 'Ad groups',
  ad: 'Ads',
  keyword: 'Keywords',
  search_term: 'Search terms',
  shopping_product: 'Shopping produkty',
  asset_group: 'Asset groups',
  hour: 'Hodiny',
  conversion_action: 'Konverzní akce',
};

const toNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};

const formatNumber = (value) => Math.round(toNumber(value)).toLocaleString('cs-CZ');
const formatCurrency = (value) => `${formatNumber(value)} Kč`;
const formatPercent = (value) => `${toNumber(value).toFixed(1)} %`;
const formatRatio = (value) => toNumber(value).toFixed(2).replace('.', ',');
const formatDate = (value) => {
  const [, month, day] = String(value || '').split('-');
  return month && day ? `${day}.${month}.` : value;
};

const emptyMetrics = () => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  interactions: 0,
  conversions: 0,
  conversionValue: 0,
});

const emptyOrderMetrics = () => ({
  orders: 0,
  exactOrders: 0,
  revenue: 0,
  exactRevenue: 0,
  exactCost: 0,
  exactGrossProfit: 0,
  missingCostOrders: 0,
});

const addMetrics = (target, row) => {
  target.spend += toNumber(row.spend_czk);
  target.impressions += toNumber(row.impressions);
  target.clicks += toNumber(row.clicks);
  target.interactions += toNumber(row.interactions);
  target.conversions += toNumber(row.conversions);
  target.conversionValue += toNumber(row.conversion_value_czk);
};

const enrichMetrics = (metrics) => ({
  ...metrics,
  ctr: metrics.impressions ? (metrics.clicks / metrics.impressions) * 100 : 0,
  cpc: metrics.clicks ? metrics.spend / metrics.clicks : 0,
  cpm: metrics.impressions ? (metrics.spend / metrics.impressions) * 1000 : 0,
  roas: metrics.spend ? metrics.conversionValue / metrics.spend : 0,
  aov: metrics.conversions ? metrics.conversionValue / metrics.conversions : 0,
  costPerConversion: metrics.conversions ? metrics.spend / metrics.conversions : 0,
});

const getOrderCurrency = (order) => order.currency || order.raw_data?.currency_id || 'CZK';
const getOrderMarket = (order) => (order.market || order.raw_data?.language_id || 'unknown').toLowerCase();
const getOrderDateKey = (order) => String(order.order_date || order.created_at || '').slice(0, 10);

function addOrderMetrics(target, order) {
  const products = Array.isArray(order.raw_data?.products) ? order.raw_data.products : [];
  const rate = CURRENCY_RATES[getOrderCurrency(order)] || 1;
  let revenue = 0;
  let cost = 0;
  let missingItems = 0;

  for (const product of products) {
    const quantity = Math.max(toNumber(product.quantity), 1);
    const buyPrice = toNumber(product.buy_price);
    revenue += toNumber(product.price_without_vat);
    if (buyPrice > 0) {
      cost += buyPrice * quantity;
    } else {
      missingItems += 1;
    }
  }

  const revenueCzk = revenue * rate;
  const costCzk = cost * rate;

  target.orders += 1;
  target.revenue += revenueCzk;

  if (products.length && revenueCzk > 0 && missingItems === 0) {
    target.exactOrders += 1;
    target.exactRevenue += revenueCzk;
    target.exactCost += costCzk;
    target.exactGrossProfit += revenueCzk - costCzk;
  } else if (products.length) {
    target.missingCostOrders += 1;
  }
}

function aggregateOrders(orders) {
  return orders.reduce((acc, order) => {
    addOrderMetrics(acc, order);
    return acc;
  }, emptyOrderMetrics());
}

function aggregateOrdersByDate(orders) {
  const byDate = new Map();
  for (const order of orders) {
    const date = getOrderDateKey(order);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, { date, ...emptyOrderMetrics() });
    addOrderMetrics(byDate.get(date), order);
  }
  return byDate;
}

function aggregateOrdersByMarket(orders) {
  const byMarket = new Map();
  for (const order of orders) {
    const market = getOrderMarket(order);
    if (!byMarket.has(market)) byMarket.set(market, { market, ...emptyOrderMetrics() });
    addOrderMetrics(byMarket.get(market), order);
  }
  return byMarket;
}

const metricSummary = (rows) => enrichMetrics(rows.reduce((acc, row) => {
  addMetrics(acc, row);
  return acc;
}, emptyMetrics()));

const providerLabel = (provider) => PROVIDER_LABELS[provider] || provider || 'Neznámý zdroj';
const marketLabel = (market) => MARKET_LABELS[market] || String(market || '').toUpperCase();

function aggregateCampaigns(rows, campaignMeta) {
  const byKey = new Map();

  for (const row of rows) {
    const key = `${row.provider}:${row.account_id}:${row.campaign_id}`;
    if (!byKey.has(key)) {
      const meta = campaignMeta.get(key) || {};
      byKey.set(key, {
        key,
        provider: row.provider,
        market: row.market,
        accountName: row.account_name,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name || meta.campaign_name || 'Bez názvu kampaně',
        status: meta.status || null,
        servingStatus: meta.serving_status || null,
        channelType: meta.channel_type || null,
        channelSubType: meta.channel_sub_type || null,
        biddingStrategyType: meta.bidding_strategy_type || null,
        budget: toNumber(meta.budget_amount_native),
        currency: row.currency || meta.currency || 'CZK',
        ...emptyMetrics(),
      });
    }
    addMetrics(byKey.get(key), row);
  }

  return Array.from(byKey.values())
    .map(enrichMetrics)
    .sort((a, b) => b.spend - a.spend);
}

function aggregateDaily(rows, orderByDate) {
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, { date: row.date, label: formatDate(row.date), ...emptyMetrics() });
    }
    addMetrics(byDate.get(row.date), row);
  }

  return Array.from(byDate.values())
    .map((row) => {
      const enriched = enrichMetrics(row);
      const orders = orderByDate.get(row.date) || emptyOrderMetrics();
      return {
        ...enriched,
        realRevenue: orders.revenue,
        exactGrossProfit: orders.exactGrossProfit,
        grossProfitAfterAds: orders.exactGrossProfit - enriched.spend,
        realRoas: enriched.spend ? orders.revenue / enriched.spend : 0,
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function aggregateMarkets(rows, orderByMarket) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.provider}:${row.market}`;
    if (!byKey.has(key)) {
      byKey.set(key, { key, provider: row.provider, market: row.market, ...emptyMetrics() });
    }
    addMetrics(byKey.get(key), row);
  }

  return Array.from(byKey.values())
    .map((row) => {
      const enriched = enrichMetrics(row);
      const orders = orderByMarket.get(row.market) || emptyOrderMetrics();
      return {
        ...enriched,
        realRevenue: orders.revenue,
        exactGrossProfit: orders.exactGrossProfit,
        grossProfitAfterAds: orders.exactGrossProfit - enriched.spend,
        realRoas: enriched.spend ? orders.revenue / enriched.spend : 0,
        pno: orders.revenue ? (enriched.spend / orders.revenue) * 100 : 0,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

function aggregateDetails(rows, level) {
  const byKey = new Map();
  const levelRows = rows.filter((row) => row.level === level);

  for (const row of levelRows) {
    const dimensions = row.dimensions || {};
    const keyValue = [
      dimensions.search_term,
      dimensions.keyword_text,
      dimensions.product_item_id,
      dimensions.product_title,
      dimensions.ad_id,
      dimensions.ad_group_id,
      dimensions.asset_group_id,
      dimensions.conversion_action,
      dimensions.hour,
      dimensions.asset_group_name,
    ].find((value) => value !== null && value !== undefined && value !== '');

    const key = `${row.provider}:${row.market}:${level}:${keyValue || 'unknown'}`;
    if (!byKey.has(key)) {
      const label = level === 'search_term'
        ? dimensions.search_term || '(bez search termu)'
        : level === 'keyword'
          ? dimensions.keyword_text || '(bez keywordu)'
          : level === 'shopping_product'
            ? dimensions.product_title || dimensions.product_item_id || '(bez produktu)'
            : level === 'asset_group'
              ? dimensions.asset_group_name || '(bez asset group)'
              : level === 'ad'
                ? dimensions.ad_name || dimensions.ad_id || '(bez reklamy)'
                : level === 'ad_group'
                  ? dimensions.ad_group_name || dimensions.ad_group_id || '(bez sestavy)'
                  : level === 'hour'
                    ? `${String(dimensions.hour ?? '').padStart(2, '0')}:00`
                    : level === 'conversion_action'
                      ? dimensions.conversion_action_name || dimensions.conversion_action || '(bez konverzní akce)'
                      : keyValue || '(bez detailu)';

      const subLabel = level === 'shopping_product'
        ? dimensions.product_item_id
        : level === 'keyword'
          ? dimensions.match_type
          : level === 'search_term'
            ? dimensions.match_type
            : level === 'ad'
              ? dimensions.ad_type || dimensions.ad_status
              : level === 'ad_group'
                ? dimensions.ad_group_type || dimensions.ad_group_status
                : null;

      byKey.set(key, {
        key,
        level,
        provider: row.provider,
        market: row.market,
        campaignName: row.campaign_name,
        label,
        subLabel,
        ...emptyMetrics(),
      });
    }
    addMetrics(byKey.get(key), row);
  }

  return Array.from(byKey.values())
    .map(enrichMetrics)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 12);
}

function Kpi({ label, value, sub, tone = 'slate' }) {
  const toneClass = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    slate: 'border-slate-200 bg-slate-50 text-slate-800',
  }[tone];

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="text-xs font-medium opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-xs opacity-75">{sub}</div>}
    </div>
  );
}

function StatusBadge({ value }) {
  const active = ['ENABLED', 'SERVING'].includes(String(value || '').toUpperCase());
  const paused = ['PAUSED', 'REMOVED'].includes(String(value || '').toUpperCase());
  const classes = active
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : paused
      ? 'bg-slate-50 text-slate-500 border-slate-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';

  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${classes}`}>
      {value || 'bez statusu'}
    </span>
  );
}

function CampaignTable({ rows }) {
  if (!rows.length) {
    return <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Pro zvolené období tu zatím nejsou kampaně.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Kampaň</th>
            <th className="px-3 py-2 text-left">Trh</th>
            <th className="px-3 py-2 text-left">Typ</th>
            <th className="px-3 py-2 text-right">Spend</th>
            <th className="px-3 py-2 text-right">Konv. hodnota</th>
            <th className="px-3 py-2 text-right">ROAS</th>
            <th className="px-3 py-2 text-right">Konverze</th>
            <th className="px-3 py-2 text-right">AOV</th>
            <th className="px-3 py-2 text-right">Kliky</th>
            <th className="px-3 py-2 text-right">CPC</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.slice(0, 30).map((row) => (
            <tr key={row.key} className="hover:bg-slate-50">
              <td className="px-3 py-2">
                <div className="font-semibold text-slate-800">{row.campaignName}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <StatusBadge value={row.status} />
                  {row.servingStatus && <StatusBadge value={row.servingStatus} />}
                </div>
              </td>
              <td className="px-3 py-2 text-slate-600">{providerLabel(row.provider)} / {marketLabel(row.market)}</td>
              <td className="px-3 py-2 text-slate-600">
                <div>{row.channelType || '—'}</div>
                <div className="text-xs text-slate-400">{row.biddingStrategyType || ''}</div>
              </td>
              <td className="px-3 py-2 text-right font-semibold text-red-700">{formatCurrency(row.spend)}</td>
              <td className="px-3 py-2 text-right font-semibold text-emerald-700">{formatCurrency(row.conversionValue)}</td>
              <td className="px-3 py-2 text-right font-bold text-slate-800">{formatRatio(row.roas)}</td>
              <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.conversions)}</td>
              <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.aov)}</td>
              <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.clicks)}</td>
              <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.cpc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailTable({ title, rows }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-800">{title}</h3>
      {!rows.length ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Bez dat.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Položka</th>
                <th className="px-3 py-2 text-left">Kampaň</th>
                <th className="px-3 py-2 text-right">Spend</th>
                <th className="px-3 py-2 text-right">Kliky</th>
                <th className="px-3 py-2 text-right">Konv.</th>
                <th className="px-3 py-2 text-right">ROAS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.key} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <div className="max-w-[360px] truncate font-medium text-slate-800">{row.label}</div>
                    <div className="text-xs text-slate-400">{marketLabel(row.market)} {row.subLabel ? `· ${row.subLabel}` : ''}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{row.campaignName || '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-red-700">{formatCurrency(row.spend)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.clicks)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.conversions)}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800">{formatRatio(row.roas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdsTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-slate-800">{item.label}</div>
      <div className="text-red-700">Spend: {formatCurrency(item.spend)}</div>
      <div className="text-emerald-700">Konv. hodnota: {formatCurrency(item.conversionValue)}</div>
      <div className="text-slate-700">ROAS: {formatRatio(item.roas)}</div>
      <div className="text-slate-500">Kliky: {formatNumber(item.clicks)} · Konverze: {formatNumber(item.conversions)}</div>
    </div>
  );
}

export default function AdsModule({ supabaseClient, dateFrom, dateTo, country, orders = [] }) {
  const [dailyRows, setDailyRows] = useState([]);
  const [campaignRows, setCampaignRows] = useState([]);
  const [campaignMetaRows, setCampaignMetaRows] = useState([]);
  const [detailRows, setDetailRows] = useState([]);
  const [syncRuns, setSyncRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadAds() {
      if (!supabaseClient) return;
      setLoading(true);
      setError('');

      const applyMarket = (query) => {
        if (country && country !== 'all') return query.eq('market', country);
        return query;
      };

      const campaignMetricQuery = applyMarket(
        supabaseClient
          .from('ad_metrics_daily')
          .select('date,provider,market,account_id,account_name,level,campaign_id,campaign_name,currency,spend_czk,impressions,clicks,interactions,conversions,conversion_value_czk')
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .eq('level', 'campaign')
          .order('date', { ascending: true })
          .range(0, 9999)
      );

      const detailQuery = applyMarket(
        supabaseClient
          .from('ad_metrics_daily')
          .select('date,provider,market,level,campaign_name,ad_group_name,spend_czk,impressions,clicks,interactions,conversions,conversion_value_czk,dimensions')
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .in('level', ['hour', 'ad_group', 'ad', 'keyword', 'search_term', 'shopping_product', 'asset_group', 'conversion_action'])
          .order('spend_czk', { ascending: false })
          .range(0, 4999)
      );

      const metaQuery = country && country !== 'all'
        ? supabaseClient.from('ad_campaigns').select('*').eq('market', country).range(0, 999)
        : supabaseClient.from('ad_campaigns').select('*').range(0, 999);

      const runsQuery = supabaseClient
        .from('ad_sync_runs')
        .select('provider,sync_type,range_from,range_to,status,rows_upserted,warnings,error_message,started_at,finished_at')
        .order('started_at', { ascending: false })
        .limit(6);

      const [campaignMetricResult, detailResult, metaResult, runsResult] = await Promise.all([
        campaignMetricQuery,
        detailQuery,
        metaQuery,
        runsQuery,
      ]);

      const firstError = [campaignMetricResult, detailResult, metaResult, runsResult].find((result) => result.error)?.error;
      if (firstError) throw firstError;

      if (!cancelled) {
        setDailyRows(campaignMetricResult.data || []);
        setCampaignRows(campaignMetricResult.data || []);
        setDetailRows(detailResult.data || []);
        setCampaignMetaRows(metaResult.data || []);
        setSyncRuns(runsResult.data || []);
      }
    }

    loadAds()
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Ads data se nepodařilo načíst.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [supabaseClient, dateFrom, dateTo, country]);

  const campaignMeta = useMemo(() => {
    const map = new Map();
    for (const row of campaignMetaRows) {
      map.set(`${row.provider}:${row.account_id}:${row.campaign_id}`, row);
    }
    return map;
  }, [campaignMetaRows]);

  const orderTotal = useMemo(() => aggregateOrders(orders), [orders]);
  const orderByDate = useMemo(() => aggregateOrdersByDate(orders), [orders]);
  const orderByMarket = useMemo(() => aggregateOrdersByMarket(orders), [orders]);
  const total = useMemo(() => metricSummary(dailyRows), [dailyRows]);
  const businessTotal = useMemo(() => ({
    realRevenue: orderTotal.revenue,
    exactGrossProfit: orderTotal.exactGrossProfit,
    grossProfitAfterAds: orderTotal.exactGrossProfit - total.spend,
    realRoas: total.spend ? orderTotal.revenue / total.spend : 0,
    pno: orderTotal.revenue ? (total.spend / orderTotal.revenue) * 100 : 0,
    spendToGrossProfit: orderTotal.exactGrossProfit ? (total.spend / orderTotal.exactGrossProfit) * 100 : 0,
  }), [orderTotal, total]);
  const daily = useMemo(() => aggregateDaily(dailyRows, orderByDate), [dailyRows, orderByDate]);
  const markets = useMemo(() => aggregateMarkets(dailyRows, orderByMarket), [dailyRows, orderByMarket]);
  const campaigns = useMemo(() => aggregateCampaigns(campaignRows, campaignMeta), [campaignRows, campaignMeta]);
  const topAdGroups = useMemo(() => aggregateDetails(detailRows, 'ad_group'), [detailRows]);
  const topAds = useMemo(() => aggregateDetails(detailRows, 'ad'), [detailRows]);
  const topKeywords = useMemo(() => aggregateDetails(detailRows, 'keyword'), [detailRows]);
  const topSearchTerms = useMemo(() => aggregateDetails(detailRows, 'search_term'), [detailRows]);
  const topProducts = useMemo(() => aggregateDetails(detailRows, 'shopping_product'), [detailRows]);
  const topAssetGroups = useMemo(() => aggregateDetails(detailRows, 'asset_group'), [detailRows]);
  const topHours = useMemo(() => aggregateDetails(detailRows, 'hour'), [detailRows]);
  const topConversionActions = useMemo(() => aggregateDetails(detailRows, 'conversion_action'), [detailRows]);
  const latestRun = syncRuns[0];

  if (loading) {
    return <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Načítám Ads data…</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Ads data se nepodařilo načíst: {error}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Ads přehled</h2>
          <div className="text-sm text-slate-500">{dateFrom} až {dateTo} · {country === 'all' ? 'všechny země' : marketLabel(country)}</div>
        </div>
        {latestRun && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <div className="font-semibold text-slate-800">Poslední sync: {providerLabel(latestRun.provider)} · {latestRun.status}</div>
            <div>{latestRun.range_from} až {latestRun.range_to} · {formatNumber(latestRun.rows_upserted)} řádků</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="Spend" value={formatCurrency(total.spend)} sub={`${formatNumber(total.clicks)} kliků`} tone="amber" />
        <Kpi label="Konv. hodnota" value={formatCurrency(total.conversionValue)} sub={`${formatNumber(total.conversions)} konverzí`} tone="emerald" />
        <Kpi label="ROAS" value={formatRatio(total.roas)} sub={`AOV ${formatCurrency(total.aov)}`} tone="blue" />
        <Kpi label="CPC" value={formatCurrency(total.cpc)} sub={`CTR ${formatPercent(total.ctr)}`} />
        <Kpi label="CPA" value={formatCurrency(total.costPerConversion)} sub={`CPM ${formatCurrency(total.cpm)}`} />
        <Kpi label="Imprese" value={formatNumber(total.impressions)} sub={`${formatNumber(total.interactions)} interakcí`} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="Real tržby" value={formatCurrency(businessTotal.realRevenue)} sub={`${formatNumber(orderTotal.orders)} obj.`} tone="blue" />
        <Kpi label="Přesný hrubý zisk" value={formatCurrency(businessTotal.exactGrossProfit)} sub={`${formatNumber(orderTotal.exactOrders)} přesných obj.`} tone="emerald" />
        <Kpi label="Zisk po Ads" value={formatCurrency(businessTotal.grossProfitAfterAds)} sub="hrubý zisk - spend" tone={businessTotal.grossProfitAfterAds >= 0 ? 'emerald' : 'amber'} />
        <Kpi label="Real ROAS" value={formatRatio(businessTotal.realRoas)} sub="tržby / spend" tone="blue" />
        <Kpi label="PNO" value={formatPercent(businessTotal.pno)} sub="spend / tržby" />
        <Kpi label="Ads vs zisk" value={formatPercent(businessTotal.spendToGrossProfit)} sub={`${formatNumber(orderTotal.missingCostOrders)} obj. bez přesné nákupky`} />
      </div>

      <div className="rounded-lg border border-slate-200 p-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Denní vývoj</h3>
          <div className="text-xs text-slate-500">{daily.length} dnů</div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily} margin={{ top: 12, right: 18, left: 8, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis yAxisId="money" tickFormatter={(value) => `${Math.round(value / 1000)}k`} tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis yAxisId="roas" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} />
              <RechartsTooltip content={<AdsTooltip />} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar yAxisId="money" dataKey="spend" name="Spend" fill="#f59e0b" radius={[5, 5, 0, 0]} />
              <Bar yAxisId="money" dataKey="conversionValue" name="Konv. hodnota" fill="#10b981" radius={[5, 5, 0, 0]} />
              <Line yAxisId="money" type="monotone" dataKey="realRevenue" name="Real tržby" stroke="#0f766e" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
              <Line yAxisId="money" type="monotone" dataKey="grossProfitAfterAds" name="Zisk po Ads" stroke="#7c3aed" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
              <Line yAxisId="roas" type="monotone" dataKey="roas" name="ROAS" stroke="#2563eb" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Rozpad podle trhu</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Zdroj / trh</th>
                <th className="px-3 py-2 text-right">Spend</th>
                <th className="px-3 py-2 text-right">Konv. hodnota</th>
                <th className="px-3 py-2 text-right">ROAS</th>
                <th className="px-3 py-2 text-right">Real tržby</th>
                <th className="px-3 py-2 text-right">Zisk po Ads</th>
                <th className="px-3 py-2 text-right">PNO</th>
                <th className="px-3 py-2 text-right">Konverze</th>
                <th className="px-3 py-2 text-right">AOV</th>
                <th className="px-3 py-2 text-right">CPC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {markets.map((row) => (
                <tr key={row.key} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-semibold text-slate-800">{providerLabel(row.provider)} / {marketLabel(row.market)}</td>
                  <td className="px-3 py-2 text-right text-red-700 font-semibold">{formatCurrency(row.spend)}</td>
                  <td className="px-3 py-2 text-right text-emerald-700 font-semibold">{formatCurrency(row.conversionValue)}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800">{formatRatio(row.roas)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.realRevenue)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${row.grossProfitAfterAds >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(row.grossProfitAfterAds)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatPercent(row.pno)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.conversions)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.aov)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.cpc)}</td>
                </tr>
              ))}
              {!markets.length && (
                <tr>
                  <td colSpan={10} className="px-3 py-4 text-center text-slate-500">Pro zvolené období nejsou Ads data.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Kampaně</h3>
        <CampaignTable rows={campaigns} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <DetailTable title={LEVEL_LABELS.ad_group} rows={topAdGroups} />
        <DetailTable title={LEVEL_LABELS.ad} rows={topAds} />
        <DetailTable title={LEVEL_LABELS.keyword} rows={topKeywords} />
        <DetailTable title={LEVEL_LABELS.search_term} rows={topSearchTerms} />
        <DetailTable title={LEVEL_LABELS.shopping_product} rows={topProducts} />
        <DetailTable title={LEVEL_LABELS.asset_group} rows={topAssetGroups} />
        <DetailTable title={LEVEL_LABELS.hour} rows={topHours} />
        <DetailTable title={LEVEL_LABELS.conversion_action} rows={topConversionActions} />
      </div>

      {!!syncRuns.length && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Sync běhy</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Provider</th>
                  <th className="px-3 py-2 text-left">Typ</th>
                  <th className="px-3 py-2 text-left">Období</th>
                  <th className="px-3 py-2 text-right">Řádky</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {syncRuns.map((run) => (
                  <tr key={`${run.provider}:${run.started_at}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-semibold text-slate-800">{providerLabel(run.provider)}</td>
                    <td className="px-3 py-2 text-slate-600">{run.sync_type}</td>
                    <td className="px-3 py-2 text-slate-600">{run.range_from} až {run.range_to}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{formatNumber(run.rows_upserted)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge value={run.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
