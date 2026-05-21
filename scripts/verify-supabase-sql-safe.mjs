#!/usr/bin/env node

/**
 * Lightweight SQL safety gate for manually applied Supabase view scripts.
 *
 * This is intentionally conservative: it allows additive/read-model SQL such
 * as CREATE OR REPLACE VIEW plus grants/revokes, and blocks table/data
 * destructive statements. It is not a SQL parser; it is a guardrail before the
 * manual workflow applies business analytics views.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

const allowedFiles = new Set([
  'ad_business_analytics_views.sql',
  'ad_landing_pages_daily.sql',
  'ad_marketing_view_security_fix.sql',
]);

const forbiddenPatterns = [
  /\bdrop\s+database\b/i,
  /\bdrop\s+schema\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+table\b[^;]*\bdrop\b/i,
  /\balter\s+table\b[^;]*\brename\b/i,
  /\balter\s+table\b[^;]*\balter\s+column\b/i,
  /\bupdate\s+public\./i,
  /\binsert\s+into\s+public\./i,
  /\bcopy\s+public\./i,
];

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    throw new Error('Usage: node scripts/verify-supabase-sql-safe.mjs <supabase/sql-file.sql>');
  }

  const repoRoot = realpathSync(process.cwd());
  const filePath = realpathSync(resolve(repoRoot, fileArg));
  const rel = relative(repoRoot, filePath);

  if (rel.startsWith('..') || rel.includes('\0')) {
    throw new Error(`SQL file must be inside the repository: ${fileArg}`);
  }
  if (!rel.startsWith('supabase/')) {
    throw new Error(`SQL file must be under supabase/: ${rel}`);
  }
  if (!allowedFiles.has(basename(filePath))) {
    throw new Error(`SQL file is not in the apply allowlist: ${rel}`);
  }

  const sql = stripSqlComments(readFileSync(filePath, 'utf8'));
  const failures = forbiddenPatterns.filter((pattern) => pattern.test(sql));

  if (failures.length) {
    console.error('[verify-supabase-sql-safe] Forbidden SQL patterns:');
    for (const pattern of failures) console.error(`- ${pattern}`);
    throw new Error(`SQL safety check failed for ${rel}`);
  }

  console.log(`[verify-supabase-sql-safe] SQL safety check OK: ${rel}`);
}

try {
  main();
} catch (error) {
  console.error('[verify-supabase-sql-safe] FAILED:', error.message);
  process.exit(1);
}
