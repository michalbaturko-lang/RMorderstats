#!/usr/bin/env node

/**
 * Read-only Supabase report for Google Ads landing-page diagnostics.
 *
 * Defaults:
 * - REPORT_FROM_DATE=2026-04-01
 * - REPORT_TO_DATE=today UTC
 * - REPORT_MARKETS=cz,sk,hu,ro
 * - REPORT_RESOURCE=expanded_landing_page_view
 */

import {
  requireEnv,
  roundMetric,
  roundMoney,
  supabaseRequest,
  toDateString,
} from './lib/ads-sync-utils.mjs';

const TYPE_SUMMARY_VIEW = 'ad_landing_page_period_type_summary_mv';
const URL_SUMMARY_VIEW = 'ad_landing_page_period_url_summary_mv';
const DEFAULT_MARKETS = ['cz', 'sk', 'hu', 'ro'];
const DEFAULT_RESOURCE = 'expanded_landing_page_view';

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    json: args.has('--json'),
  };
}

function todayUtc() {
  return toDateString(new Date());
}

function parseMarkets() {
  return (process.env.REPORT_MARKETS || DEFAULT_MARKETS.join(','))
    .split(',')
    .map((market) => market.trim().toLowerCase())
    .filter(Boolean);
}

async function fetchSummaryRows({ supabaseUrl, serviceRoleKey, table, markets, resource }) {
  const pageSize = Number(process.env.REPORT_PAGE_SIZE || 1000);
  const all = [];
  let offset = 0;

  while (true) {
    const searchParams = {
      select: '*',
      market: `in.(${markets.join(',')})`,
      order: 'period_bucket.asc',
      limit: pageSize,
      offset,
    };
    if (resource !== 'all') searchParams.resource = `eq.${resource}`;

    const batch = await supabaseRequest({
      supabaseUrl,
      serviceRoleKey,
      path: `/rest/v1/${table}`,
      searchParams,
    });

    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function channelBucket(row) {
  const type = String(row.channel_type || 'unknown').toUpperCase();
  const subType = String(row.channel_sub_type || '').toUpperCase();
  if (type === 'SEARCH') return 'Search';
  if (type === 'SHOPPING' || subType.includes('SHOPPING')) return 'Shopping';
  if (type === 'PERFORMANCE_MAX') return 'PMax';
  if (type === 'DISPLAY') return 'Display';
  return type || 'unknown';
}

function emptyMetric() {
  return {
    rows: 0,
    spendCzk: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversionValueCzk: 0,
  };
}

function addMetrics(target, row) {
  target.rows += number(row.row_count) || 1;
  target.spendCzk += number(row.cost_czk);
  target.impressions += number(row.impressions);
  target.clicks += number(row.clicks);
  target.conversions += number(row.conversions);
  target.conversionValueCzk += number(row.conversion_value_czk);
}

function finalizeMetric(metric) {
  return {
    rows: metric.rows,
    spend_czk: roundMoney(metric.spendCzk),
    impressions: Math.round(metric.impressions),
    clicks: Math.round(metric.clicks),
    conversions: roundMetric(metric.conversions),
    conversion_value_czk: roundMoney(metric.conversionValueCzk),
    ads_aov_czk: metric.conversions > 0 ? roundMoney(metric.conversionValueCzk / metric.conversions) : null,
    ads_roas: metric.spendCzk > 0 ? roundMetric(metric.conversionValueCzk / metric.spendCzk) : null,
  };
}

function groupRows(rows, keyFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!grouped.has(key)) grouped.set(key, emptyMetric());
    addMetrics(grouped.get(key), row);
  }
  return [...grouped.entries()].map(([key, metric]) => ({ key, ...finalizeMetric(metric) }));
}

