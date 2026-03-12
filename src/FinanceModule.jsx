import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

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
  { id: 'cina', label: 'Čína náklady', icon: '🇨🇳', color: 'red' },
  { id: 'saas', label: 'SaaS', icon: '☁️', color: 'cyan' },
  { id: 'pravidelne', label: 'Ostatní pravidelné náklady', icon: '🔄', color: 'orange' },
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
  // Čína náklady
  { pattern: /alibaba|aliexpress|1688|taobao|shenzhen|guangzhou|yiwu|china|čína|cina|cn express|cargus|cargo china|foxconnect|asian|huaqiang/i, category: 'cina' },
  // SaaS
  { pattern: /saas|shoptet|shopify|mailchimp|sendinblue|brevo|openai|chatgpt|notion|slack|zoom|jira|atlassian|github|gitlab|aws|azure|digitalocean|heroku|vercel|netlify|stripe|twilio|hubspot|salesforce|zendesk|intercom|crisp|freshdesk|zapier|make\.com|integromat|airtable|monday|asana|trello|figma|canva|adobe|dropbox|icloud|microsoft 365|office 365|google workspace|cloudflare|sentry|datadog|mixpanel|amplitude|hotjar|semrush|ahrefs/i, category: 'saas' },
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

// ─── Category Section Component (full-width, collapsible) ────────────────
const CategorySection = ({ category, items, onDrop, onRemove, onMoveToCategory, allCategories }) => {
  const [open, setOpen] = useState(true);
  const [dropActive, setDropActive] = useState(false);

  const colorMap = {
    blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', dropBg: 'bg-blue-100', header: 'bg-blue-500', light: 'bg-blue-50/50' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dropBg: 'bg-amber-100', header: 'bg-amber-500', light: 'bg-amber-50/50' },
    purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', dropBg: 'bg-purple-100', header: 'bg-purple-500', light: 'bg-purple-50/50' },
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dropBg: 'bg-emerald-100', header: 'bg-emerald-500', light: 'bg-emerald-50/50' },
    red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dropBg: 'bg-red-100', header: 'bg-red-500', light: 'bg-red-50/50' },
    cyan: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', dropBg: 'bg-cyan-100', header: 'bg-cyan-500', light: 'bg-cyan-50/50' },
    orange: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dropBg: 'bg-orange-100', header: 'bg-orange-500', light: 'bg-orange-50/50' },
    slate: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', dropBg: 'bg-slate-100', header: 'bg-slate-500', light: 'bg-slate-50/50' },
  };
  const colors = colorMap[category.color] || colorMap.slate;
  const total = items.reduce((sum, i) => sum + i.amount, 0);

  const handleDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropActive(true); }, []);
  const handleDragLeave = useCallback(() => setDropActive(false), []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDropActive(false);
    const data = e.dataTransfer.getData('text/plain');
    if (data) {
      try { const p = JSON.parse(data); onDrop(p.itemId || p.groupItemIds, p.fromCategory, category.id); }
      catch { onDrop(data, null, category.id); }
    }
  }, [onDrop, category.id]);

  return (
    <div
      className={`rounded-lg border ${colors.border} overflow-hidden transition-all ${dropActive ? colors.dropBg : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header bar - always visible */}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-2 ${colors.bg} hover:brightness-95 transition-all`}
      >
        <div className="flex items-center gap-2">
          <span>{category.icon}</span>
          <span className="text-sm font-semibold text-slate-800">{category.label}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${colors.border} ${colors.text} font-medium`}>
            {items.length} položek
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold ${colors.text}`}>{formatCZK(total)}</span>
          <span className={`text-slate-400 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>&#9660;</span>
        </div>
      </button>

      {/* Items list */}
      {open && items.length > 0 && (
        <div className="px-3 py-2 space-y-1">
          {items.map(item => (
            <div
              key={item.id}
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.id, fromCategory: category.id }));
                e.dataTransfer.effectAllowed = 'move';
              }}
              className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-white border border-slate-100 hover:border-slate-300 cursor-grab active:cursor-grabbing transition-all group"
            >
              <span className="text-slate-300 group-hover:text-slate-500 text-xs">&#9776;</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm text-slate-700">{item.description}</span>
                {item.date && <span className="text-xs text-slate-400 ml-2">{item.date}</span>}
              </div>
              <span className={`text-sm font-semibold ${colors.text} whitespace-nowrap`}>{formatCZK(item.amount)}</span>
              <select
                className="text-xs bg-transparent border border-slate-200 rounded px-1 py-0.5 text-slate-400 cursor-pointer hover:text-slate-600"
                value=""
                onClick={e => e.stopPropagation()}
                onChange={e => { if (e.target.value) onMoveToCategory(item.id, category.id, e.target.value); }}
              >
                <option value="">Přesunout...</option>
                {allCategories.filter(c => c.id !== category.id).map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
                ))}
                <option value="__remove__">&#10005; Odebrat</option>
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Empty drop hint */}
      {open && items.length === 0 && (
        <div className={`px-4 py-3 text-xs text-center ${colors.text} opacity-50`}>
          {dropActive ? 'Pustit pro přiřazení' : 'Přetáhněte položky sem'}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Main FinanceModule
// ═══════════════════════════════════════════════════════════════════════════

export default function FinanceModule({ supabaseUrl, supabaseKey, userEmail, supabaseInstance }) {
  // Use shared Supabase instance from App (has authenticated session) or create own
  const supabaseClient = useMemo(() => {
    if (supabaseInstance) return supabaseInstance;
    if (supabaseUrl && supabaseKey) return createClient(supabaseUrl, supabaseKey);
    return null;
  }, [supabaseInstance, supabaseUrl, supabaseKey]);
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
  const [supabaseLoaded, setSupabaseLoaded] = useState(false);
  const [savingToCloud, setSavingToCloud] = useState(false);

  // New bank item form
  const [newItem, setNewItem] = useState({ date: '', description: '', amount: '', source: '2026-01' });
  const [bulkText, setBulkText] = useState('');

  // New cash expense form
  const [newCash, setNewCash] = useState({ description: '', amount: '' });

  // ─── Load from Supabase on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!supabaseClient || !userEmail) return;
    (async () => {
      try {
        const { data, error } = await supabaseClient
          .from('finance_state')
          .select('state')
          .eq('user_email', 'shared')
          .single();
        if (error && error.code !== 'PGRST116') {
          console.error('Finance: failed to load from Supabase', error);
          setSupabaseLoaded(true);
          return;
        }
        if (data?.state) {
          const s = data.state;
          console.log('Finance: loaded shared state from Supabase');
          if (s.selectedMonth) setSelectedMonth(s.selectedMonth);
          if (s.monthsData) setMonthsData(s.monthsData);
          if (s.bankItems) setBankItems(s.bankItems);
          if (s.assignedItems) setAssignedItems(s.assignedItems);
          if (s.itemCategories) setItemCategories(s.itemCategories);
          saveFinanceState(s);
        } else {
          // Migration: copy data from michal.baturko to shared
          const { data: legacy } = await supabaseClient
            .from('finance_state')
            .select('state')
            .eq('user_email', 'michal.baturko@regalmaster.cz')
            .single();
          if (legacy?.state) {
            const s = legacy.state;
            console.log('Finance: migrating data to shared');
            if (s.selectedMonth) setSelectedMonth(s.selectedMonth);
            if (s.monthsData) setMonthsData(s.monthsData);
            if (s.bankItems) setBankItems(s.bankItems);
            if (s.assignedItems) setAssignedItems(s.assignedItems);
            if (s.itemCategories) setItemCategories(s.itemCategories);
            saveFinanceState(s);
            // Save as shared so migration happens only once
            await supabaseClient
              .from('finance_state')
              .upsert({ user_email: 'shared', state: s, updated_at: new Date().toISOString() }, { onConflict: 'user_email' });
          }
        }
      } catch (e) {
        console.error('Finance: Supabase load error', e);
      }
      setSupabaseLoaded(true);
    })();
  }, [supabaseClient, userEmail]);

  // ─── Save to localStorage + Supabase on changes ──────────────────────────
  const saveTimeoutRef = React.useRef(null);
  useEffect(() => {
    const state = { selectedMonth, monthsData, bankItems, assignedItems, itemCategories };
    // Always save to localStorage immediately
    saveFinanceState(state);

    // Debounced save to Supabase (1.5s after last change)
    if (!supabaseClient || !userEmail) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        setSavingToCloud(true);
        const { error } = await supabaseClient
          .from('finance_state')
          .upsert({
            user_email: 'shared',
            state,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_email' });
        if (error) console.error('Finance: Supabase save error', error);
        else console.log('Finance: saved to Supabase');
      } catch (e) {
        console.error('Finance: Supabase save error', e);
      }
      setSavingToCloud(false);
    }, 1500);

    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [selectedMonth, monthsData, bankItems, assignedItems, itemCategories, supabaseClient, userEmail]);

  // Get/set current month data
  const currentData = monthsData[selectedMonth] || getDefaultMonthData(selectedMonth);
  const updateCurrentData = useCallback((updates) => {
    setMonthsData(prev => ({
      ...prev,
      [selectedMonth]: { ...(prev[selectedMonth] || getDefaultMonthData(selectedMonth)), ...updates }
    }));
  }, [selectedMonth]);

  // Fetch revenue directly via Supabase JS client
  useEffect(() => {
    if (!supabaseClient) return;
    setLoadingRevenue(true);
    setAutoRevenue(0);

    const [year, month] = selectedMonth.split('-');
    const dateFrom = `${year}-${month}-01T00:00:00`;
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const dateTo = `${year}-${month}-${String(lastDay).padStart(2, '0')}T23:59:59`;

    async function fetchAllOrders() {
      let allOrders = [];
      let from = 0;
      const pageSize = 1000;

      while (true) {
        const { data, error } = await supabaseClient
          .from('orders')
          .select('*')
          .gte('order_date', dateFrom)
          .lte('order_date', dateTo)
          .order('order_date', { ascending: false })
          .range(from, from + pageSize - 1);

        if (error) throw new Error(error.message);
        if (!data || data.length === 0) break;
        allOrders = allOrders.concat(data);
        from += pageSize;
        if (data.length < pageSize) break;
      }

      // Deduplicate & filter cancelled (same logic as main App)
      const seen = new Set();
      return allOrders.filter(o => {
        const key = o.raw_data?.order_number || o.id;
        if (seen.has(key)) return false;
        seen.add(key);
        const s1 = (o.status || '').toUpperCase();
        const s2 = (o.raw_data?.status || '').toUpperCase();
        return s1 !== 'STORNO' && s2 !== 'STORNO';
      });
    }

    fetchAllOrders()
      .then(orders => {
        let total = 0;
        orders.forEach(o => { total += getRevenueWithoutVAT(o); });
        console.log(`Finance: ${selectedMonth} → ${orders.length} orders, revenue = ${Math.round(total)} Kč`);
        setAutoRevenue(total);
        setLoadingRevenue(false);
      })
      .catch(err => {
        console.error(`Finance revenue fetch FAILED for ${selectedMonth}:`, err);
        setLoadingRevenue(false);
      });
  }, [selectedMonth, supabaseClient]);

  // Computed values
  const revenue = currentData.revenueManual !== null ? currentData.revenueManual : autoRevenue;
  const cogs = currentData.cogs || 0;
  const marketingTotal = (currentData.marketing?.ads || 0) + (currentData.marketing?.sklik || 0) + (currentData.marketing?.facebook || 0);

  const monthAssigned = assignedItems[selectedMonth] || [];
  const assignedBankItems = bankItems.filter(bi => monthAssigned.includes(bi.id));
  const assignedCostsTotal = assignedBankItems.reduce((sum, bi) => sum + bi.amount, 0);
  const cashTotal = (currentData.cashExpenses || []).reduce((sum, ce) => sum + ce.amount, 0);
  const operatingTotal = assignedCostsTotal + cashTotal;

  // Smart Bidding from assigned bank items for this month
  const smartBiddingTotal = assignedBankItems
    .filter(bi => /smartbidding/i.test(bi.description))
    .reduce((sum, bi) => sum + bi.amount, 0);

  // PNO = (Google + Sklik + Facebook + Smart Bidding) / obrat * 100
  const pnoTotal = marketingTotal + smartBiddingTotal;
  const pnoPct = revenue > 0 ? (pnoTotal / revenue) * 100 : 0;

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
  const [selectedBankItems, setSelectedBankItems] = useState(new Set());

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

  // ─── Multiselect handlers ──────────────────────────────────────────────
  const toggleSelectBankItem = useCallback((itemId) => {
    setSelectedBankItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const toggleSelectAllAvailable = useCallback(() => {
    const allIds = availableItems.map(i => i.id);
    setSelectedBankItems(prev => {
      const allSelected = allIds.every(id => prev.has(id));
      if (allSelected) return new Set();
      return new Set(allIds);
    });
  }, [availableItems]);

  const bulkAssignSelected = useCallback((targetCategory) => {
    if (selectedBankItems.size === 0) return;
    const ids = [...selectedBankItems];
    setAssignedItems(prev => ({
      ...prev,
      [selectedMonth]: [...(prev[selectedMonth] || []), ...ids.filter(id => !monthAssigned.includes(id))]
    }));
    setItemCategories(prev => {
      const next = { ...prev };
      ids.forEach(id => { next[id] = targetCategory; });
      return next;
    });
    setSelectedBankItems(new Set());
  }, [selectedBankItems, selectedMonth, monthAssigned]);

  const bulkAutoAssignSelected = useCallback(() => {
    if (selectedBankItems.size === 0) return;
    const ids = [...selectedBankItems];
    const newAssignments = {};
    const toAssign = [];
    ids.forEach(id => {
      const item = bankItems.find(bi => bi.id === id);
      if (item) {
        newAssignments[id] = classifyExpense(item.description);
        toAssign.push(id);
      }
    });
    setAssignedItems(prev => ({
      ...prev,
      [selectedMonth]: [...(prev[selectedMonth] || []), ...toAssign.filter(id => !monthAssigned.includes(id))]
    }));
    setItemCategories(prev => ({ ...prev, ...newAssignments }));
    setSelectedBankItems(new Set());
  }, [selectedBankItems, selectedMonth, monthAssigned, bankItems]);

  // ─── Restore January 2026 data from known state ──────────────────────────
  const restoreJanuary = useCallback(() => {
    // 1) Set monthsData for January
    setMonthsData(prev => ({
      ...prev,
      '2026-01': {
        revenueManual: 2709000,
        cogs: 1083600,
        marketing: { ads: 520000, sklik: 70000, facebook: 0 },
        cashExpenses: [
          { id: genId(), description: 'Právní služby', amount: 20000 },
          { id: genId(), description: 'Media call', amount: 70000 },
          { id: genId(), description: 'Ruslan', amount: 45000 },
          { id: genId(), description: 'Petr Jiříček', amount: 80000 },
          { id: genId(), description: 'Kristýna', amount: 25000 },
          { id: genId(), description: 'Honza', amount: 30000 },
          { id: genId(), description: 'Ondra', amount: 9250 },
          { id: genId(), description: 'Obchod provize', amount: 2772 },
        ],
      }
    }));

    // 2) Match existing bank items and assign to January with correct categories
    const JANUARY_ITEMS = [
      // Mzdy
      { match: 'VOJTECH MIKULENKA', amount: 24850, cat: 'mzdy' },
      { match: 'FU', amount: 8285, cat: 'mzdy', exact: true },
      { match: 'OSSZ', amount: 28547, cat: 'mzdy' },
      { match: 'Vseobecna zdravotni pojistovna', amount: 6681, cat: 'mzdy' },
      { match: 'Vojenska zdravotni pojistovna', amount: 5400, cat: 'mzdy' },
      { match: 'MZ202601', amount: 38888, cat: 'mzdy' },
      { match: 'MZ202601', amount: 31930, cat: 'mzdy' },
      // Jednorázové náklady
      { match: 'Alza.cz', amount: 905, cat: 'jednorazove' },
      { match: 'Alza.cz', amount: 26914, cat: 'jednorazove' },
      { match: 'Alza.cz', amount: 1887, cat: 'jednorazove' },
      { match: 'Alza.cz', amount: 623, cat: 'jednorazove' },
      { match: 'IKEA CZ', amount: 14379, cat: 'jednorazove' },
      { match: 'IKEA BRNO', amount: 5149, cat: 'jednorazove' },
      { match: 'ROHLIK', amount: 1544, cat: 'jednorazove' },
      { match: 'Adalbertinum', amount: 1590, cat: 'jednorazove' },
      { match: 'BUFFALO STEAKHOUSE', amount: 600, cat: 'jednorazove' },
      { match: 'BUFFALO STEAKHOUSE', amount: 550, cat: 'jednorazove' },
      { match: 'PPL CZ', amount: 5925, cat: 'jednorazove' },
      { match: 'ALBERT', amount: 2225, cat: 'jednorazove' },
      { match: 'Pavillon Steak', amount: 850, cat: 'jednorazove' },
      // Nájmy
      { match: 'Euro Mall Brno', amount: 31341, cat: 'najmy' },
      { match: 'Euro Mall Brno', amount: 12100, cat: 'najmy' },
      { match: 'Euro Mall Brno', amount: 108900, cat: 'najmy' },
      // Čína náklady
      { match: 'Vizove centrum', amount: 2266, cat: 'cina' },
      { match: 'AIR CHINA', amount: 7614, cat: 'cina' },
      { match: 'Flughafen Wien', amount: 500, cat: 'cina' },
      { match: 'Air China', amount: 6998, cat: 'cina' },
      { match: 'TRIP.COM', amount: 1925, cat: 'cina' },
      { match: 'Qingdaoruisheng', amount: 2854, cat: 'cina' },
      { match: 'Beijing Yupinsi', amount: 635, cat: 'cina' },
      { match: 'BEIJINGTIANLUN', amount: 11713, cat: 'cina' },
      // SaaS
      { match: 'HOLAFLY', amount: 797, cat: 'saas' },
      { match: 'CLAUDE.AI', amount: 450, cat: 'saas' },
      { match: 'BASE44', amount: 18934, cat: 'saas' },
      { match: 'LOVABLE', amount: 500, cat: 'saas' },
      { match: 'CLAUDE.AI', amount: 1900, cat: 'saas' },
      { match: 'ANTHROPIC', amount: 129, cat: 'saas' },
      { match: 'upgates.com TZEY', amount: 4901, cat: 'saas' },
      { match: 'CLAUDE.AI', amount: 3094, cat: 'saas' },
      { match: 'CLOUDFLARE', amount: 103, cat: 'saas' },
      { match: 'HEYGEN', amount: 619, cat: 'saas' },
      { match: 'ELEVENLABS', amount: 232, cat: 'saas' },
      { match: 'upgates.com, Petra', amount: 3267, cat: 'saas' },
      { match: 'SMARTLOOK', amount: 3024, cat: 'saas' },
      // Ostatní pravidelné náklady
      { match: '2011010000', amount: 799, cat: 'pravidelne' },
      { match: '2011010000', amount: 349, cat: 'pravidelne' },
      { match: 'FLoPack', amount: 3267, cat: 'pravidelne' },
      { match: 'Technology Morava', amount: 1786, cat: 'pravidelne' },
      { match: 'SMARTBIDDING', amount: 36300, cat: 'pravidelne' },
      { match: 'Daktela', amount: 22131, cat: 'pravidelne' },
      { match: 'Tomas Blaha', amount: 7986, cat: 'pravidelne' },
      { match: 'Vodafone', amount: 3462, cat: 'pravidelne' },
      { match: 'amccomp', amount: 5203, cat: 'pravidelne' },
      { match: '123-2355600207', amount: 8071, cat: 'pravidelne' },
      { match: 'MoravanyNET', amount: 2977, cat: 'pravidelne' },
      { match: 'APPLE.COM', amount: 2799, cat: 'pravidelne' },
      // Ostatní
      { match: '70033-77628621', amount: 2403, cat: 'ostatni' },
      { match: 'Action B029', amount: 553, cat: 'ostatni' },
      { match: 'Property Point', amount: 18444, cat: 'ostatni' },
      { match: '2401722011', amount: 3025, cat: 'ostatni' },
      { match: 'E - ECONOMY', amount: 5324, cat: 'ostatni' },
      { match: 'LUEKO', amount: 6050, cat: 'ostatni' },
      { match: 'LUEKO', amount: 10890, cat: 'ostatni' },
      { match: '26033963', amount: 24754, cat: 'ostatni' },
      { match: '26033964', amount: 799, cat: 'ostatni' },
    ];

    const usedIds = new Set();
    const newAssignments = {};
    const toAssign = [];

    JANUARY_ITEMS.forEach(spec => {
      // Find matching bank item (not yet used)
      const found = bankItems.find(bi => {
        if (usedIds.has(bi.id)) return false;
        const amountMatch = Math.abs(bi.amount - spec.amount) < 5;
        if (spec.exact) {
          return bi.description === spec.match && amountMatch;
        }
        return bi.description.toLowerCase().includes(spec.match.toLowerCase()) && amountMatch;
      });
      if (found) {
        usedIds.add(found.id);
        newAssignments[found.id] = spec.cat;
        toAssign.push(found.id);
      } else {
        console.warn(`Finance restore: could not match "${spec.match}" (${spec.amount} Kč)`);
      }
    });

    setAssignedItems(prev => ({
      ...prev,
      '2026-01': [...new Set([...(prev['2026-01'] || []), ...toAssign])]
    }));
    setItemCategories(prev => ({ ...prev, ...newAssignments }));

    console.log(`Finance restore: matched ${toAssign.length}/${JANUARY_ITEMS.length} items for January`);
    alert(`Leden obnoven! Přiřazeno ${toAssign.length} z ${JANUARY_ITEMS.length} položek.`);
  }, [bankItems]);

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
          {savingToCloud && <span className="text-xs text-blue-400 animate-pulse">☁️ Ukládám...</span>}
          {supabaseLoaded && !savingToCloud && <span className="text-xs text-green-500">☁️ Uloženo</span>}
          {selectedMonth === '2026-01' && (monthAssigned.length === 0 || !currentData.revenueManual) && bankItems.length > 0 && (
            <button
              onClick={restoreJanuary}
              className="px-3 py-1.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors border border-amber-200"
            >
              🔄 Obnovit leden z předchozího stavu
            </button>
          )}
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
            <div className="flex-1">
              <label className="block text-xs text-slate-500 mb-1">Náklady na prodané zboží (nákupní cena)</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    value={currentData.cogs || ''}
                    onChange={e => updateCurrentData({ cogs: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                    placeholder="0"
                    className="w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Kč</span>
                </div>
                <span className="text-slate-400 text-xs">=</span>
                <div className="relative w-24">
                  <input
                    type="number"
                    value={revenue > 0 ? Math.round((currentData.cogs || 0) / revenue * 100) : ''}
                    onChange={e => {
                      const pct = parseFloat(e.target.value);
                      if (!isNaN(pct) && revenue > 0) {
                        updateCurrentData({ cogs: Math.round(revenue * pct / 100) });
                      }
                    }}
                    placeholder="0"
                    className="w-full px-3 py-2 pr-8 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-1">Zadej Kč nebo % z tržeb. Hodnotu najdeš v Upgates (tržby mínus marže)</p>
            </div>
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
          {/* PNO */}
          <div className="flex items-center gap-3 bg-indigo-50 rounded-lg p-3">
            <span className="text-indigo-500 text-lg font-bold">%</span>
            <div>
              <span className="text-sm text-indigo-700 font-medium">PNO:</span>
              <span className={`ml-2 text-lg font-bold ${pnoPct <= 20 ? 'text-green-700' : pnoPct <= 30 ? 'text-amber-600' : 'text-red-600'}`}>
                {pnoPct.toFixed(1)} %
              </span>
              <span className="ml-2 text-xs text-indigo-400">
                ({formatCZK(pnoTotal)} / {formatCZK(revenue)}
                {smartBiddingTotal > 0 ? ` · vč. Smart Bidding ${formatCZK(smartBiddingTotal)}` : ''})
              </span>
            </div>
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
          {/* Stacked layout: bank items on top, categories below */}
          <div className="space-y-6">
            {/* TOP: Available bank items */}
            <div>
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

              {/* Multiselect toolbar */}
              {availableItems.length > 0 && (
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={availableItems.length > 0 && availableItems.every(i => selectedBankItems.has(i.id))}
                      onChange={toggleSelectAllAvailable}
                      className="rounded"
                    />
                    Vybrat vše
                  </label>
                  {selectedBankItems.size > 0 && (
                    <>
                      <span className="text-xs text-slate-400">|</span>
                      <span className="text-xs font-medium text-blue-600">{selectedBankItems.size} vybráno</span>
                      <button
                        onClick={bulkAutoAssignSelected}
                        className="px-2 py-1 text-[11px] font-medium bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200 transition-colors"
                      >
                        🤖 Auto
                      </button>
                      <select
                        value=""
                        onChange={e => { if (e.target.value) bulkAssignSelected(e.target.value); }}
                        className="px-2 py-1 text-[11px] border border-slate-200 rounded-lg bg-white text-slate-600 cursor-pointer"
                      >
                        <option value="">Přesunout do...</option>
                        {EXPENSE_CATEGORIES.map(c => (
                          <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => setSelectedBankItems(new Set())}
                        className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        Zrušit výběr
                      </button>
                    </>
                  )}
                </div>
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
                  const groupAllSelected = group.items.every(i => selectedBankItems.has(i.id));
                  const groupSomeSelected = group.items.some(i => selectedBankItems.has(i.id));

                  return (
                    <div key={group.vendor}>
                      <div
                        draggable
                        onDragStart={e => handleBankGroupDragStart(e, group.items)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing transition-all hover:shadow-sm ${groupSomeSelected ? 'bg-blue-50 border-blue-300' : 'bg-white border-slate-200 hover:border-blue-300'} ${hasMultiple ? 'cursor-pointer' : ''}`}
                        onClick={hasMultiple ? () => toggleAvailableVendor(group.vendor) : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={groupAllSelected}
                          ref={el => { if (el) el.indeterminate = groupSomeSelected && !groupAllSelected; }}
                          onChange={(e) => {
                            e.stopPropagation();
                            setSelectedBankItems(prev => {
                              const next = new Set(prev);
                              if (groupAllSelected) {
                                group.items.forEach(i => next.delete(i.id));
                              } else {
                                group.items.forEach(i => next.add(i.id));
                              }
                              return next;
                            });
                          }}
                          onClick={e => e.stopPropagation()}
                          className="rounded flex-shrink-0"
                        />
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
                              className={`flex items-center gap-2 px-2 py-1 rounded border text-[11px] cursor-grab active:cursor-grabbing ${selectedBankItems.has(item.id) ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-100'}`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedBankItems.has(item.id)}
                                onChange={() => toggleSelectBankItem(item.id)}
                                onClick={e => e.stopPropagation()}
                                className="rounded flex-shrink-0"
                              />
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

            {/* BOTTOM: Category columns */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-700">
                  Náklady přiřazené k {selectedLabel}
                </h3>
                <span className="text-xs text-slate-500">
                  Celkem: <strong className="text-slate-700">{formatCZK(assignedCostsTotal)}</strong>
                </span>
              </div>

              {/* Category sections - full width, stacked */}
              <div className="space-y-2 mb-3">
                {EXPENSE_CATEGORIES.map(cat => (
                  <CategorySection
                    key={cat.id}
                    category={cat}
                    items={categoryItems[cat.id] || []}
                    onDrop={handleCategoryDrop}
                    onRemove={handleRemoveFromCategory}
                    onMoveToCategory={handleMoveToCategory}
                    allCategories={EXPENSE_CATEGORIES}
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
