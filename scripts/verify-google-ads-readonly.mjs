#!/usr/bin/env node

/**
 * Guardrail for Google Ads integrations.
 *
 * The application may read Google Ads reports and write copies into Supabase,
 * but it must never mutate Google Ads accounts. Keep this check in CI/workflows
 * so accidental campaign/budget/ad changes cannot enter the sync code silently.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILES_TO_CHECK = [
  'scripts/sync-google-ads-detail.mjs',
  'scripts/sync-google-ads-costs.mjs',
];

const FORBIDDEN_PATTERNS = [
  /googleAds:mutate/i,
  /:mutate\b/i,
  /\bmutate[A-Z_a-z]*\b/,
  /\bCampaignOperation\b/,
  /\bCampaignBudgetOperation\b/,
  /\bAdGroupOperation\b/,
  /\bAdGroupAdOperation\b/,
  /\bAdGroupCriterionOperation\b/,
  /\bCustomerOperation\b/,
  /\bAssetOperation\b/,
  /\bremoveOperation\b/,
  /\bcreateOperation\b/,
  /\bupdateOperation\b/,
];

let failed = false;

for (const file of FILES_TO_CHECK) {
  const contents = readFileSync(join(process.cwd(), file), 'utf8');
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(contents)) {
      console.error(`[verify-google-ads-readonly] Forbidden Google Ads mutation pattern in ${file}: ${pattern}`);
      failed = true;
    }
  }

  const googleAdsEndpoints = [...contents.matchAll(/googleads\.googleapis\.com[^`'"]+/gi)].map((match) => match[0]);
  for (const endpoint of googleAdsEndpoints) {
    if (!endpoint.includes('googleAds:searchStream')) {
      console.error(`[verify-google-ads-readonly] Non-reporting Google Ads endpoint in ${file}: ${endpoint}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log('[verify-google-ads-readonly] Google Ads sync is read-only.');
