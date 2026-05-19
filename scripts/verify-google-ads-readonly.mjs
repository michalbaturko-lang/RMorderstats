#!/usr/bin/env node

/**
 * Guardrail for marketing Ads integrations.
 *
 * The application may read Google/Meta reporting data and write copies into
 * Supabase, but it must never mutate ad accounts. Keep this check in
 * CI/workflows so accidental campaign/budget/ad/audience changes cannot enter
 * the sync code silently.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GOOGLE_FILES_TO_CHECK = [
  'scripts/sync-google-ads-detail.mjs',
  'scripts/sync-google-ads-costs.mjs',
];

const META_FILES_TO_CHECK = [
  'scripts/sync-meta-ads-detail.mjs',
];

const FORBIDDEN_GOOGLE_PATTERNS = [
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

const FORBIDDEN_META_PATTERNS = [
  /\bmethod\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i,
  /\b(create|update|delete|remove)(Campaign|AdSet|Ad|AdCreative|Audience|CustomAudience)\b/i,
  /\b(adcampaign|campaign|adset|ad|adcreative|customaudience)[A-Z_a-z]*(Create|Update|Delete|Remove)\b/i,
  /\b(ad_campaign|campaign|adset|ad|adcreative|customaudience)s?\/[^`'"]*(create|update|delete|remove)\b/i,
];

let failed = false;

for (const file of GOOGLE_FILES_TO_CHECK) {
  const contents = readFileSync(join(process.cwd(), file), 'utf8');
  for (const pattern of FORBIDDEN_GOOGLE_PATTERNS) {
    if (pattern.test(contents)) {
      console.error(`[verify-ads-readonly] Forbidden Google Ads mutation pattern in ${file}: ${pattern}`);
      failed = true;
    }
  }

  const googleAdsEndpoints = [...contents.matchAll(/googleads\.googleapis\.com[^`'"]+/gi)].map((match) => match[0]);
  for (const endpoint of googleAdsEndpoints) {
    if (!endpoint.includes('googleAds:searchStream')) {
      console.error(`[verify-ads-readonly] Non-reporting Google Ads endpoint in ${file}: ${endpoint}`);
      failed = true;
    }
  }
}

for (const file of META_FILES_TO_CHECK) {
  const contents = readFileSync(join(process.cwd(), file), 'utf8');
  for (const pattern of FORBIDDEN_META_PATTERNS) {
    if (pattern.test(contents)) {
      console.error(`[verify-ads-readonly] Forbidden Meta Ads mutation pattern in ${file}: ${pattern}`);
      failed = true;
    }
  }

  const unexpectedFetch = contents
    .replace(/\bfetch\s*\(\s*endpoint\s*\)/g, '')
    .replace(/\bfetch\s*\(\s*next\s*\)/g, '');
  if (/\bfetch\s*\(/.test(unexpectedFetch)) {
    console.error(`[verify-ads-readonly] Unexpected Meta fetch call in ${file}; keep Meta Graph calls in read-only fetchGraph/fetchPagedGraph helpers.`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log('[verify-ads-readonly] Google Ads and Meta Ads sync are read-only.');
