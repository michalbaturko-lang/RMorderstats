#!/usr/bin/env node

/**
 * Read-only small-GA debug for Hungarian paid sessions landing on the homepage.
 *
 * Defaults:
 * - GA_SESSIONS_TABLE=sl_session_recordings
 * - GA_EVENTS_TABLE=sl_events
 * - GA_SITE_COLUMN=site_key
 * - GA_SITE_KEY=hu
 * - GA_SESSION_DATE_COLUMN=started_at
 * - DEBUG_FROM_DATE=2026-05-14
 * - DEBUG_TO_DATE=today UTC
 */

import {
  requireEnv,
  supabaseRequest,
  toDateString,
} from './lib/ads-sync-utils.mjs';

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    json: args.has('--json'),
  };
}

function todayUtc() {
  return toDateString(new Date());
}

function dateTimeStart(value) {
  return String(value).includes('T') ? value : `${value}T00:00:00Z`;
}

function dateTimeEnd(value) {
  return String(value).includes('T') ? value : `${value}T23:59:59Z`;
}

async function fetchAll({ supabaseUrl, serviceRoleKey, table, searchParams }) {
  const pageSize = Number(process.env.DEBUG_PAGE_SIZE || 1000);
  const all = [];
  let offset = 0;

  while (true) {
    const batch = await supabaseRequest({
      supabaseUrl,
      serviceRoleKey,
      path: `/rest/v1/${table}`,
      searchParams: {
        ...searchParams,
        limit: pageSize,
        offset,
      },
    });

    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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

function isHomePage(value) {
  const url = parseUrl(value);
  if (!url) return false;
  const path = url.pathname.replace(/\/+/g, '/');
  return path === '/' || path === '' || /^\/(?:index|home)\/?$/.test(normalizeText(path));
}

function isPaidSession(session) {
  const source = normalizeText(getField(session, ['source', 'utm_source', 'traffic_source', 'channel_source']));
  const medium = normalizeText(getField(session, ['medium', 'utm_medium', 'traffic_medium', 'channel_medium']));
  const channel = normalizeText(getField(session, ['channel_group', 'channel', 'source_medium']));
  return /(cpc|ppc|paid|ads|adwords)/.test(`${source} ${medium} ${channel}`);
}

function sessionId(session) {
  return String(getField(session, ['session_id', 'id']) || '');
}

function sessionLandingUrl(session) {
  return getField(session, [
    'landing_page_url',
    'landing_url',
    'entry_url',
    'initial_url',
    'page_url',
    'url',
  ]);
}

function firstEventUrl(event) {
  return getField(event, ['page_url', 'url', 'current_url', 'href'])
    || event?.event_data?.page_url
    || event?.event_data?.url
    || event?.properties?.page_url
    || event?.properties?.url
    || null;
}

function extractQueryIds(value) {
  const url = parseUrl(value);
  const result = {
    gclid: null,
    gbraid: null,
    wbraid: null,
    fbclid: null,
    msclkid: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
  };
  if (!url) return result;
  for (const key of Object.keys(result)) result[key] = url.searchParams.get(key);
  return result;
}

function findKeysDeep(value, wanted, depth = 0, found = {}) {
  if (!value || typeof value !== 'object' || depth > 4) return found;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (wanted.has(normalized) && found[normalized] == null && item != null && typeof item !== 'object') {
      found[normalized] = String(item);
    }
    if (item && typeof item === 'object') findKeysDeep(item, wanted, depth + 1, found);
  }
  return found;
}

function mergeAttribution(session, event) {
  const landingUrl = sessionLandingUrl(session);
  const eventUrl = firstEventUrl(event);
  const sessionIds = extractQueryIds(landingUrl);
  const eventIds = extractQueryIds(eventUrl);
  const deep = findKeysDeep(
    {
      session,
      event_data: event?.event_data,
      properties: event?.properties,
    },
    new Set(['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'utm_source', 'utm_medium', 'utm_campaign']),
  );

  const source = getField(session, ['source', 'utm_source', 'traffic_source', 'channel_source']) || sessionIds.utm_source || eventIds.utm_source || deep.utm_source || null;
  const medium = getField(session, ['medium', 'utm_medium', 'traffic_medium', 'channel_medium']) || sessionIds.utm_medium || eventIds.utm_medium || deep.utm_medium || null;
  const campaign = getField(session, ['campaign', 'utm_campaign', 'traffic_campaign']) || sessionIds.utm_campaign || eventIds.utm_campaign || deep.utm_campaign || null;

  return {
    landing_url: landingUrl,
    first_event_url: eventUrl,
    source,
    medium,
    campaign,
    referrer: getField(session, ['referrer', 'referer', 'document_referrer']) || event?.event_data?.referrer || event?.properties?.referrer || null,
    gclid: getField(session, ['gclid']) || sessionIds.gclid || eventIds.gclid || deep.gclid || null,
    gbraid: getField(session, ['gbraid']) || sessionIds.gbraid || eventIds.gbraid || deep.gbraid || null,
    wbraid: getField(session, ['wbraid']) || sessionIds.wbraid || eventIds.wbraid || deep.wbraid || null,
    fbclid: getField(session, ['fbclid']) || sessionIds.fbclid || eventIds.fbclid || deep.fbclid || null,
    msclkid: getField(session, ['msclkid']) || sessionIds.msclkid || eventIds.msclkid || deep.msclkid || null,
  };
}

function explainAttribution(attribution) {
  if (attribution.gclid) return 'google_gclid_present';
  if (attribution.gbraid || attribution.wbraid) return 'google_consent_click_id_present';
  if (attribution.fbclid) return 'meta_fbclid_present';
  if (attribution.msclkid) return 'microsoft_msclkid_present';

  const source = normalizeText(attribution.source);
  const medium = normalizeText(attribution.medium);
  const referrer = normalizeText(attribution.referrer);
  const urls = normalizeText(`${attribution.landing_url || ''} ${attribution.first_event_url || ''}`);

  if (medium.includes('cpc') && source.includes('google')) return 'google_utm_cpc_without_google_click_id';
  if (medium.includes('cpc') && /(facebook|meta|instagram)/.test(source + referrer + urls)) return 'paid_social_cpc_without_google_click_id';
  if (medium.includes('cpc') && /(utm_source|utm_medium)/.test(urls)) return 'manual_utm_cpc_without_click_id';
  if (medium.includes('cpc')) return 'medium_cpc_derived_without_visible_click_id';
  return 'not_obviously_paid_after_client_side_parse';
}

function groupBy(rows, key) {
  const counts = new Map();
  for (const row of rows) counts.set(row[key], (counts.get(row[key]) || 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function formatSample(row) {
  return {
    session_id: row.session_id,
    started_at: row.started_at,
    source: row.source,
    medium: row.medium,
    campaign: row.campaign,
    gclid: row.gclid ? 'yes' : 'no',
    gbraid: row.gbraid ? 'yes' : 'no',
    wbraid: row.wbraid ? 'yes' : 'no',
    reason: row.reason,
    landing_url: row.landing_url,
    first_event_url: row.first_event_url,
  };
}

async function fetchFirstEvents({ supabaseUrl, serviceRoleKey, eventsTable, siteColumn, siteKey, sessions }) {
  const ids = sessions.map(sessionId).filter(Boolean);
  const firstBySession = new Map();
  const chunkSize = Number(process.env.DEBUG_EVENT_SESSION_CHUNK || 50);

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const rows = await fetchAll({
      supabaseUrl,
      serviceRoleKey,
      table: eventsTable,
      searchParams: {
        select: '*',
        [siteColumn]: `eq.${siteKey}`,
        session_id: `in.(${chunk.map((id) => `"${id.replace(/"/g, '')}"`).join(',')})`,
        order: 'created_at.asc',
      },
    });

    for (const row of rows) {
      const id = String(row.session_id || '');
      if (!id || firstBySession.has(id)) continue;
      firstBySession.set(id, row);
    }
  }

  return firstBySession;
}

async function main() {
  const args = parseArgs();
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const sessionsTable = process.env.GA_SESSIONS_TABLE || 'sl_session_recordings';
  const eventsTable = process.env.GA_EVENTS_TABLE || 'sl_events';
  const siteColumn = process.env.GA_SITE_COLUMN || 'site_key';
  const siteKey = process.env.GA_SITE_KEY || 'hu';
  const dateColumn = process.env.GA_SESSION_DATE_COLUMN || 'started_at';
  const from = process.env.DEBUG_FROM_DATE || '2026-05-14';
  const to = process.env.DEBUG_TO_DATE || todayUtc();
  const limit = Number(process.env.DEBUG_HU_HP_SESSION_LIMIT || 200);
  const paidEventLimit = Number(process.env.DEBUG_PAID_SESSION_EVENT_LIMIT || 500);

  const sessions = await fetchAll({
    supabaseUrl,
    serviceRoleKey,
    table: sessionsTable,
    searchParams: {
      select: '*',
      [siteColumn]: `eq.${siteKey}`,
      [dateColumn]: [`gte.${dateTimeStart(from)}`, `lte.${dateTimeEnd(to)}`],
      order: `${dateColumn}.desc`,
    },
  });

  const paidSessions = sessions
    .filter((session) => isPaidSession(session))
    .slice(0, paidEventLimit);

  const firstEvents = await fetchFirstEvents({
    supabaseUrl,
    serviceRoleKey,
    eventsTable,
    siteColumn,
    siteKey,
    sessions: paidSessions,
  });

  const samples = paidSessions.map((session) => {
    const id = sessionId(session);
    const event = firstEvents.get(id) || null;
    const attribution = mergeAttribution(session, event);
    return {
      session_id: id,
      started_at: getField(session, [dateColumn, 'started_at', 'created_at']),
      first_event_type: getField(event, ['event_type', 'type', 'name']),
      ...attribution,
      reason: explainAttribution(attribution),
    };
  })
    .filter((sample) => isHomePage(sample.landing_url) || isHomePage(sample.first_event_url))
    .slice(0, limit);

  const report = {
    generated_at: new Date().toISOString(),
    site_key: siteKey,
    date_range: { from, to },
    sessions_scanned: sessions.length,
    paid_sessions_event_checked: paidSessions.length,
    paid_hp_sessions_sampled: samples.length,
    reason_counts: groupBy(samples, 'reason'),
    samples: samples.map(formatSample),
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('# HU Homepage Paid Session Debug');
  console.log(`Generated: ${report.generated_at}`);
  console.log(`Scanned sessions: ${report.sessions_scanned}`);
  console.log(`Paid sessions checked with first events: ${report.paid_sessions_event_checked}`);
  console.log(`Paid homepage sessions sampled: ${report.paid_hp_sessions_sampled}`);
  console.log('\n## Why medium=cpc can appear without a Google click id');
  for (const row of report.reason_counts) {
    console.log(`- ${row.name}: ${row.count}`);
  }
  console.log('\n## Samples');
  for (const sample of report.samples.slice(0, 25)) {
    console.log(`- ${sample.started_at || ''} ${sample.session_id}: ${sample.source || '-'} / ${sample.medium || '-'} / ${sample.campaign || '-'} | gclid=${sample.gclid}, gbraid=${sample.gbraid}, wbraid=${sample.wbraid} | ${sample.reason}`);
    console.log(`  landing: ${sample.landing_url || '-'}`);
    console.log(`  first:   ${sample.first_event_url || '-'}`);
  }
}

main().catch((error) => {
  console.error('[debug-hu-hp-sessions] FAILED:', error.message);
  process.exit(1);
});
