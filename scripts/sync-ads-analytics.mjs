#!/usr/bin/env node

/**
 * Orchestrates detailed marketing syncs.
 *
 * Use ADS_SYNC_PROVIDERS to choose providers:
 * - google_ads
 * - meta_ads
 *
 * The same module powers both CLI usage and the production Vercel cron route.
 */

import { pathToFileURL } from 'node:url';
import { runGoogleAdsDetailSync } from './sync-google-ads-detail.mjs';
import { runMetaAdsDetailSync } from './sync-meta-ads-detail.mjs';

const PROVIDER_RUNNERS = {
  google_ads: runGoogleAdsDetailSync,
  meta_ads: runMetaAdsDetailSync,
};

const PROVIDER_REQUIRED_ENV = {
  google_ads: [
    'GOOGLE_ADS_DEVELOPER_TOKEN',
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

export function missingProviderEnv(provider, env = process.env) {
  const missing = (PROVIDER_REQUIRED_ENV[provider] || []).filter((name) => !env[name]);
  if (provider !== 'google_ads') return missing;

  const hasDirectOauth =
    env.GOOGLE_ADS_CLIENT_ID &&
    env.GOOGLE_ADS_CLIENT_SECRET &&
    env.GOOGLE_ADS_REFRESH_TOKEN;
  const hasBase44Broker =
    env.GOOGLE_ADS_BASE44_APP_ID &&
    env.GOOGLE_ADS_BASE44_ACCESS_TOKEN &&
    env.GOOGLE_ADS_BASE44_TOKEN_ACCOUNT_ID;

  if (hasDirectOauth || hasBase44Broker) return missing;

  return [
    ...missing,
    'GOOGLE_ADS_CLIENT_ID/SECRET/REFRESH_TOKEN or GOOGLE_ADS_BASE44_APP_ID/ACCESS_TOKEN/TOKEN_ACCOUNT_ID',
  ];
}

function printHelp() {
  console.log(`
Usage:
  node scripts/sync-ads-analytics.mjs

Env:
  ADS_SYNC_PROVIDERS=google_ads,meta_ads
  ADS_SYNC_SKIP_MISSING_SECRETS=1
  SYNC_FROM_DATE=YYYY-MM-DD
  SYNC_TO_DATE=YYYY-MM-DD
  SYNC_DAYS_BACK=14
  SYNC_MARKETS=cz,sk,hu,ro

Provider commands:
  node scripts/sync-google-ads-detail.mjs
  node scripts/sync-meta-ads-detail.mjs
`);
}

function withEnvOverrides(envOverrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(envOverrides || {})) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

export async function runAdsAnalyticsSync({ envOverrides = {}, logger = console } = {}) {
  return withEnvOverrides(envOverrides, async () => {
    const providers = parseCsv(process.env.ADS_SYNC_PROVIDERS, ['google_ads', 'meta_ads']);
    const invalid = providers.filter((provider) => !PROVIDER_RUNNERS[provider]);
    if (invalid.length) {
      throw new Error(`[sync-ads-analytics] Unknown provider(s): ${invalid.join(', ')}`);
    }

    const completedProviders = [];
    const skippedProviders = [];

    for (const provider of providers) {
      const missingEnv = missingProviderEnv(provider);
      if (missingEnv.length && process.env.ADS_SYNC_SKIP_MISSING_SECRETS === '1') {
        logger.warn?.(`[sync-ads-analytics] Skipping ${provider}; missing env vars: ${missingEnv.join(', ')}`);
        skippedProviders.push({ provider, reason: `missing env vars: ${missingEnv.join(', ')}` });
        continue;
      }
      if (missingEnv.length) {
        throw new Error(`[sync-ads-analytics] Missing env vars for ${provider}: ${missingEnv.join(', ')}`);
      }

      logger.log?.(`[sync-ads-analytics] Running ${provider}`);
      await PROVIDER_RUNNERS[provider]();
      completedProviders.push(provider);
    }

    logger.log?.('[sync-ads-analytics] Done');
    return { completedProviders, skippedProviders };
  });
}

function isDirectRun() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun()) {
  if (process.argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  runAdsAnalyticsSync().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
