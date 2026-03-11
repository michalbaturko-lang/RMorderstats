import React, { useState, useEffect, useMemo, useCallback } from 'react';

const genId = () => Math.random().toString(36).substr(2, 9);

const MONTHS = [
  { value: '2026-01', label: 'Leden 2026' },
  { value: '2026-02', label: 'Únor 2026' },
  { value: '2026-03', label: 'Březen 2026' },
  { value: '2026-04', label: 'Duben 2026' },
  { value: '2026-05', label: 'Květen 2026' },
  { value: '2026-06', label: 'Červen 2026' },
  { value: '2026-07', label: 'Červenec 2026' },
  { value: '2026-08', label: 'Srpen 2026' },
  { value: '2026-09', label: 'Září 2026' },
  { value: '2026-10', label: 'Říjen 2026' },
  { value: '2026-11', label: 'Listopad 2026' },
  { value: '2026-12', label: 'Prosinec 2026' },
];

const BANK_SOURCES = [
  { value: '2026-01', label: 'Leden 2026' },
  { value: '2026-02', label: 'Únor 2026' },
  { value: '2026-03', label: 'Březen 2026' },
];

const formatNum = (num) => Math.round(num).toLocaleString('cs-CZ');
const formatCZK = (num) => `${formatNum(num)} Kč`;

const CURRENCY_RATES = { CZK: 1, EUR: 25.2, HUF: 0.063 };

const getRevenueWithoutVAT = (order) => {
  const products = order.raw_data?.products || [];
  let total = 0;
  products.forEach(p => { total += parseFloat(p.price_without_vat || 0); });
  const currency = order.currency || 'CZK';
  return total * (CURRENCY_RATES[currency] || 1);
};

// Ads-related keywords to auto-flag in bank items
const ADS_KEYWORDS = ['google', 'ads', 'adwords', 'facebook', 'meta', 'sklik', 'seznam'];

const isAdsRelated = (description) => {
  const lower = (description || '').toLowerCase();
  return ADS_KEYWORDS.some(kw => lower.includes(kw));
};

const getDefaultMonthData = (month) => ({
  revenueManual: null,
  cogs: 0,
  marketing: {
    ads: month === '2026-01' ? 520000 : 0,
    sklik: 0,
    facebook: 0,
  },
  cashExpenses: [],
});

const STORAGE_KEY = 'rm_finance_v1';

const loadFinanceState = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) { /* ignore */ }
  return null;
};

const saveFinanceState = (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* ignore */ }
};

// ─── AI Category classification ───────────────────────────────────────────
const EXPENSE_CATEGORIES = [
  { id: 'mzdy', label: 'Mzdy', icon: '👤', color: 'blue' },
  { id: 'jednorazove', label: 'Jednorázové náklady', icon: '⚡', color: 'amber' },
  { id: 'najmy', label: 'Nájmy', icon: '🏠', color: 'purple' },
  { id: 'dopravci', label: 'Dopravci', icon: '🚚', color: 'emerald' },
  { id: 'ostatni', label: 'Ostatní', icon: '📦', color: 'slate' },
];

// Keyword-based classification rules
const CATEGORY_RULES = [
  // Dopravci
  { pattern: /ppl|dpd|gls|zásilkovna|zasilkovna|česká pošta|ceska posta|packeta|balíkovna|balikovn|toptrans|geis|wedo|fedex|ups|dhl|messenger|kurýr|kuryr|doprav|shipping|foxdeli|spring/i, category: 'dopravci' },
  // Mzdy
  { pattern: /mzd[ay]|plat[y ]|výplat|odměn|pojišt[oě]|sociální|zdravotní|soci[aá]ln|zdrav|superhrubá|odvod|OSSZ|VZP|zaměstnan|zamestnan|personál|personal|DPP|DPČ/i, category: 'mzdy' },
  // Nájmy
  { pattern: /nájem|najem|nájm|najm|rent|pronájem|pronajem|kancelář|kancelar|sklad|warehouse|nebytov|prostor|budov|reality|realit/i, category: 'najmy' },
  // Jednorázové - office supplies, equipment, one-off purchases from retail
  { pattern: /alza|ikea|datart|mall\.cz|czc\.cz|electroworld|notino|rohlik|rohlík|tesco|albert|kaufland|lidl|penny|globus|makro|billa|dm drogerie|rossmann|kancelářsk|kancelarsk|tiskárn|tiskarn|notebook|počítač|pocitac|telefon|monitor|toner|cartridge|nábytek|nabytek|buffalo|steak|restaurant|restaurac|hotel|ubytov|letenk|air china|flughafen|booking|airbnb/i, category: 'jednorazove' },
];

const classifyExpense = (description) => {
  const text = (description || '').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return 'ostatni';
};

// ─── Vendor name normalization for grouping ──────────────────────────────
const normalizeVendor = (description) => {
  const text = (description || '').trim();
  // Known vendor patterns
  const vendorPatterns = [
    { pattern: /alza/i, name: 'Alza.cz' },
    { pattern: /ikea/i, name: 'IKEA' },
    { pattern: /rohli[ck]|rohlík/i, name: 'Rohlík.cz' },
    { pattern: /ppl/i, name: 'PPL' },
    { pattern: /dpd/i, name: 'DPD' },
    { pattern: /gls/i, name: 'GLS' },
    { pattern: /zásilkov|zasilkov|packeta/i, name: 'Zásilkovna' },
    { pattern: /česká pošta|ceska posta/i, name: 'Česká pošta' },
    { pattern: /google/i, name: 'Google' },
    { pattern: /facebook|meta platform/i, name: 'Meta / Facebook' },
    { pattern: /seznam|sklik/i, name: 'Seznam / Sklik' },
    { pattern: /datart/i, name: 'Datart' },
    { pattern: /mall\.cz/i, name: 'Mall.cz' },
    { pattern: /czc/i, name: 'CZC.cz' },
    { pattern: /tesco/i, name: 'Tesco' },
    { pattern: /albert/i, name: 'Albert' },
    { pattern: /kaufland/i, name: 'Kaufland' },
    { pattern: /lidl/i, name: 'Lidl' },
    { pattern: /makro/i, name: 'Makro' },
    { pattern: /buffalo steak/i, name: 'Buffalo Steakhouse' },
    { pattern: /air china/i, name: 'Air China' },
    { pattern: /flughafen/i, name: 'Flughafen Wien' },
    { pattern: /foxdeli/i, name: 'Foxdeli' },
    { pattern: /wedo/i, name: 'WeDo' },
  ];

  for (const v of vendorPatterns) {
    if (v.pattern.test(text)) return v.name;
  }

  // Fallback: use first 2-3 words (up to comma or dash), capitalized
  const short = text.split(/[,\-–]/)[0].trim();
  // Limit to ~40 chars
  return short.length > 40 ? short.substring(0, 37) + '...' : short;
};

