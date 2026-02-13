import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://oonnawrfsbsbuijmfcqj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vbm5hd3Jmc2JzYnVpam1mY3FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMjA4ODcsImV4cCI6MjA4NTg5Njg4N30.d1jk1BYOc6eEx-KJzGpW3ekfDs4jxW10VgKmLef8f1Y';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
const CURRENCY_RATES = { CZK: 1, EUR: 25.2, HUF: 0.063 };

const BIG_CITIES = {
  cz: ['praha', 'brno', 'ostrava', 'plzeň', 'plzen', 'liberec', 'olomouc', 'budějovic', 'budejovic', 'hradec králové', 'hradec', 'ústí nad labem', 'usti', 'pardubice', 'zlín', 'zlin', 'havířov', 'havirov', 'kladno', 'most', 'opava', 'frýdek', 'frydek', 'karviná', 'karvina', 'jihlava', 'teplice', 'děčín', 'decin', 'karlovy vary'],
  sk: ['bratislava', 'košice', 'kosice', 'prešov', 'presov', 'žilina', 'zilina', 'nitra', 'banská bystrica', 'bystrica', 'trnava', 'martin', 'trenčín', 'trencin', 'poprad'],
  hu: ['budapest', 'debrecen', 'szeged', 'miskolc', 'pécs', 'pecs', 'győr', 'gyor', 'nyíregyháza', 'nyiregyhaza', 'kecskemét', 'kecskemet', 'székesfehérvár', 'szekesfehervar'],
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

// Výpočet obratu BEZ DPH a BEZ poštovného
const getRevenueWithoutVAT = (order) => {
  const products = order.raw_data?.products || [];
  let total = 0;
  products.forEach(p => {
    // price_without_vat je už celková cena za řádek (price_per_unit_without_vat × quantity)
    total += parseFloat(p.price_without_vat || 0);
  });
  // Převod měny
  const currency = order.currency || 'CZK';
  return total * (CURRENCY_RATES[currency] || 1);
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

const formatNumber = (num) => Math.round(num).toLocaleString('cs-CZ');
const formatCurrency = (num) => `${formatNumber(num)} Kč`;

const getColorIntensity = (value, max) => {
  if (!max || !value) return 'bg-slate-100';
  const i = Math.min(value / max, 1);
  return i < 0.2 ? 'bg-blue-100' : i < 0.4 ? 'bg-blue-200' : i < 0.6 ? 'bg-blue-300' : i < 0.8 ? 'bg-blue-400' : 'bg-blue-500';
};

const getDatePreset = (preset) => {
  const today = new Date();
  const formatDate = (d) => d.toISOString().split('T')[0];
  
  switch (preset) {
    case 'today':
      return { from: formatDate(today), to: formatDate(today) };
    case 'yesterday':
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { from: formatDate(yesterday), to: formatDate(yesterday) };
    case 'this_week':
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay() + 1);
      return { from: formatDate(weekStart), to: formatDate(today) };
    case 'last_week':
      const lastWeekEnd = new Date(today);
      lastWeekEnd.setDate(today.getDate() - today.getDay());
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
    case 'all':
      return { from: '2025-11-01', to: formatDate(today) };
    default:
      return null;
  }
};

const KPICard = ({ title, value, icon, sub }) => (
  <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200">
    <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">{icon} {title}</div>
    <div className="text-2xl font-bold text-slate-800">{value}</div>
    {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
  </div>
);

const Heatmap = ({ data, metric, onClick, groupDays, activeDays }) => {
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

  if (groupDays) {
    return (
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
            {HOURS.map(h => (
              <div 
                key={h} 
                onClick={() => onClick(null, h, data.grouped?.[h])}
                className={`flex-1 aspect-square m-0.5 rounded cursor-pointer transition-all hover:ring-2 hover:ring-blue-400 hover:scale-110 ${getColorIntensity(data.grouped?.[h]?.[metric], max)}`} 
              />
            ))}
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
    );
  }

  return (
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
              {HOURS.map(h => (
                <div 
                  key={h} 
                  onClick={() => isActive && onClick(d, h, data[d]?.[h])}
                  className={`flex-1 aspect-square m-0.5 rounded transition-all ${
                    isActive 
                      ? `cursor-pointer hover:ring-2 hover:ring-blue-400 hover:scale-110 ${getColorIntensity(data[d]?.[h]?.[metric], max)}`
                      : 'bg-slate-50'
                  }`} 
                />
              ))}
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
  <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
      <div className="text-4xl mb-4">📊</div>
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Order Analytics</h1>
      <p className="text-slate-500 text-sm mb-6">REGAL MASTER</p>
      {authError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {authError}
        </div>
      )}
      <button
        onClick={onLogin}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border-2 border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:border-blue-400 hover:shadow-md transition-all"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Přihlásit se přes Google
      </button>
      <p className="text-xs text-slate-400 mt-4">
        🚀 Impérium to bude.
      </p>
    </div>
  </div>
);

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [orders, setOrders] = useState([]);
  const [country, setCountry] = useState('all');
  const [metric, setMetric] = useState('orders');
  const [tab, setTab] = useState('heatmap');
  const [cell, setCell] = useState(null);
  const [groupDays, setGroupDays] = useState(false);
  const [activePreset, setActivePreset] = useState('last_30');
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0]);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);

  // Auth: listen for session changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
      }
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        setAuthError(null);
      } else {
        setUser(null);
      }
    });
    return () => subscription.unsubscribe();
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
    }
  };

  const handleDateChange = (type, value) => {
    if (type === 'from') setDateFrom(value);
    else setDateTo(value);
    setActivePreset(null);
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    setLoadingMessage(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]);
    
    async function fetchAllOrders() {
      let allOrders = [];
      let offset = 0;
      const limit = 1000;
      
      // Timezone offset pro správné filtrování podle lokálního času (CET/CEST)
      // +01:00 → %2B01:00 (URL encoding pro Supabase PostgREST)
      const tzOffset = -new Date().getTimezoneOffset();
      const tzSign = tzOffset >= 0 ? '%2B' : '-';
      const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
      const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0');
      const tz = `${tzSign}${tzHours}:${tzMins}`;

      while (true) {
        const response = await fetch(
          `${SUPABASE_URL}/rest/v1/orders?select=*&order_date=gte.${dateFrom}T00:00:00${tz}&order_date=lte.${dateTo}T23:59:59${tz}&order=order_date.desc&limit=${limit}&offset=${offset}`, 
          {
            headers: { 
              'apikey': SUPABASE_KEY, 
              'Authorization': `Bearer ${SUPABASE_KEY}`
            }
          }
        );
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        if (!Array.isArray(data) || data.length === 0) break;
        
        allOrders = allOrders.concat(data);
        offset += limit;
        
        if (data.length < limit) break;
      }
      
      return allOrders;
    }
    
    fetchAllOrders()
      .then(d => {
        const deduped = deduplicateOrders(d);
        setOrders(deduped);
        if (deduped.length < d.length) {
          console.warn(`⚠️ Deduplikace: ${d.length} → ${deduped.length} (odstraněno ${d.length - deduped.length} duplikátů)`);
        }
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [dateFrom, dateTo]);

  const filtered = useMemo(() => country === 'all' ? orders : orders.filter(o => o.market === country), [orders, country]);

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
    let cnt = 0, rev = 0, b2b = 0, big = 0;
    filtered.forEach(o => { 
      cnt++; 
      rev += getRevenueWithoutVAT(o); 
      if (isB2B(o)) b2b++; 
      if (isBigCity(o.raw_data?.customer?.city_invoice, o.market)) big++; 
    });
    return { 
      orders: cnt, 
      revenue: rev, 
      aov: cnt ? rev / cnt : 0, 
      b2bPct: cnt ? b2b / cnt * 100 : 0, 
      bigPct: cnt ? big / cnt * 100 : 0 
    };
  }, [filtered]);

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

  const geoStats = useMemo(() => {
    let bigC = { o: 0, r: 0 }, smallC = { o: 0, r: 0 };
    const cities = {};
    filtered.forEach(o => {
      const rawCity = o.raw_data?.customer?.city_invoice || '';
      const city = aggregateCity(rawCity);
      const r = getRevenueWithoutVAT(o);
      const big = isBigCity(rawCity, o.market);
      
      if (big) { bigC.o++; bigC.r += r; } else { smallC.o++; smallC.r += r; }
      
      if (!cities[city]) cities[city] = { n: city, o: 0, r: 0 }; 
      cities[city].o++; 
      cities[city].r += r;
    });
    const top = Object.values(cities)
      .filter(x => x.o >= 2)
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

  if (authLoading) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
    </div>
  );

  if (!user) return <LoginPage onLogin={handleLogin} error={authError} />;

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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
      {loading && <LoadingOverlay message={loadingMessage} />}
      
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">📊 Order Analytics</h1>
            <p className="text-slate-500 text-sm">REGAL MASTER - Analýza objednávek (bez DPH a poštovného)</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{user.email}</span>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all"
            >
              Odhlásit
            </button>
          </div>
        </div>

        {/* Date Presets */}
        <div className="bg-white rounded-xl p-3 shadow-sm border mb-4">
          <div className="flex flex-wrap gap-2 mb-3">
            <DatePresetButton label="Dnes" active={activePreset === 'today'} onClick={() => applyPreset('today')} />
            <DatePresetButton label="Včera" active={activePreset === 'yesterday'} onClick={() => applyPreset('yesterday')} />
            <DatePresetButton label="Tento týden" active={activePreset === 'this_week'} onClick={() => applyPreset('this_week')} />
            <DatePresetButton label="Minulý týden" active={activePreset === 'last_week'} onClick={() => applyPreset('last_week')} />
            <DatePresetButton label="Tento měsíc" active={activePreset === 'this_month'} onClick={() => applyPreset('this_month')} />
            <DatePresetButton label="Minulý měsíc" active={activePreset === 'last_month'} onClick={() => applyPreset('last_month')} />
            <DatePresetButton label="30 dní" active={activePreset === 'last_30'} onClick={() => applyPreset('last_30')} />
            <DatePresetButton label="90 dní" active={activePreset === 'last_90'} onClick={() => applyPreset('last_90')} />
            <DatePresetButton label="Vše" active={activePreset === 'all'} onClick={() => applyPreset('all')} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Vlastní:</span>
            <input 
              type="date" 
              value={dateFrom} 
              onChange={e => handleDateChange('from', e.target.value)} 
              className="px-2 py-1 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" 
            />
            <span className="text-slate-400">→</span>
            <input 
              type="date" 
              value={dateTo} 
              onChange={e => handleDateChange('to', e.target.value)} 
              className="px-2 py-1 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" 
            />
          </div>
        </div>

        {/* Country filter */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {[
            { c: 'all', f: '🌍', n: 'Všechny země' }, 
            { c: 'cz', f: '🇨🇿', n: 'Česko' }, 
            { c: 'sk', f: '🇸🇰', n: 'Slovensko' }, 
            { c: 'hu', f: '🇭🇺', n: 'Maďarsko' }
          ].map(x => (
            <button 
              key={x.c} 
              onClick={() => setCountry(x.c)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                country === x.c 
                  ? 'bg-blue-500 text-white shadow-md' 
                  : 'bg-white border border-slate-200 text-slate-600 hover:border-blue-300 hover:shadow-sm'
              }`}
            >
              {x.f} {x.n}
            </button>
          ))}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KPICard title="Objednávky" value={formatNumber(kpis.orders)} icon="🛒" />
          <KPICard title="Obrat (bez DPH)" value={formatCurrency(kpis.revenue)} icon="💰" />
          <KPICard title="Ø Objednávka" value={formatCurrency(kpis.aov)} icon="📦" />
          <KPICard title="B2B podíl" value={`${kpis.b2bPct.toFixed(0)}%`} icon="🏢" sub={`🏙️ Velká města: ${kpis.bigPct.toFixed(0)}%`} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white p-1 rounded-xl shadow-sm border mb-4">
          {[
            { id: 'heatmap', l: '🗓️ Časová analýza' }, 
            { id: 'geo', l: '📍 Geografie' }, 
            { id: 'b2b', l: '🏢 B2B / B2C' }
          ].map(t => (
            <button 
              key={t.id} 
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                tab === t.id 
                  ? 'bg-blue-500 text-white shadow-md' 
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              {t.l}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border">
          {tab === 'heatmap' && (
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
            </>
          )}

          {tab === 'geo' && (
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
                <h3 className="text-sm font-semibold text-slate-700 mb-3">🏆 Top města podle AOV</h3>
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

          {tab === 'b2b' && (
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

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-sm text-slate-400 mb-1">
            {formatNumber(filtered.length)} objednávek • Live data ze Supabase • 
            Aktualizace: {new Date().toLocaleString('cs-CZ')}
          </p>
          <p className="text-xs text-slate-300 italic">
            🚀 Tady taky stavíme impérium :)
          </p>
        </div>
      </div>
    </div>
  );
}
