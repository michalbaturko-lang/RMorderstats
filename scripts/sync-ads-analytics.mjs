#!/usr/bin/env node

/**
 * Orchestrates detailed marketing syncs.
 *
 * Use ADS_SYNC_PROVIDERS to choose providers:
 * - google_ads
 * - meta_ads
 *
 * This wrapper keeps one public command while the provider-specific scripts stay
 * small and easier to audit.
 */

import { spawnSync } from 'node:child_process';

const PROVIDER_SCRIPTS = {
  google_ads: 'scripts/sync-google-ads-detail.mjs',
  meta_ads: 'scripts/sync-meta-ads-detail.mjs',
};

const PROVIDER_REQUIRED_ENV = {
  google_ads: [
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN',
    'GOOGLE_ADS_ACCOUNTS_JSON',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ],
  meta_ads: [
    'META_ACCESS_TOKEN',
    'META_ADS_ACCOUNTS_JSON',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ],
};

function parseCsv(value, fallback) {
  const values = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : fallback;
}

function missingProviderEnv(provider) {
  return (PROVIDER_REQUIRED_ENV[provider] || []).filter((name) => !process.env[name]);
}

function printHelp() {
  console.log(`
Usage:
  node scripts/sync-ads-analytics.mjs

Env:
  ADS_SYNC_PROVIDERS=google_ads,meta_ads
  SYNC_FROM_DATE=YYYY-MM-DD
  SYNC_TO_DATE=YYYY-MM-DD
  SYNC_DAYS_BACK=14
  SYNC_MARKETS=cz,sk,hu,ro

Provider commands:
  node scripts/sync-google-ads-detail.mjs
  node scripts/sync-meta-ads-detail.mjs
`);
}

if (process.argv.includes('--help')) {
  printHelp();
  process.exit(0);
}

const providers = parseCsv(process.env.ADS_SYNC_PROVIDERS, ['google_ads', 'meta_ads']);
const invalid = providers.filter((provider) => !PROVIDER_SCRIPTS[provider]);
if (invalid.length) {
  console.error(`[sync-ads-analytics] Unknown provider(s): ${invalid.join(', ')}`);
  process.exit(1);
}

for (const provider of providers) {
  const missingEnv = missingProviderEnv(provider);
  if (missingEnv.length && process.env.ADS_SYNC_SKIP_MISSING_SECRETS === '1') {
    console.warn(`[sync-ads-analytics] Skipping ${provider}; missing env vars: ${missingEnv.join(', ')}`);
    continue;
  }

  const script = PROVIDER_SCRIPTS[provider];
  console.log(`[sync-ads-analytics] Running ${provider} via ${script}`);
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`[sync-ads-analytics] ${provider} failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[sync-ads-analytics] ${provider} exited with status ${result.status}`);
    process.exit(result.status || 1);
  }
}

console.log('[sync-ads-analytics] Done');
