#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const LIVE = process.argv.includes('--live') || process.env.AI_KOLEGA_LIVE === '1';
const LOCAL_ONLY = process.argv.includes('--local-only') || !LIVE;

const REQUIRED_FILES = [
  'api/pokec.js',
  'src/PokecModule.jsx',
  'src/ai/pokec-data-sources.json',
  'src/ai/pokec-tool-registry.json',
  'src/ai/pokec-playbooks.json',
  'src/ai/pokec-evals.json',
  'supabase/ai_kolega_knowledge.sql',
  'supabase/ai_kolega_seed.sql',
];

const REQUIRED_TABLES = [
  'ai_business_contexts',
  'ai_playbooks',
  'ai_data_sources',
  'ai_examples',
  'ai_memories',
  'ai_memory_candidates',
  'ai_meeting_notes',
  'ai_experiments',
  'ai_open_questions',
  'ai_data_quality_issues',
  'ai_competitor_observations',
];

const REQUIRED_SEED_CONTEXTS = [
  'revenue-aov-shipping-definition',
  'margin-definition',
  'aov-product-mix-landing-pages',
  'ads-meta-read-only',
];

const results = [];

function record(status, label, detail = '') {
  results.push({ status, label, detail });
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return null;
  const index = trimmed.indexOf('=');
  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadLocalEnv() {
  for (const file of ['.env.local', '.env']) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath)) continue;
    for (const line of fs.readFileSync(fullPath, 'utf8').split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      if (!process.env[parsed.key]) process.env[parsed.key] = parsed.value;
    }
  }
}

function envValue(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return '';
}

function hasEnv(...names) {
  return Boolean(envValue(...names));
}

async function supabaseGet({ supabaseUrl, key, table, query = 'select=*&limit=1' }) {
  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}?${query}`;
  const response = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 180)}`);
  }
  return response.json();
}

async function checkLiveSupabase() {
  const supabaseUrl = envValue('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl) {
    record('fail', 'Supabase URL', 'Chybi SUPABASE_URL nebo NEXT_PUBLIC_SUPABASE_URL.');
    return;
  }
  if (!serviceKey) {
    record('fail', 'Supabase service key', 'Chybi SUPABASE_SERVICE_ROLE_KEY pro live schema/readiness kontrolu.');
    return;
  }

  for (const table of REQUIRED_TABLES) {
    try {
      await supabaseGet({ supabaseUrl, key: serviceKey, table });
      record('ok', `Supabase table ${table}`, 'Queryable pres service role.');
    } catch (error) {
      record('fail', `Supabase table ${table}`, error.message);
    }
  }

  for (const slug of REQUIRED_SEED_CONTEXTS) {
    try {
      const rows = await supabaseGet({
        supabaseUrl,
        key: serviceKey,
        table: 'ai_business_contexts',
        query: `select=slug&slug=eq.${encodeURIComponent(slug)}&limit=1`,
      });
      if (Array.isArray(rows) && rows.length) {
        record('ok', `Seed context ${slug}`, 'Found in live Supabase.');
      } else {
        record('warn', `Seed context ${slug}`, 'Table exists, but seed row is missing.');
      }
    } catch (error) {
      record('fail', `Seed context ${slug}`, error.message);
    }
  }
}

async function main() {
  loadLocalEnv();

  for (const file of REQUIRED_FILES) {
    record(fs.existsSync(path.join(ROOT, file)) ? 'ok' : 'fail', `File ${file}`);
  }

  record(hasEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL') ? 'ok' : 'warn', 'Supabase URL env', 'Needed for runtime.');
  record(hasEnv('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY') ? 'ok' : 'warn', 'Supabase anon env', 'Needed for auth/runtime.');
  record(hasEnv('SUPABASE_SERVICE_ROLE_KEY') ? 'ok' : 'warn', 'Supabase service role env', 'Needed only for live readiness/apply checks.');

  const aiMode = (process.env.POKEC_AI_MODE || 'tool_first').toLowerCase();
  if (aiMode === 'tool_first' || aiMode === 'off') {
    record('ok', 'Pokec AI mode', `Mode ${aiMode}; LLM is optional and tool-first fallback is expected.`);
  } else if (hasEnv('OPENAI_API_KEY')) {
    record('ok', 'OpenAI env', `Mode ${aiMode}; OPENAI_API_KEY is present.`);
  } else {
    record('fail', 'OpenAI env', `POKEC_AI_MODE=${aiMode}, but OPENAI_API_KEY is missing.`);
  }

  try {
    await import(path.join(ROOT, 'api/pokec.js'));
    record('ok', 'API import', 'api/pokec.js imports successfully.');
  } catch (error) {
    record('fail', 'API import', error.message);
  }

  if (LIVE) {
    await checkLiveSupabase();
  } else if (LOCAL_ONLY) {
    record('warn', 'Live Supabase schema check', 'Skipped. Run npm run check:ai-kolega-readiness -- --live after applying SQL.');
  }

  const counts = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  for (const item of results) {
    const marker = item.status === 'ok' ? 'OK' : item.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${marker}] ${item.label}${item.detail ? ` - ${item.detail}` : ''}`);
  }

  console.log(`[check-ai-kolega-readiness] ${counts.ok || 0} ok, ${counts.warn || 0} warn, ${counts.fail || 0} fail.`);
  if (counts.fail) process.exit(1);
}

main().catch((error) => {
  console.error(`[check-ai-kolega-readiness] failed: ${error.message}`);
  process.exit(1);
});