// ─── Collapsible section component ───────────────────────────────────────
const Section = ({ title, icon, children, defaultOpen = true, badge }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-4 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span>{icon}</span>
          <span className="font-semibold text-slate-800">{title}</span>
          {badge && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{badge}</span>}
        </div>
        <span className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>&#9660;</span>
      </button>
      {open && <div className="px-5 pb-5 border-t border-slate-100">{children}</div>}
    </div>
  );
};

// Input field for currency amounts
const CurrencyInput = ({ label, value, onChange, placeholder, disabled, hint }) => (
  <div className="flex-1">
    <label className="block text-xs text-slate-500 mb-1">{label}</label>
    <div className="relative">
      <input
        type="number"
        value={value || ''}
        onChange={e => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
        placeholder={placeholder || '0'}
        disabled={disabled}
        className={`w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${disabled ? 'bg-slate-50 text-slate-400' : ''}`}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Kč</span>
    </div>
    {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
  </div>
);

// HV Result card
const HVCard = ({ label, value, color, sub }) => {
  const isPositive = value >= 0;
  const colorMap = {
    blue: 'from-blue-500 to-blue-600',
    purple: 'from-purple-500 to-purple-600',
    emerald: 'from-emerald-500 to-emerald-600',
  };
  return (
    <div className={`rounded-xl p-4 bg-gradient-to-br ${colorMap[color]} text-white shadow-lg`}>
      <div className="text-xs uppercase tracking-wider opacity-80 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${!isPositive ? 'text-red-200' : ''}`}>
        {isPositive ? '' : '- '}{formatCZK(Math.abs(value))}
      </div>
      {sub && <div className="text-xs opacity-70 mt-1">{sub}</div>}
    </div>
  );
};

// ─── Category Column Component ───────────────────────────────────────────
const CategoryColumn = ({ category, items, onDrop, onRemove, onMoveToCategory, allCategories, expandedVendors, toggleVendor }) => {
  const [dropActive, setDropActive] = useState(false);

  const colorMap = {
    blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', dropBg: 'bg-blue-100', badge: 'bg-blue-100 text-blue-800', header: 'bg-blue-500' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dropBg: 'bg-amber-100', badge: 'bg-amber-100 text-amber-800', header: 'bg-amber-500' },
    purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', dropBg: 'bg-purple-100', badge: 'bg-purple-100 text-purple-800', header: 'bg-purple-500' },
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dropBg: 'bg-emerald-100', badge: 'bg-emerald-100 text-emerald-800', header: 'bg-emerald-500' },
    slate: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', dropBg: 'bg-slate-100', badge: 'bg-slate-100 text-slate-800', header: 'bg-slate-500' },
  };
  const colors = colorMap[category.color] || colorMap.slate;

  const total = items.reduce((sum, i) => sum + i.amount, 0);

  // Group items by normalized vendor
  const vendorGroups = useMemo(() => {
    const groups = {};
    items.forEach(item => {
      const vendor = normalizeVendor(item.description);
      if (!groups[vendor]) groups[vendor] = { vendor, items: [], total: 0 };
      groups[vendor].items.push(item);
      groups[vendor].total += item.amount;
    });
    return Object.values(groups).sort((a, b) => b.total - a.total);
  }, [items]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropActive(true);
  }, []);

  const handleDragLeave = useCallback(() => setDropActive(false), []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDropActive(false);
    const data = e.dataTransfer.getData('text/plain');
    if (data) {
      try {
        const parsed = JSON.parse(data);
        onDrop(parsed.itemId, parsed.fromCategory, category.id);
      } catch {
        // Legacy: just itemId string from bank list
        onDrop(data, null, category.id);
      }
    }
  }, [onDrop, category.id]);

  return (
    <div className={`rounded-xl border ${colors.border} overflow-hidden flex flex-col`}>
      {/* Header */}
      <div className={`${colors.header} text-white px-3 py-2 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span>{category.icon}</span>
          <span className="text-sm font-semibold">{category.label}</span>
        </div>
        <span className="text-xs font-bold bg-white/20 px-2 py-0.5 rounded-full">
          {formatCZK(total)}
        </span>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex-1 min-h-[80px] p-2 transition-all ${dropActive ? colors.dropBg : colors.bg}`}
      >
        {vendorGroups.length === 0 && !dropActive && (
          <div className={`text-center py-4 text-xs ${colors.text} opacity-50`}>
            Přetáhněte sem
          </div>
        )}
        {dropActive && vendorGroups.length === 0 && (
          <div className={`text-center py-4 text-xs font-medium ${colors.text}`}>
            Pustit pro přiřazení
          </div>
        )}

        <div className="space-y-1">
          {vendorGroups.map(group => {
            const isExpanded = expandedVendors.has(`${category.id}:${group.vendor}`);
            const hasMultiple = group.items.length > 1;

            return (
              <div key={group.vendor}>
                {/* Vendor summary row */}
                <div
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white border ${colors.border} shadow-sm ${hasMultiple ? 'cursor-pointer hover:shadow-md' : ''} transition-all`}
                  draggable={!hasMultiple}
                  onDragStart={!hasMultiple ? (e) => {
                    const item = group.items[0];
                    e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.id, fromCategory: category.id }));
                    e.dataTransfer.effectAllowed = 'move';
                  } : undefined}
                  onClick={hasMultiple ? () => toggleVendor(`${category.id}:${group.vendor}`) : undefined}
                >
                  {hasMultiple && (
                    <span className={`text-[10px] ${colors.text} transition-transform ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-700 truncate">{group.vendor}</div>
                    {hasMultiple && (
                      <div className="text-[10px] text-slate-400">{group.items.length} položek</div>
                    )}
                  </div>
                  <span className={`text-xs font-bold ${colors.text} whitespace-nowrap`}>{formatCZK(group.total)}</span>
                  {/* Move to other category dropdown */}
                  <select
                    className="text-[10px] bg-transparent border-none text-slate-400 cursor-pointer w-5 appearance-none hover:text-slate-600"
                    title="Přesunout do jiné kategorie"
                    value=""
                    onClick={e => e.stopPropagation()}
                    onChange={e => {
                      if (e.target.value) {
                        group.items.forEach(item => onMoveToCategory(item.id, category.id, e.target.value));
                        e.target.value = '';
                      }
                    }}
                  >
                    <option value="">&#8942;</option>
                    {allCategories.filter(c => c.id !== category.id).map(c => (
                      <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
                    ))}
                    <option value="__remove__">&#10005; Odebrat</option>
                  </select>
                </div>

                {/* Expanded items */}
                {isExpanded && hasMultiple && (
                  <div className="ml-4 mt-1 space-y-0.5">
                    {group.items.map(item => (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={e => {
                          e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.id, fromCategory: category.id }));
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        className={`flex items-center gap-2 px-2 py-1 rounded bg-white/80 border ${colors.border} text-[11px] cursor-grab active:cursor-grabbing`}
                      >
                        <span className="text-slate-300">&#9776;</span>
                        <div className="flex-1 min-w-0 truncate text-slate-600">{item.description}</div>
                        <span className={`font-medium ${colors.text} whitespace-nowrap`}>{formatCZK(item.amount)}</span>
                        <button
                          onClick={() => onRemove(item.id)}
                          className="text-slate-300 hover:text-red-500 transition-colors"
                          title="Odebrat"
                        >&#10005;</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Single item: show description below vendor if different */}
                {!hasMultiple && group.items[0].description !== group.vendor && (
                  <div className="ml-2 text-[10px] text-slate-400 truncate px-2 -mt-0.5 mb-0.5">
                    {group.items[0].date && `${group.items[0].date} • `}{group.items[0].description.substring(0, 60)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Main FinanceModule
// ═══════════════════════════════════════════════════════════════════════════

export default function FinanceModule({ supabaseUrl, supabaseKey, supabase }) {
  const saved = useMemo(() => loadFinanceState(), []);

  const [selectedMonth, setSelectedMonth] = useState(saved?.selectedMonth || '2026-01');
  const [monthsData, setMonthsData] = useState(saved?.monthsData || {});
  const [bankItems, setBankItems] = useState(saved?.bankItems || []);
  const [assignedItems, setAssignedItems] = useState(saved?.assignedItems || {}); // { '2026-01': ['id1', ...] }
  // Category assignments: { itemId: 'mzdy' | 'jednorazove' | 'najmy' | 'dopravci' | 'ostatni' }
  const [itemCategories, setItemCategories] = useState(saved?.itemCategories || {});
  const [autoRevenue, setAutoRevenue] = useState(0);
  const [loadingRevenue, setLoadingRevenue] = useState(false);
  const [showAddBank, setShowAddBank] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [bankFilter, setBankFilter] = useState('all');
  const [hideAds, setHideAds] = useState(true);
  const [csvSource, setCsvSource] = useState('2026-01');
  const [expandedVendors, setExpandedVendors] = useState(new Set());

  // New bank item form
  const [newItem, setNewItem] = useState({ date: '', description: '', amount: '', source: '2026-01' });
  const [bulkText, setBulkText] = useState('');

  // New cash expense form
  const [newCash, setNewCash] = useState({ description: '', amount: '' });

  // Save to localStorage on changes
  useEffect(() => {
    saveFinanceState({ selectedMonth, monthsData, bankItems, assignedItems, itemCategories });
  }, [selectedMonth, monthsData, bankItems, assignedItems, itemCategories]);

  // Get/set current month data
  const currentData = monthsData[selectedMonth] || getDefaultMonthData(selectedMonth);
  const updateCurrentData = useCallback((updates) => {
    setMonthsData(prev => ({
      ...prev,
      [selectedMonth]: { ...(prev[selectedMonth] || getDefaultMonthData(selectedMonth)), ...updates }
    }));
  }, [selectedMonth]);

  // Fetch revenue from Supabase for selected month (using Supabase JS client for reliability)
  useEffect(() => {
    if (!supabase && !supabaseUrl) return;
    setLoadingRevenue(true);
    setAutoRevenue(0);

    const [year, month] = selectedMonth.split('-');
    const dateFrom = `${year}-${month}-01T00:00:00`;
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const dateTo = `${year}-${month}-${String(lastDay).padStart(2, '0')}T23:59:59`;

    async function fetchRevenue() {
      let allOrders = [];
      let offset = 0;
      const limit = 1000;

      if (supabase) {
        // Use Supabase JS client (same as main App uses)
        while (true) {
          const { data, error } = await supabase
            .from('orders')
            .select('*')
            .gte('order_date', dateFrom)
            .lte('order_date', dateTo)
            .order('order_date', { ascending: false })
            .range(offset, offset + limit - 1);

          if (error) {
            console.error(`Finance: Supabase error for ${selectedMonth}:`, error);
            throw error;
          }
          if (!data || data.length === 0) break;
          allOrders = allOrders.concat(data);
          offset += limit;
          if (data.length < limit) break;
        }
      } else {
        // Fallback: raw fetch
        const tzOffset = -new Date().getTimezoneOffset();
        const tzSign = tzOffset >= 0 ? '%2B' : '-';
        const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
        const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0');
        const tz = `${tzSign}${tzHours}:${tzMins}`;

        while (true) {
          const url = `${supabaseUrl}/rest/v1/orders?select=*&order_date=gte.${dateFrom}${tz}&order_date=lte.${dateTo}${tz}&order=order_date.desc&limit=${limit}&offset=${offset}`;
          const response = await fetch(url, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          if (!Array.isArray(data) || data.length === 0) break;
          allOrders = allOrders.concat(data);
          offset += limit;
          if (data.length < limit) break;
        }
      }

      // Deduplicate & filter cancelled
      const seen = new Set();
      const clean = allOrders.filter(o => {
        const key = o.raw_data?.order_number || o.id;
        if (seen.has(key)) return false;
        seen.add(key);
        const s1 = (o.status || '').toUpperCase();
        const s2 = (o.raw_data?.status || '').toUpperCase();
        return s1 !== 'STORNO' && s2 !== 'STORNO';
      });

      console.log(`Finance: ${selectedMonth} → ${clean.length} orders, raw: ${allOrders.length}`);

      let totalRevenue = 0;
      clean.forEach(o => { totalRevenue += getRevenueWithoutVAT(o); });
      return totalRevenue;
    }

    fetchRevenue()
      .then(rev => {
        console.log(`Finance: ${selectedMonth} revenue = ${rev}`);
        setAutoRevenue(rev);
        setLoadingRevenue(false);
      })
      .catch(err => {
        console.error(`Finance: fetch failed for ${selectedMonth}:`, err);
        setLoadingRevenue(false);
      });
  }, [selectedMonth, supabase, supabaseUrl, supabaseKey]);

  // Computed values
  const revenue = currentData.revenueManual !== null ? currentData.revenueManual : autoRevenue;
  const cogs = currentData.cogs || 0;
  const marketingTotal = (currentData.marketing?.ads || 0) + (currentData.marketing?.sklik || 0) + (currentData.marketing?.facebook || 0);

  const monthAssigned = assignedItems[selectedMonth] || [];
  const assignedBankItems = bankItems.filter(bi => monthAssigned.includes(bi.id));
  const assignedCostsTotal = assignedBankItems.reduce((sum, bi) => sum + bi.amount, 0);
  const cashTotal = (currentData.cashExpenses || []).reduce((sum, ce) => sum + ce.amount, 0);
  const operatingTotal = assignedCostsTotal + cashTotal;

  const hv1 = revenue - cogs;
  const hv2 = hv1 - marketingTotal;
  const hv3 = hv2 - operatingTotal;

  // All items assigned to ANY month (to visually mark them)
  const allAssigned = useMemo(() => {
    const set = new Set();
    Object.values(assignedItems).forEach(ids => ids.forEach(id => set.add(id)));
    return set;
  }, [assignedItems]);

  // Filtered bank items for the left panel
  const filteredBankItems = useMemo(() => {
    let items = bankItems;
    if (bankFilter !== 'all') items = items.filter(bi => bi.source === bankFilter);
    if (hideAds) items = items.filter(bi => !bi.adsRelated);
    return items;
  }, [bankItems, bankFilter, hideAds]);

  // Items NOT assigned to current month (available for drag)
  const availableItems = filteredBankItems.filter(bi => !monthAssigned.includes(bi.id));

  // Group available items by vendor for the left panel
  const availableVendorGroups = useMemo(() => {
    const groups = {};
    availableItems.forEach(item => {
      const vendor = normalizeVendor(item.description);
      if (!groups[vendor]) groups[vendor] = { vendor, items: [], total: 0 };
      groups[vendor].items.push(item);
      groups[vendor].total += item.amount;
    });
    return Object.values(groups).sort((a, b) => b.total - a.total);
  }, [availableItems]);

  const [expandedAvailableVendors, setExpandedAvailableVendors] = useState(new Set());

  // Items per category for the current month
  const categoryItems = useMemo(() => {
    const result = {};
    EXPENSE_CATEGORIES.forEach(cat => { result[cat.id] = []; });
    assignedBankItems.forEach(item => {
      const cat = itemCategories[item.id] || 'ostatni';
      if (result[cat]) result[cat].push(item);
      else result.ostatni.push(item);
    });
    return result;
  }, [assignedBankItems, itemCategories]);

  // ─── Drag & Drop handlers ──────────────────────────────────────────────

  // Assign item from bank list to a category column
  const handleAssignToCategory = useCallback((itemId, fromCategory, toCategory) => {
    if (toCategory === '__remove__') {
      // Remove from assigned
      setAssignedItems(prev => ({
        ...prev,
        [selectedMonth]: (prev[selectedMonth] || []).filter(id => id !== itemId)
      }));
      setItemCategories(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      return;
    }

    // If not yet assigned to this month, assign it
    if (!monthAssigned.includes(itemId)) {
      setAssignedItems(prev => ({
        ...prev,
        [selectedMonth]: [...(prev[selectedMonth] || []), itemId]
      }));
    }

    // Set/move category
    setItemCategories(prev => ({ ...prev, [itemId]: toCategory }));
  }, [selectedMonth, monthAssigned]);

  // Move item between categories
  const handleMoveToCategory = useCallback((itemId, fromCategory, toCategory) => {
    if (toCategory === '__remove__') {
      setAssignedItems(prev => ({
        ...prev,
        [selectedMonth]: (prev[selectedMonth] || []).filter(id => id !== itemId)
      }));
      setItemCategories(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      return;
    }
    setItemCategories(prev => ({ ...prev, [itemId]: toCategory }));
  }, [selectedMonth]);

  const handleRemoveFromCategory = useCallback((itemId) => {
    setAssignedItems(prev => ({
      ...prev,
      [selectedMonth]: (prev[selectedMonth] || []).filter(id => id !== itemId)
    }));
    setItemCategories(prev => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }, [selectedMonth]);

  const toggleVendor = useCallback((key) => {
    setExpandedVendors(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAvailableVendor = useCallback((vendor) => {
    setExpandedAvailableVendors(prev => {
      const next = new Set(prev);
      if (next.has(vendor)) next.delete(vendor);
      else next.add(vendor);
      return next;
    });
  }, []);

  // Drag from bank list: auto-classify on drop
  const handleBankDragStart = useCallback((e, item) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
  }, []);

  // Drag from bank list (group of items)
  const handleBankGroupDragStart = useCallback((e, items) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ groupItemIds: items.map(i => i.id) }));
  }, []);

  // Handle drop on category: auto-classify if from bank list
  const handleCategoryDrop = useCallback((rawItemId, fromCategory, toCategory) => {
    if (toCategory === '__remove__') {
      handleMoveToCategory(rawItemId, fromCategory, '__remove__');
      return;
    }

    // Check if it's a group drop
    try {
      const parsed = JSON.parse(rawItemId);
      if (parsed.groupItemIds) {
        // Group of items from bank list
        parsed.groupItemIds.forEach(id => {
          if (!monthAssigned.includes(id)) {
            setAssignedItems(prev => ({
              ...prev,
              [selectedMonth]: [...(prev[selectedMonth] || []), id]
            }));
          }
          setItemCategories(prev => ({ ...prev, [id]: toCategory }));
        });
        return;
      }
      if (parsed.itemId) {
        // Single item from category column
        handleAssignToCategory(parsed.itemId, parsed.fromCategory, toCategory);
        return;
      }
    } catch {
      // Not JSON - it's a plain itemId from bank list
    }

    // New item from bank list - auto-classify to the dropped category
    if (!monthAssigned.includes(rawItemId)) {
      const item = bankItems.find(bi => bi.id === rawItemId);
      setAssignedItems(prev => ({
        ...prev,
        [selectedMonth]: [...(prev[selectedMonth] || []), rawItemId]
      }));
      setItemCategories(prev => ({ ...prev, [rawItemId]: toCategory }));
    } else {
      // Already assigned, just re-categorize
      setItemCategories(prev => ({ ...prev, [rawItemId]: toCategory }));
    }
  }, [selectedMonth, monthAssigned, bankItems, handleAssignToCategory, handleMoveToCategory]);

  // Auto-assign to correct category (AI button)
  const autoAssignAll = useCallback(() => {
    // Take all available items (not assigned), classify and assign them
    const newAssignments = {};
    const toAssign = [];

    availableItems.forEach(item => {
      const cat = classifyExpense(item.description);
      newAssignments[item.id] = cat;
      toAssign.push(item.id);
    });

    if (toAssign.length === 0) return;

    setAssignedItems(prev => ({
      ...prev,
      [selectedMonth]: [...(prev[selectedMonth] || []), ...toAssign]
    }));
    setItemCategories(prev => ({ ...prev, ...newAssignments }));
  }, [availableItems, selectedMonth]);

  // Add single bank item
  const addBankItem = () => {
    if (!newItem.description || !newItem.amount) return;
    const item = {
      id: genId(),
      date: newItem.date || '',
      description: newItem.description,
      amount: Math.abs(parseFloat(newItem.amount)) || 0,
      source: newItem.source,
      adsRelated: isAdsRelated(newItem.description),
    };
    setBankItems(prev => [...prev, item]);
    setNewItem({ date: '', description: '', amount: '', source: newItem.source });
  };

  // Bulk add bank items
  const addBulkItems = () => {
    if (!bulkText.trim()) return;
    const lines = bulkText.trim().split('\n');
    const newItems = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/[;\t]/).map(p => p.trim());
      let date = '', description = '', amount = 0;

      if (parts.length >= 3) {
        date = parts[0];
        description = parts[1];
        amount = Math.abs(parseFloat(parts[2].replace(/\s/g, '').replace(',', '.'))) || 0;
      } else if (parts.length === 2) {
        description = parts[0];
        amount = Math.abs(parseFloat(parts[1].replace(/\s/g, '').replace(',', '.'))) || 0;
      } else {
        const match = trimmed.match(/^(.+?)\s+([\d\s,.]+)\s*(?:Kč|CZK)?$/i);
        if (match) {
          description = match[1].trim();
          amount = Math.abs(parseFloat(match[2].replace(/\s/g, '').replace(',', '.'))) || 0;
        } else {
          description = trimmed;
        }
      }

      if (description) {
        newItems.push({
          id: genId(),
          date,
          description,
          amount,
          source: bankFilter !== 'all' ? bankFilter : '2026-01',
          adsRelated: isAdsRelated(description),
        });
      }
    }
    if (newItems.length > 0) {
      setBankItems(prev => [...prev, ...newItems]);
      setBulkText('');
      setShowBulkAdd(false);
    }
  };

  // Delete bank item
  const deleteBankItem = (itemId) => {
    setBankItems(prev => prev.filter(bi => bi.id !== itemId));
    setAssignedItems(prev => {
      const updated = {};
      for (const [month, ids] of Object.entries(prev)) {
        updated[month] = ids.filter(id => id !== itemId);
      }
      return updated;
    });
    setItemCategories(prev => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  // Proper CSV line parser
  const parseCsvLine = (line, sep) => {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === sep && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const parseCzechNumber = (str) => {
    if (!str) return 0;
    const cleaned = str.replace(/[^\d,.\-]/g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
  };

  // CSV import handler
  const handleCsvImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      let text = event.target.result;
      text = text.replace(/^\uFEFF/, '').trim();

      const lines = text.split(/\r?\n/);
      const newItems = [];

      let headerLineIdx = 0;
      for (let i = 0; i < Math.min(lines.length, 10); i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const lower = line.toLowerCase();
        if (lower.includes('datum') || lower.includes('date') || lower.includes('částka') || lower.includes('objem')) {
          headerLineIdx = i;
          break;
        }
        if (i === 0 && (line.match(/;/g) || []).length >= 3) {
          headerLineIdx = 0;
          break;
        }
      }

      const headerLine = lines[headerLineIdx] || '';
      const sep = (headerLine.match(/;/g) || []).length >= 2 ? ';'
                : (headerLine.match(/\t/g) || []).length >= 2 ? '\t'
                : ',';

      const headers = parseCsvLine(headerLine, sep).map(h => h.toLowerCase().replace(/"/g, ''));

      const dateCol = headers.findIndex(h => /^datum$|^date$/.test(h));
      const amountCol = headers.findIndex(h => /objem|částka|castka|suma|amount|hodnota|čás/.test(h));
      const currencyCol = headers.findIndex(h => /měna|mena|currency/.test(h));
      const descCols = {
        zprava: headers.findIndex(h => /zpráva|zprava|message/.test(h)),
        poznamka: headers.findIndex(h => /poznámka|poznamka|komentář|komentar|note/.test(h)),
        prijemce: headers.findIndex(h => /název proti|nazev proti|příjemce|prijemce|protiúčet|protiucet/.test(h)),
        popis: headers.findIndex(h => /popis|description|detail|text/.test(h)),
        typ: headers.findIndex(h => /^typ$|^type$/.test(h)),
      };

      const hasHeader = dateCol >= 0 || amountCol >= 0;
      if (!hasHeader) {
        alert('Nepodařilo se rozpoznat hlavičku CSV. Očekávám sloupce jako "Datum", "Objem"/"Částka", "Zpráva pro příjemce" atd.');
        return;
      }

      const startRow = headerLineIdx + 1;

      for (let i = startRow; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = parseCsvLine(line, sep);

        if (/suma |počáteční|koncový|celkem|zůstatek|balance/i.test(cols.join(' '))) continue;

        const date = dateCol >= 0 ? cols[dateCol] || '' : '';
        const rawAmount = amountCol >= 0 ? cols[amountCol] || '0' : '0';
        const amount = parseCzechNumber(rawAmount);
        const currency = currencyCol >= 0 ? (cols[currencyCol] || 'CZK').toUpperCase() : 'CZK';

        let description = '';
        const zpravaVal = descCols.zprava >= 0 ? (cols[descCols.zprava] || '').trim() : '';
        const poznamkaVal = descCols.poznamka >= 0 ? (cols[descCols.poznamka] || '').trim() : '';
        const prijemceVal = descCols.prijemce >= 0 ? (cols[descCols.prijemce] || '').trim() : '';
        const popisVal = descCols.popis >= 0 ? (cols[descCols.popis] || '').trim() : '';
        const typVal = descCols.typ >= 0 ? (cols[descCols.typ] || '').trim() : '';

        if (zpravaVal) {
          description = zpravaVal;
        } else if (poznamkaVal) {
          description = poznamkaVal;
        } else if (prijemceVal) {
          description = prijemceVal;
        } else if (popisVal) {
          description = popisVal;
        } else {
          description = [prijemceVal, poznamkaVal, typVal].filter(Boolean).join(' | ') || `Řádek ${i + 1}`;
        }

        description = description.replace(/^Nákup:\s*/i, '');
        if (description.length > 100) {
          description = description.substring(0, 97) + '...';
        }

        if (amount === 0) continue;

        newItems.push({
          id: genId(),
          date,
          description,
          amount: Math.abs(amount),
          source: csvSource,
          adsRelated: isAdsRelated(description),
          isExpense: amount < 0,
          currency,
          type: typVal,
        });
      }

      if (newItems.length > 0) {
        const hasNegative = newItems.some(i => i.isExpense);
        const toImport = hasNegative ? newItems.filter(i => i.isExpense) : newItems;
        const cleaned = toImport.map(({ isExpense, currency, type, ...rest }) => rest);
        setBankItems(prev => [...prev, ...cleaned]);
        setShowCsvImport(false);

        const skipped = newItems.length - cleaned.length;
        const adsCount = cleaned.filter(i => i.adsRelated).length;
        let msg = `Importováno ${cleaned.length} výdajových položek.`;
        if (skipped > 0) msg += ` (${skipped} příjmových přeskočeno)`;
        if (adsCount > 0) msg += ` ${adsCount} reklamních označeno.`;
        alert(msg);
      } else {
        alert('Nepodařilo se najít žádné výdajové položky v CSV. Zkontrolujte formát souboru.');
      }
    };

    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  // Cash expenses
  const addCashExpense = () => {
    if (!newCash.description || !newCash.amount) return;
    const expense = {
      id: genId(),
      description: newCash.description,
      amount: Math.abs(parseFloat(newCash.amount)) || 0,
    };
    updateCurrentData({
      cashExpenses: [...(currentData.cashExpenses || []), expense]
    });
    setNewCash({ description: '', amount: '' });
  };

  const removeCashExpense = (expenseId) => {
    updateCurrentData({
      cashExpenses: (currentData.cashExpenses || []).filter(ce => ce.id !== expenseId)
    });
  };

  const selectedLabel = MONTHS.find(m => m.value === selectedMonth)?.label || selectedMonth;

  return (
    <div>
      {/* Month selector + HV Summary */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-600">Období:</label>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white shadow-sm"
          >
            {MONTHS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* HV Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <HVCard
          label="HV1 - Hrubý zisk"
          value={hv1}
          color="blue"
          sub={`Tržby ${formatCZK(revenue)} − Nákup ${formatCZK(cogs)}`}
        />
        <HVCard
          label="HV2 - Po marketingu"
          value={hv2}
          color="purple"
          sub={`HV1 − Marketing ${formatCZK(marketingTotal)}`}
        />
        <HVCard
          label="HV3 - Čistý VH"
          value={hv3}
          color="emerald"
          sub={`HV2 − Provoz ${formatCZK(operatingTotal)}`}
        />
      </div>

      {/* Section 1: Revenue & COGS → HV1 */}
      <Section title="Tržby a náklady na zboží" icon="💰" badge={`HV1: ${formatCZK(hv1)}`}>
        <div className="pt-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-xs text-slate-500 mb-1">
                Tržby bez DPH a poštovného
                {loadingRevenue && <span className="ml-2 text-blue-500">(Načítám...)</span>}
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <input
                    type="number"
                    value={currentData.revenueManual !== null ? currentData.revenueManual : Math.round(autoRevenue)}
                    onChange={e => updateCurrentData({ revenueManual: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    className="w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Kč</span>
                </div>
                {currentData.revenueManual !== null && (
                  <button
                    onClick={() => updateCurrentData({ revenueManual: null })}
                    className="px-3 py-2 text-xs bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors whitespace-nowrap"
                  >
                    Auto ({formatCZK(autoRevenue)})
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {currentData.revenueManual !== null ? 'Manuální hodnota' : 'Automaticky z objednávek v Supabase'}
              </p>
            </div>
            <CurrencyInput
              label="Náklady na prodané zboží (nákupní cena)"
              value={currentData.cogs}
              onChange={val => updateCurrentData({ cogs: val })}
              placeholder="0"
              hint="Hodnotu najdeš v Upgates (tržby mínus marže)"
            />
          </div>
          <div className="flex items-center gap-3 bg-blue-50 rounded-lg p-3">
            <span className="text-blue-500 text-lg">&#8594;</span>
            <div>
              <span className="text-sm text-blue-700 font-medium">HV1 (Hrubý zisk):</span>
              <span className={`ml-2 text-lg font-bold ${hv1 >= 0 ? 'text-blue-800' : 'text-red-600'}`}>
                {formatCZK(hv1)}
              </span>
            </div>
          </div>
        </div>
      </Section>

      {/* Section 2: Marketing → HV2 */}
      <Section title="Marketingové náklady" icon="📢" badge={`HV2: ${formatCZK(hv2)}`}>
        <div className="pt-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <CurrencyInput
              label="Google Ads"
              value={currentData.marketing?.ads}
              onChange={val => updateCurrentData({ marketing: { ...currentData.marketing, ads: val } })}
              hint={selectedMonth === '2026-01' ? 'Leden: 520 000 Kč' : ''}
            />
            <CurrencyInput
              label="Sklik (Seznam)"
              value={currentData.marketing?.sklik}
              onChange={val => updateCurrentData({ marketing: { ...currentData.marketing, sklik: val } })}
              hint="Doplní Michal"
            />
            <CurrencyInput
              label="Facebook / Meta Ads"
              value={currentData.marketing?.facebook}
              onChange={val => updateCurrentData({ marketing: { ...currentData.marketing, facebook: val } })}
              hint="Doplní Michal"
            />
          </div>
          <div className="flex items-center gap-3 bg-purple-50 rounded-lg p-3">
            <span className="text-purple-500 text-lg">&#8594;</span>
            <div>
              <span className="text-sm text-purple-700 font-medium">HV2 (Po marketingu):</span>
              <span className={`ml-2 text-lg font-bold ${hv2 >= 0 ? 'text-purple-800' : 'text-red-600'}`}>
                {formatCZK(hv2)}
              </span>
              <span className="ml-2 text-xs text-purple-500">
                (HV1 {formatCZK(hv1)} − marketing {formatCZK(marketingTotal)})
              </span>
            </div>
          </div>
        </div>
      </Section>

      {/* Section 3: Operating Costs → HV3 */}
      <Section title={`Provozní náklady – ${selectedLabel}`} icon="🏢" badge={`HV3: ${formatCZK(hv3)}`}>
        <div className="pt-4">
          {/* Two column layout: bank items left, categories right */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* LEFT: Available bank items (2 cols) */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-700">Bankovní výpisy</h3>
                <div className="flex gap-1">
                  <button
                    onClick={() => setShowAddBank(!showAddBank)}
                    className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                  >
                    + Přidat
                  </button>
                  <button
                    onClick={() => setShowBulkAdd(!showBulkAdd)}
                    className="px-2 py-1 text-xs bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    Hromadně
                  </button>
                  <button
                    onClick={() => setShowCsvImport(!showCsvImport)}
                    className="px-2 py-1 text-xs bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition-colors"
                  >
                    CSV
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap gap-1 mb-2">
                <button
                  onClick={() => setBankFilter('all')}
                  className={`px-2 py-1 text-xs rounded-lg transition-colors ${bankFilter === 'all' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  Vše
                </button>
                {BANK_SOURCES.map(s => (
                  <button
                    key={s.value}
                    onClick={() => setBankFilter(s.value)}
                    className={`px-2 py-1 text-xs rounded-lg transition-colors ${bankFilter === s.value ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    {s.label}
                  </button>
                ))}
                <label className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hideAds}
                    onChange={e => setHideAds(e.target.checked)}
                    className="rounded"
                  />
                  Skrýt reklamu
                </label>
              </div>

              {/* Auto-classify button */}
              {availableItems.length > 0 && (
                <button
                  onClick={autoAssignAll}
                  className="w-full mb-2 px-3 py-2 text-xs font-medium bg-gradient-to-r from-violet-500 to-blue-500 text-white rounded-lg hover:from-violet-600 hover:to-blue-600 transition-all shadow-sm"
                >
                  🤖 AI: Rozřadit vše automaticky ({availableItems.length} položek)
                </button>
              )}

              {/* Add single item form */}
              {showAddBank && (
                <div className="bg-slate-50 rounded-lg p-3 mb-2 border border-slate-200">
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input
                      type="date"
                      value={newItem.date}
                      onChange={e => setNewItem(prev => ({ ...prev, date: e.target.value }))}
                      className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="Datum"
                    />
                    <select
                      value={newItem.source}
                      onChange={e => setNewItem(prev => ({ ...prev, source: e.target.value }))}
                      className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      {BANK_SOURCES.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    value={newItem.description}
                    onChange={e => setNewItem(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="Popis (dodavatel, účel...)"
                  />
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={newItem.amount}
                      onChange={e => setNewItem(prev => ({ ...prev, amount: e.target.value }))}
                      className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="Částka (Kč)"
                    />
                    <button
                      onClick={addBankItem}
                      className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded-lg hover:bg-blue-600 transition-colors"
                    >
                      Přidat
                    </button>
                  </div>
                </div>
              )}

              {/* Bulk add form */}
              {showBulkAdd && (
                <div className="bg-slate-50 rounded-lg p-3 mb-2 border border-slate-200">
                  <p className="text-xs text-slate-500 mb-2">
                    Vložte řádky z výpisu. Formát: <code>popis ; částka</code> nebo <code>datum ; popis ; částka</code>
                  </p>
                  <textarea
                    value={bulkText}
                    onChange={e => setBulkText(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 min-h-[100px]"
                    placeholder={"PPL CZ s.r.o. ; 45 200\nDPD CZ ; 38 100\n15.01.2025 ; Zásilkovna ; 22 500"}
                  />
                  <div className="flex justify-between items-center mt-2">
                    <select
                      value={bankFilter !== 'all' ? bankFilter : '2026-01'}
                      onChange={e => setBankFilter(e.target.value)}
                      className="px-2 py-1 border border-slate-200 rounded-lg text-xs"
                    >
                      {BANK_SOURCES.map(s => (
                        <option key={s.value} value={s.value}>Zdroj: {s.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={addBulkItems}
                      className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded-lg hover:bg-blue-600 transition-colors"
                    >
                      Importovat
                    </button>
                  </div>
                </div>
              )}

              {/* CSV import */}
              {showCsvImport && (
                <div className="bg-emerald-50 rounded-lg p-3 mb-2 border border-emerald-200">
                  <p className="text-xs text-slate-600 mb-2">
                    Nahrajte CSV z Fio banky nebo jiné banky. Automaticky rozpoznám sloupce a importuji výdaje.
                  </p>
                  <div className="flex items-center gap-2 mb-2">
                    <select
                      value={csvSource}
                      onChange={e => setCsvSource(e.target.value)}
                      className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs"
                    >
                      {BANK_SOURCES.map(s => (
                        <option key={s.value} value={s.value}>Výpis: {s.label}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center justify-center gap-2 px-4 py-3 bg-white border-2 border-dashed border-emerald-300 rounded-xl cursor-pointer hover:border-emerald-500 hover:bg-emerald-50 transition-all">
                    <span className="text-emerald-600 text-sm font-medium">Vyberte CSV soubor</span>
                    <input
                      type="file"
                      accept=".csv,.txt,.tsv"
                      onChange={handleCsvImport}
                      className="hidden"
                    />
                  </label>
                  <p className="text-[10px] text-slate-400 mt-2">
                    Fio banka, ČSOB, KB, Raiffeisen... Importují se pouze výdaje (záporné částky). Reklamní platby automaticky označeny a skryty.
                  </p>
                </div>
              )}

              {/* Bank items list - grouped by vendor */}
              <div className="space-y-1 max-h-[500px] overflow-y-auto pr-1">
                {availableVendorGroups.length === 0 && (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    {bankItems.length === 0
                      ? 'Zatím žádné položky. Přidejte platby z bankovních výpisů.'
                      : 'Všechny položky jsou přiřazeny nebo skryty.'}
                  </div>
                )}
                {availableVendorGroups.map(group => {
                  const hasMultiple = group.items.length > 1;
                  const isExpanded = expandedAvailableVendors.has(group.vendor);

                  return (
                    <div key={group.vendor}>
                      <div
                        draggable
                        onDragStart={e => handleBankGroupDragStart(e, group.items)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing transition-all hover:shadow-sm bg-white border-slate-200 hover:border-blue-300 ${hasMultiple ? 'cursor-pointer' : ''}`}
                        onClick={hasMultiple ? () => toggleAvailableVendor(group.vendor) : undefined}
                      >
                        {hasMultiple && (
                          <span className={`text-[10px] text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                        )}
                        <span className="text-slate-300 text-xs">&#9776;</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-slate-700 truncate">{group.vendor}</div>
                          <div className="text-[10px] text-slate-400">
                            {hasMultiple ? `${group.items.length} položek` : (
                              <>
                                {group.items[0].date && `${group.items[0].date} • `}
                                {BANK_SOURCES.find(s => s.value === group.items[0].source)?.label || group.items[0].source}
                              </>
                            )}
                          </div>
                        </div>
                        <span className="text-xs font-bold text-slate-700 whitespace-nowrap">{formatCZK(group.total)}</span>
                        {!hasMultiple && (
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteBankItem(group.items[0].id); }}
                            className="text-slate-300 hover:text-red-500 text-xs transition-colors"
                            title="Smazat"
                          >
                            &#10005;
                          </button>
                        )}
                      </div>

                      {/* Expanded individual items */}
                      {isExpanded && hasMultiple && (
                        <div className="ml-6 mt-1 space-y-0.5 mb-1">
                          {group.items.map(item => (
                            <div
                              key={item.id}
                              draggable
                              onDragStart={e => handleBankDragStart(e, item)}
                              className="flex items-center gap-2 px-2 py-1 rounded bg-slate-50 border border-slate-100 text-[11px] cursor-grab active:cursor-grabbing"
                            >
                              <span className="text-slate-300">&#9776;</span>
                              <div className="flex-1 min-w-0 truncate text-slate-600">
                                {item.description}
                              </div>
                              <span className="font-medium text-slate-600 whitespace-nowrap">{formatCZK(item.amount)}</span>
                              <button
                                onClick={() => deleteBankItem(item.id)}
                                className="text-slate-300 hover:text-red-500 transition-colors"
                              >&#10005;</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {bankItems.length > 0 && (
                <div className="mt-2 text-xs text-slate-400 text-right">
                  {availableItems.length} dostupných z {bankItems.length} celkem
                </div>
              )}
            </div>

            {/* RIGHT: Category columns (3 cols) */}
            <div className="lg:col-span-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-700">
                  Náklady přiřazené k {selectedLabel}
                </h3>
                <span className="text-xs text-slate-500">
                  Celkem: <strong className="text-slate-700">{formatCZK(assignedCostsTotal)}</strong>
                </span>
              </div>

              {/* Category columns grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-3">
                {EXPENSE_CATEGORIES.map(cat => (
                  <CategoryColumn
                    key={cat.id}
                    category={cat}
                    items={categoryItems[cat.id] || []}
                    onDrop={handleCategoryDrop}
                    onRemove={handleRemoveFromCategory}
                    onMoveToCategory={handleMoveToCategory}
                    allCategories={EXPENSE_CATEGORIES}
                    expandedVendors={expandedVendors}
                    toggleVendor={toggleVendor}
                  />
                ))}
              </div>

              {/* Cash expenses */}
              <div className="mt-4">
                <h4 className="text-xs font-semibold text-slate-600 mb-2">Hotovostní výdaje / Ostatní</h4>
                <div className="space-y-1 mb-2">
                  {(currentData.cashExpenses || []).map(ce => (
                    <div key={ce.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200">
                      <span className="text-amber-500 text-xs">&#9679;</span>
                      <span className="flex-1 text-xs text-slate-700">{ce.description}</span>
                      <span className="text-xs font-bold text-slate-700 whitespace-nowrap">{formatCZK(ce.amount)}</span>
                      <button
                        onClick={() => removeCashExpense(ce.id)}
                        className="text-slate-300 hover:text-red-500 text-xs transition-colors"
                      >
                        &#10005;
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCash.description}
                    onChange={e => setNewCash(prev => ({ ...prev, description: e.target.value }))}
                    className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="Popis (za co)"
                    onKeyDown={e => e.key === 'Enter' && addCashExpense()}
                  />
                  <input
                    type="number"
                    value={newCash.amount}
                    onChange={e => setNewCash(prev => ({ ...prev, amount: e.target.value }))}
                    className="w-28 px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="Kč"
                    onKeyDown={e => e.key === 'Enter' && addCashExpense()}
                  />
                  <button
                    onClick={addCashExpense}
                    className="px-3 py-1.5 bg-amber-500 text-white text-xs rounded-lg hover:bg-amber-600 transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Operating total */}
              <div className="mt-4 flex items-center gap-3 bg-emerald-50 rounded-lg p-3 border border-emerald-200">
                <span className="text-emerald-500 text-lg">&#8594;</span>
                <div>
                  <span className="text-sm text-emerald-700 font-medium">HV3 (Čistý VH):</span>
                  <span className={`ml-2 text-lg font-bold ${hv3 >= 0 ? 'text-emerald-800' : 'text-red-600'}`}>
                    {formatCZK(hv3)}
                  </span>
                  <div className="text-xs text-emerald-600 mt-0.5">
                    HV2 {formatCZK(hv2)} − výpisy {formatCZK(assignedCostsTotal)} − hotovost {formatCZK(cashTotal)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Detailed breakdown */}
      <Section title="Detailní přehled" icon="📋" defaultOpen={false}>
        <div className="pt-4">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="py-2 text-slate-600">Tržby bez DPH a poštovného</td>
                <td className="py-2 text-right font-medium">{formatCZK(revenue)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-2 text-slate-600">− Náklady na prodané zboží</td>
                <td className="py-2 text-right font-medium text-red-600">− {formatCZK(cogs)}</td>
              </tr>
              <tr className="border-b-2 border-blue-200 bg-blue-50">
                <td className="py-2 px-2 font-semibold text-blue-800">= HV1 (Hrubý zisk)</td>
                <td className={`py-2 px-2 text-right font-bold ${hv1 >= 0 ? 'text-blue-800' : 'text-red-600'}`}>{formatCZK(hv1)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-2 text-slate-600 pl-4">− Google Ads</td>
                <td className="py-2 text-right text-red-600">− {formatCZK(currentData.marketing?.ads || 0)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-2 text-slate-600 pl-4">− Sklik</td>
                <td className="py-2 text-right text-red-600">− {formatCZK(currentData.marketing?.sklik || 0)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-2 text-slate-600 pl-4">− Facebook / Meta</td>
                <td className="py-2 text-right text-red-600">− {formatCZK(currentData.marketing?.facebook || 0)}</td>
              </tr>
              <tr className="border-b-2 border-purple-200 bg-purple-50">
                <td className="py-2 px-2 font-semibold text-purple-800">= HV2 (Po marketingu)</td>
                <td className={`py-2 px-2 text-right font-bold ${hv2 >= 0 ? 'text-purple-800' : 'text-red-600'}`}>{formatCZK(hv2)}</td>
              </tr>
              {/* Show by category */}
              {EXPENSE_CATEGORIES.filter(cat => (categoryItems[cat.id] || []).length > 0).map(cat => {
                const items = categoryItems[cat.id] || [];
                const catTotal = items.reduce((s, i) => s + i.amount, 0);
                return (
                  <React.Fragment key={cat.id}>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td className="py-1.5 text-slate-500 pl-4 text-xs font-semibold uppercase">{cat.icon} {cat.label}</td>
                      <td className="py-1.5 text-right text-red-600 text-xs font-semibold">− {formatCZK(catTotal)}</td>
                    </tr>
                    {items.map(item => (
                      <tr key={item.id} className="border-b border-slate-100">
                        <td className="py-2 text-slate-600 pl-8 text-xs">− {item.description}</td>
                        <td className="py-2 text-right text-red-600 text-xs">− {formatCZK(item.amount)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {(currentData.cashExpenses || []).map(ce => (
                <tr key={ce.id} className="border-b border-slate-100">
                  <td className="py-2 text-slate-600 pl-4">− {ce.description} (hotovost)</td>
                  <td className="py-2 text-right text-red-600">− {formatCZK(ce.amount)}</td>
                </tr>
              ))}
              <tr className="bg-emerald-50">
                <td className="py-3 px-2 font-bold text-emerald-800 text-base">= HV3 (Čistý VH)</td>
                <td className={`py-3 px-2 text-right font-bold text-base ${hv3 >= 0 ? 'text-emerald-800' : 'text-red-600'}`}>{formatCZK(hv3)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