function aggregateLandingPages(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = [
      row.market,
      channelBucket(row),
      row.landing_page_type || 'other',
      row.product_size_flag || 'other',
      row.landing_page_url || '',
    ].join('||');

    if (!grouped.has(key)) {
      grouped.set(key, {
        ...emptyMetric(),
        market: row.market,
        channel: channelBucket(row),
        landing_page_type: row.landing_page_type || 'other',
        product_size_flag: row.product_size_flag || 'other',
        landing_page_url: row.landing_page_url || '',
      });
    }

    addMetrics(grouped.get(key), row);
  }

  return [...grouped.values()].map((metric) => ({
    market: metric.market,
    channel: metric.channel,
    landing_page_type: metric.landing_page_type,
    product_size_flag: metric.product_size_flag,
    landing_page_url: metric.landing_page_url,
    ...finalizeMetric(metric),
  }));
}

function topBy(rows, field, limit = 10) {
  return [...rows]
    .filter((row) => {
      if (field === 'ads_aov_czk') return number(row.conversions) > 0 && row.ads_aov_czk !== null;
      return number(row[field]) > 0;
    })
    .sort((a, b) => number(b[field]) - number(a[field]))
    .slice(0, limit);
}

function formatCurrency(value) {
  if (value === null || value === undefined) return '-';
  return `${Math.round(number(value)).toLocaleString('cs-CZ')} CZK`;
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined) return '-';
  return number(value).toLocaleString('cs-CZ', { maximumFractionDigits: digits });
}

function printRows(title, rows, columns, limit = rows.length) {
  console.log(`\n## ${title}`);
  if (!rows.length) {
    console.log('No rows.');
    return;
  }

  const subset = rows.slice(0, limit);
  console.log(columns.join(' | '));
  console.log(columns.map(() => '---').join(' | '));
  for (const row of subset) {
    console.log(columns.map((column) => String(row[column] ?? '')).join(' | '));
  }
}

function buildReport({ typeRows, urlRows, resource }) {
  const roRows = typeRows.filter((row) => row.market === 'ro' && ['2026-04', '2026-05-14+'].includes(row.period_bucket));
  const roByPeriodChannelType = groupRows(roRows, (row) => [
    row.period_bucket,
    channelBucket(row),
    row.landing_page_type || 'other',
    row.product_size_flag || 'other',
  ].join(' / '))
    .map((row) => ({
      segment: row.key,
      spend_czk: row.spend_czk,
      clicks: row.clicks,
      conversions: row.conversions,
      conversion_value_czk: row.conversion_value_czk,
      ads_aov_czk: row.ads_aov_czk,
      ads_roas: row.ads_roas,
    }))
    .sort((a, b) => number(b.spend_czk) - number(a.spend_czk));

  const huRows = typeRows.filter((row) => row.market === 'hu');
  const huPeriods = groupRows(huRows, (row) => [row.period_bucket, channelBucket(row)].join(' / '));
  const huHpPeriods = groupRows(huRows.filter((row) => row.landing_page_type === 'hp'), (row) => [row.period_bucket, channelBucket(row)].join(' / '));
  const hpByKey = new Map(huHpPeriods.map((row) => [row.key, row]));
  const huHpShare = huPeriods
    .map((row) => {
      const hp = hpByKey.get(row.key) || finalizeMetric(emptyMetric());
      return {
        segment: row.key,
        spend_czk: row.spend_czk,
        hp_spend_czk: hp.spend_czk,
        hp_spend_share_pct: row.spend_czk > 0 ? roundMetric((number(hp.spend_czk) / number(row.spend_czk)) * 100, 2) : 0,
        clicks: row.clicks,
        hp_clicks: hp.clicks,
        hp_click_share_pct: row.clicks > 0 ? roundMetric((number(hp.clicks) / number(row.clicks)) * 100, 2) : 0,
        conversions: row.conversions,
        hp_conversions: hp.conversions,
      };
    })
    .sort((a, b) => number(b.hp_spend_share_pct) - number(a.hp_spend_share_pct));

  const landingPages = aggregateLandingPages(urlRows);
  const top = {
    spend: topBy(landingPages, 'spend_czk'),
    clicks: topBy(landingPages, 'clicks'),
    conversions: topBy(landingPages, 'conversions'),
    conversion_value: topBy(landingPages, 'conversion_value_czk'),
    ads_aov: topBy(landingPages, 'ads_aov_czk'),
  };

  return {
    generated_at: new Date().toISOString(),
    resource,
    type_summary_rows: typeRows.length,
    url_summary_rows: urlRows.length,
    ro_april_vs_post_2026_05_14: roByPeriodChannelType,
    hu_hp_share: huHpShare,
    top_landing_pages: top,
  };
}

