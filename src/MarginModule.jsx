import React, { useMemo } from 'react';
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

const CURRENCY_RATES = { CZK: 1, EUR: 25.2, HUF: 0.063, RON: 5.1 };
const MARKET_LABELS = {
  all: 'Všechny země',
  cz: 'Česko',
  sk: 'Slovensko',
  hu: 'Maďarsko',
  ro: 'Rumunsko',
  unknown: 'Neznámá země',
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const formatNumber = (num) => Math.round(num || 0).toLocaleString('cs-CZ');
const formatCurrency = (num) => `${formatNumber(num)} Kč`;
const formatPercent = (num) => `${(Number.isFinite(num) ? num : 0).toFixed(1)} %`;
const formatAxisCurrency = (num) => {
  if (Math.abs(num) >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (Math.abs(num) >= 1000) return `${Math.round(num / 1000)}k`;
  return `${Math.round(num)}`;
};

const formatDateForInput = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateFromInput = (value) => {
  const [year, month, day] = (value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const formatShortDate = (date) => date.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit' });
const formatFullDate = (date) => date.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
const getOrderCurrency = (order) => order.currency || order.raw_data?.currency_id || 'CZK';
const getOrderMarket = (order) => (order.market || order.raw_data?.language_id || 'unknown').toLowerCase();
const getOrderNumber = (order) => order.order_number || order.raw_data?.order_number || order.raw_data?.number || order.id;

const createBucket = ({ key = '', date = null, market = null } = {}) => ({
  key,
  label: date ? formatShortDate(date) : '',
  fullDate: date ? formatFullDate(date) : '',
  market,
  orders: 0,
  exactOrders: 0,
  incompleteOrders: 0,
  revenue: 0,
  cost: 0,
  grossProfit: 0,
  incompleteRevenue: 0,
  incompleteItems: 0,
});

const finalizeBucket = (bucket) => ({
  ...bucket,
  grossProfitPct: bucket.revenue ? (bucket.grossProfit / bucket.revenue) * 100 : 0,
  exactSharePct: bucket.orders ? (bucket.exactOrders / bucket.orders) * 100 : 0,
});

const calculateOrderMargin = (order) => {
  const products = Array.isArray(order.raw_data?.products) ? order.raw_data.products : [];
  const currency = getOrderCurrency(order);
  const rate = CURRENCY_RATES[currency] || 1;

  let revenueNative = 0;
  let costNative = 0;
  let missingItems = 0;

  products.forEach((product) => {
    const quantity = toNumber(product.quantity) || 1;
    const buyPrice = toNumber(product.buy_price);
    revenueNative += toNumber(product.price_without_vat);

    if (buyPrice > 0) {
      costNative += buyPrice * quantity;
    } else {
      missingItems += 1;
    }
  });

  const revenue = revenueNative * rate;
  const cost = costNative * rate;
  const grossProfit = revenue - cost;

  return {
    revenue,
    cost,
    grossProfit,
    grossProfitPct: revenue ? (grossProfit / revenue) * 100 : 0,
    complete: products.length > 0 && revenue > 0 && missingItems === 0,
    currency,
    missingItems,
    productsCount: products.length,
    orderNumber: getOrderNumber(order),
    market: getOrderMarket(order),
    orderDate: order.order_date,
  };
};

const addMargin = (bucket, margin) => {
  bucket.orders += 1;

  if (margin.complete) {
    bucket.exactOrders += 1;
    bucket.revenue += margin.revenue;
    bucket.cost += margin.cost;
    bucket.grossProfit += margin.grossProfit;
    return;
  }

  bucket.incompleteOrders += 1;
  bucket.incompleteRevenue += margin.revenue;
  bucket.incompleteItems += margin.missingItems;
};

const MarginChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-xl">
      <div className="font-semibold text-slate-800">{row.fullDate}</div>
      <div className="mt-1 text-slate-600">Hrubý zisk: <span className="font-semibold text-slate-800">{formatCurrency(row.grossProfit)}</span></div>
      <div className="text-slate-600">Hrubý zisk %: <span className="font-semibold text-slate-800">{formatPercent(row.grossProfitPct)}</span></div>
      <div className="text-slate-600">Tržba zboží: <span className="font-semibold text-slate-800">{formatCurrency(row.revenue)}</span></div>
      <div className="text-slate-600">Nákupka: <span className="font-semibold text-slate-800">{formatCurrency(row.cost)}</span></div>
      <div className="mt-1 text-slate-500">Přesné obj.: {formatNumber(row.exactOrders)} / {formatNumber(row.orders)}</div>
      {row.incompleteOrders > 0 && (
        <div className="text-amber-600">Chybí nákupka: {formatNumber(row.incompleteOrders)} obj.</div>
      )}
    </div>
  );
};

const MarginKPI = ({ title, value, sub, tone = 'slate' }) => {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    slate: 'border-slate-200 bg-slate-50 text-slate-800',
  };

  return (
    <div className={`rounded-xl border p-3 ${tones[tone] || tones.slate}`}>
      <div className="text-xs opacity-75 mb-1">{title}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs opacity-75 mt-1">{sub}</div>}
    </div>
  );
};

export default function MarginModule({ orders, dateFrom, dateTo, country }) {
  const stats = useMemo(() => {
    const from = parseDateFromInput(dateFrom);
    const to = parseDateFromInput(dateTo);
    if (!from || !to || from > to) {
      return {
        validRange: false,
        dailyAscending: [],
        dailyDescending: [],
        marketRows: [],
        incompleteOrders: [],
        total: finalizeBucket(createBucket()),
        today: null,
        rangeIncludesToday: false,
      };
    }

    const byDay = new Map();
    const byMarket = new Map();
    const total = createBucket();
    const incompleteOrders = [];

    const cursor = new Date(from);
    while (cursor <= to) {
      const key = formatDateForInput(cursor);
      byDay.set(key, createBucket({ key, date: new Date(cursor) }));
      cursor.setDate(cursor.getDate() + 1);
    }

    orders.forEach((order) => {
      if (!order.order_date) return;

      const orderDate = new Date(order.order_date);
      if (Number.isNaN(orderDate.getTime())) return;

      const dayKey = formatDateForInput(orderDate);
      if (!byDay.has(dayKey)) {
        byDay.set(dayKey, createBucket({ key: dayKey, date: orderDate }));
      }

      const margin = calculateOrderMargin(order);
      const market = margin.market;

      if (!byMarket.has(market)) {
        byMarket.set(market, createBucket({ key: market, market }));
      }

      addMargin(byDay.get(dayKey), margin);
      addMargin(byMarket.get(market), margin);
      addMargin(total, margin);

      if (!margin.complete) {
        incompleteOrders.push({
          ...margin,
          fullDate: formatFullDate(orderDate),
          revenue: margin.revenue,
        });
      }
    });

    const dailyAscending = Array.from(byDay.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(finalizeBucket);
    const dailyDescending = [...dailyAscending].reverse();
    const marketRows = Array.from(byMarket.values())
      .map(finalizeBucket)
      .sort((a, b) => {
        const order = ['cz', 'sk', 'hu', 'ro', 'unknown'];
        const ai = order.indexOf(a.market);
        const bi = order.indexOf(b.market);
        if (ai === -1 && bi === -1) return a.market.localeCompare(b.market);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });

    const todayKey = formatDateForInput(new Date());
    const today = dailyAscending.find((row) => row.key === todayKey) || null;

    return {
      validRange: true,
      dailyAscending,
      dailyDescending,
      marketRows,
      incompleteOrders: incompleteOrders.sort((a, b) => String(b.orderDate).localeCompare(String(a.orderDate))),
      total: finalizeBucket(total),
      today,
      rangeIncludesToday: dateFrom <= todayKey && todayKey <= dateTo,
    };
  }, [orders, dateFrom, dateTo]);

  if (!stats.validRange) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Neplatný rozsah data. Datum OD musí být menší nebo stejné jako datum DO.
      </div>
    );
  }

  const total = stats.total;
  const today = stats.today;
  const selectedCountry = MARKET_LABELS[country] || country;
  const shownIncomplete = stats.incompleteOrders.slice(0, 30);

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Marže / hrubý zisk</h2>
          <p className="text-sm text-slate-500">
            Vybrané období: {dateFrom} až {dateTo} • {selectedCountry}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Hrubý zisk % = (zboží bez DPH - nákupka) / zboží bez DPH
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <MarginKPI
          title="Hrubý zisk %"
          value={formatPercent(total.grossProfitPct)}
          sub={`${formatNumber(total.exactOrders)} přesných obj.`}
          tone="emerald"
        />
        <MarginKPI title="Hrubý zisk" value={formatCurrency(total.grossProfit)} sub="jen přesná nákupka" tone="emerald" />
        <MarginKPI title="Tržba zboží bez DPH" value={formatCurrency(total.revenue)} sub="bez dopravy a platby" tone="blue" />
        <MarginKPI title="Nákupka bez DPH" value={formatCurrency(total.cost)} sub="buy_price × množství" />
        <MarginKPI
          title="Pokrytí nákupkou"
          value={`${formatNumber(total.exactOrders)} / ${formatNumber(total.orders)}`}
          sub={total.incompleteOrders ? `${formatNumber(total.incompleteOrders)} obj. chybí` : 'vše spočítané'}
          tone={total.incompleteOrders ? 'amber' : 'emerald'}
        />
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 mb-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-blue-600 mb-1">Aktuálně dnes</div>
            <div className="text-sm text-blue-700">
              {stats.rangeIncludesToday
                ? `${today?.fullDate || 'Dnes'} ve vybraném období`
                : 'Dnes není ve vybraném období, změň datepicker na Dnes nebo Tento měsíc.'}
            </div>
          </div>
          {stats.rangeIncludesToday && today && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
              <div className="rounded-lg bg-white/70 border border-blue-100 p-3">
                <div className="text-xs text-blue-600">Hrubý zisk %</div>
                <div className="text-xl font-bold text-blue-900">{formatPercent(today.grossProfitPct)}</div>
              </div>
              <div className="rounded-lg bg-white/70 border border-blue-100 p-3">
                <div className="text-xs text-blue-600">Hrubý zisk</div>
                <div className="text-xl font-bold text-blue-900">{formatCurrency(today.grossProfit)}</div>
              </div>
              <div className="rounded-lg bg-white/70 border border-blue-100 p-3">
                <div className="text-xs text-blue-600">Tržba zboží</div>
                <div className="text-xl font-bold text-blue-900">{formatCurrency(today.revenue)}</div>
              </div>
              <div className="rounded-lg bg-white/70 border border-blue-100 p-3">
                <div className="text-xs text-blue-600">Přesnost</div>
                <div className="text-xl font-bold text-blue-900">
                  {formatNumber(today.exactOrders)} / {formatNumber(today.orders)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {total.incompleteOrders > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-5 text-sm text-amber-800">
          <span className="font-semibold">Pozor na chybějící nákupky:</span>{' '}
          {formatNumber(total.incompleteOrders)} objednávek mimo výpočet, tržba zboží {formatCurrency(total.incompleteRevenue)}.
          Hrubý zisk % je počítaný jen z objednávek, kde má každá položka nákupku.
        </div>
      )}

      <div className="rounded-xl border border-slate-200 overflow-hidden mb-5">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">Vývoj po dnech</h3>
          <p className="text-xs text-slate-500">Sloupce ukazují hrubý zisk v Kč, linka hrubý zisk %.</p>
        </div>
        <div className="h-72 bg-white p-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={stats.dailyAscending} margin={{ top: 14, right: 18, left: 8, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={12} />
              <YAxis yAxisId="profit" tickFormatter={formatAxisCurrency} tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis
                yAxisId="pct"
                orientation="right"
                domain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
                tick={{ fontSize: 11, fill: '#64748b' }}
              />
              <RechartsTooltip content={({ active, payload }) => <MarginChartTooltip active={active} payload={payload} />} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar yAxisId="profit" dataKey="grossProfit" name="Hrubý zisk (Kč)" fill="#10b981" radius={[5, 5, 0, 0]} />
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="grossProfitPct"
                name="Hrubý zisk %"
                stroke="#2563eb"
                strokeWidth={2.5}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden mb-5">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">Marže dle země</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Země</th>
                <th className="text-right px-3 py-2 font-semibold">Obj.</th>
                <th className="text-right px-3 py-2 font-semibold">Přesné</th>
                <th className="text-right px-3 py-2 font-semibold">Chybí</th>
                <th className="text-right px-3 py-2 font-semibold">Tržba zboží</th>
                <th className="text-right px-3 py-2 font-semibold">Nákupka</th>
                <th className="text-right px-3 py-2 font-semibold">Hrubý zisk</th>
                <th className="text-right px-3 py-2 font-semibold">Hrubý zisk %</th>
              </tr>
            </thead>
            <tbody>
              {stats.marketRows.map((row) => (
                <tr key={row.market} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                  <td className="px-3 py-2 font-medium text-slate-800">{MARKET_LABELS[row.market] || row.market}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.orders)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.exactOrders)}</td>
                  <td className={`px-3 py-2 text-right ${row.incompleteOrders ? 'text-amber-700 font-semibold' : 'text-slate-400'}`}>
                    {formatNumber(row.incompleteOrders)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.revenue)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.cost)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-700">{formatCurrency(row.grossProfit)}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800">{formatPercent(row.grossProfitPct)}</td>
                </tr>
              ))}
              {!stats.marketRows.length && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-500">Pro zvolené filtry nejsou dostupná data.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden mb-5">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">Marže po dnech</h3>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="min-w-[860px] w-full text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Den</th>
                <th className="text-right px-3 py-2 font-semibold">Obj.</th>
                <th className="text-right px-3 py-2 font-semibold">Přesné</th>
                <th className="text-right px-3 py-2 font-semibold">Chybí</th>
                <th className="text-right px-3 py-2 font-semibold">Tržba zboží</th>
                <th className="text-right px-3 py-2 font-semibold">Nákupka</th>
                <th className="text-right px-3 py-2 font-semibold">Hrubý zisk</th>
                <th className="text-right px-3 py-2 font-semibold">Hrubý zisk %</th>
              </tr>
            </thead>
            <tbody>
              {stats.dailyDescending.map((row) => (
                <tr key={row.key} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                  <td className="px-3 py-2 text-slate-800 font-medium">{row.fullDate}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.orders)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatNumber(row.exactOrders)}</td>
                  <td className={`px-3 py-2 text-right ${row.incompleteOrders ? 'text-amber-700 font-semibold' : 'text-slate-400'}`}>
                    {formatNumber(row.incompleteOrders)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.revenue)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(row.cost)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-700">{formatCurrency(row.grossProfit)}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800">{formatPercent(row.grossProfitPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">Objednávky s chybějící nákupkou</h3>
          <p className="text-xs text-slate-500">Zobrazujeme objednávky, které nejsou zahrnuté do hrubého zisku.</p>
        </div>
        {shownIncomplete.length ? (
          <div className="max-h-72 overflow-auto">
            <table className="min-w-[720px] w-full text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Objednávka</th>
                  <th className="text-left px-3 py-2 font-semibold">Datum</th>
                  <th className="text-left px-3 py-2 font-semibold">Země</th>
                  <th className="text-right px-3 py-2 font-semibold">Tržba zboží</th>
                  <th className="text-right px-3 py-2 font-semibold">Položky</th>
                  <th className="text-right px-3 py-2 font-semibold">Chybí nákupka</th>
                </tr>
              </thead>
              <tbody>
                {shownIncomplete.map((order) => (
                  <tr key={`${order.orderNumber}-${order.orderDate}`} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                    <td className="px-3 py-2 font-medium text-slate-800">{order.orderNumber}</td>
                    <td className="px-3 py-2 text-slate-700">{order.fullDate}</td>
                    <td className="px-3 py-2 text-slate-700">{MARKET_LABELS[order.market] || order.market}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{formatCurrency(order.revenue)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{formatNumber(order.productsCount)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-amber-700">{formatNumber(order.missingItems)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stats.incompleteOrders.length > shownIncomplete.length && (
              <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Zobrazeno {formatNumber(shownIncomplete.length)} z {formatNumber(stats.incompleteOrders.length)} objednávek.
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 text-sm text-emerald-700 bg-emerald-50">
            Všechny objednávky ve vybraném filtru mají kompletní nákupku.
          </div>
        )}
      </div>
    </>
  );
}