function printReport(report) {
  console.log('# Google Ads Landing-Page Diagnostics');
  console.log(`Resource: ${report.resource}`);
  console.log(`Type summary rows: ${report.type_summary_rows}`);
  console.log(`URL summary rows: ${report.url_summary_rows}`);
  console.log(`Generated: ${report.generated_at}`);

  printRows(
    'RO April vs 2026-05-14+ by Search/Shopping/PMax and landing page type',
    report.ro_april_vs_post_2026_05_14.map((row) => ({
      segment: row.segment,
      spend: formatCurrency(row.spend_czk),
      clicks: formatNumber(row.clicks),
      conversions: formatNumber(row.conversions, 2),
      value: formatCurrency(row.conversion_value_czk),
      aov: formatCurrency(row.ads_aov_czk),
      roas: formatNumber(row.ads_roas, 2),
    })),
    ['segment', 'spend', 'clicks', 'conversions', 'value', 'aov', 'roas'],
  );

  printRows(
    'HU homepage landing share',
    report.hu_hp_share.map((row) => ({
      segment: row.segment,
      spend: formatCurrency(row.spend_czk),
      hp_spend: formatCurrency(row.hp_spend_czk),
      hp_spend_pct: `${formatNumber(row.hp_spend_share_pct, 2)}%`,
      clicks: formatNumber(row.clicks),
      hp_clicks: formatNumber(row.hp_clicks),
      hp_click_pct: `${formatNumber(row.hp_click_share_pct, 2)}%`,
    })),
    ['segment', 'spend', 'hp_spend', 'hp_spend_pct', 'clicks', 'hp_clicks', 'hp_click_pct'],
  );

  for (const [name, rows] of Object.entries(report.top_landing_pages)) {
    printRows(
      `Top landing pages by ${name}`,
      rows.map((row) => ({
        market: row.market,
        channel: row.channel,
        type: row.landing_page_type,
        size: row.product_size_flag,
        spend: formatCurrency(row.spend_czk),
        clicks: formatNumber(row.clicks),
        conv: formatNumber(row.conversions, 2),
        value: formatCurrency(row.conversion_value_czk),
        aov: formatCurrency(row.ads_aov_czk),
        url: row.landing_page_url,
      })),
      ['market', 'channel', 'type', 'size', 'spend', 'clicks', 'conv', 'value', 'aov', 'url'],
      10,
    );
  }
}

async function main() {
  const args = parseArgs();
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const from = process.env.REPORT_FROM_DATE || '2026-04-01';
  const to = process.env.REPORT_TO_DATE || todayUtc();
  const markets = parseMarkets();
  const resource = process.env.REPORT_RESOURCE || DEFAULT_RESOURCE;

  if (from !== '2026-04-01' || to < '2026-05-14') {
    console.warn('[check-google-ads-landing-pages] Optimized report uses fixed period buckets: 2026-04, 2026-05-01..13 and 2026-05-14+.');
  }
  if (resource === 'all') {
    console.warn('[check-google-ads-landing-pages] REPORT_RESOURCE=all can double count metrics because expanded and unexpanded landing-page views both carry Ads metrics.');
  }

  const [typeRows, urlRows] = await Promise.all([
    fetchSummaryRows({ supabaseUrl, serviceRoleKey, table: TYPE_SUMMARY_VIEW, markets, resource }),
    fetchSummaryRows({ supabaseUrl, serviceRoleKey, table: URL_SUMMARY_VIEW, markets, resource }),
  ]);
  const report = buildReport({ typeRows, urlRows, resource });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

main().catch((error) => {
  console.error('[check-google-ads-landing-pages] FAILED:', error.message);
  process.exit(1);
});
