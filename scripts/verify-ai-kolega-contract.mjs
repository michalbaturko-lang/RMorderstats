#!/usr/bin/env node

/**
 * Verifies the static contract for the Regal Master "Pokec" AI colleague.
 *
 * This is intentionally local and read-only. It checks that the knowledge
 * artifacts define the required sources, tools, playbooks, evals and safety
 * invariants before any runtime AI orchestration is wired in.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

const REQUIRED_DOCS = [
  'docs/ai-kolega-operating-manual.md',
  'docs/ai-kolega-goal-spec.md',
];
const REQUIRED_RUNTIME_FILES = [
  'api/pokec.js',
  'src/PokecModule.jsx',
  'scripts/check-ai-kolega-readiness.mjs',
  'scripts/run-pokec-evals.mjs',
];
const REQUIRED_SQL_FILES = [
  'supabase/ai_kolega_knowledge.sql',
  'supabase/ai_kolega_seed.sql',
];

const REQUIRED_SOURCE_IDS = [
  'upgates_orders',
  'google_ads',
  'meta_ads',
  'small_ga',
  'matrix_competition',
  'import_logistics',
  'ai_memory',
];

const REQUIRED_TOOL_IDS = [
  'get_orders_summary',
  'get_margin_breakdown',
  'get_product_mix',
  'get_bundle_analysis',
  'get_missing_buy_prices',
  'get_shipping_revenue',
  'get_ads_spend',
  'get_ads_campaigns',
  'get_ads_landing_pages',
  'get_ads_search_terms',
  'get_ads_shopping_products',
  'get_meta_spend',
  'get_meta_campaigns',
  'get_small_ga_landing_pages',
  'get_small_ga_sessions',
  'get_competitor_changes',
  'compare_periods',
  'get_data_freshness',
  'get_known_contexts',
  'get_relevant_memories',
  'get_relevant_examples',
  'get_meeting_notes',
  'get_experiments',
  'get_import_orders_on_the_way',
  'get_import_order_detail',
  'get_inbound_stock_risk',
  'get_landed_cost_changes',
  'get_import_match_gaps',
  'get_import_document_coverage',
  'save_memory_candidate',
];

const REQUIRED_PLAYBOOK_IDS = [
  'daily_briefing',
  'capabilities_overview',
  'knowledge_review',
  'trusted_best_practices',
  'assortment_strategy',
  'storefront_walkthrough',
  'shipping_revenue',
  'aov_drop',
  'margin_drop',
  'high_pno',
  'order_drop_intraday',
  'product_mix_change',
  'campaign_mix_change',
  'country_change',
  'bundle_diagnostics',
  'landing_page_problem',
  'competitor_change',
  'import_logistics_overview',
  'stockout_risk',
  'inbound_eta',
  'landed_cost_change',
  'import_data_quality',
  'missing_data',
];

const REQUIRED_EVAL_IDS = [
  'capabilities_overview',
  'knowledge_review',
  'trusted_best_practices',
  'assortment_strategy',
  'storefront_walkthrough',
  'shipping_revenue',
  'daily_briefing_summary',
  'aov_drop_hu',
  'margin_drop_today',
  'high_pno_ro',
  'order_drop_intraday',
  'product_mix_change',
  'campaign_mix_change',
  'country_change',
  'search_vs_shopping_mix',
  'landing_page_visual_guardrail',
  'bundle_margin',
  'missing_buy_prices',
  'competitor_change',
  'missing_meta_data',
  'adversarial_no_evidence',
  'llm_no_new_numbers',
  'memory_candidate_pending',
  'import_logistics_on_the_way',
  'import_stockout_risk',
  'import_landed_cost_change',
  'import_data_quality',
];

const REQUIRED_EVAL_DIMENSIONS = [
  'tool_choice',
  'business_reasoning',
  'evidence',
  'uncertainty',
  'no_hallucination',
  'actionability',
  'memory_use',
  'format',
  'read_only_safety',
];
const REQUIRED_SEED_SLUGS = [
  'revenue-aov-shipping-definition',
  'margin-definition',
  'excluded-order-statuses',
  'may-14-2026-pricing-and-bundles',
  'aov-product-mix-landing-pages',
  'bundle-products-need-separate-analysis',
  'storefront-assortment-parity-guardrail',
  'landing-page-visual-guardrail',
  'ads-meta-read-only',
  'competition-needs-fresh-scrape',
  'import-logistics-read-only-doctrine',
  'aov-drop-hu-example',
  'margin-drop-today-example',
  'memory-candidate-example',
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ids(collection, field = 'id') {
  return new Set(collection.map((item) => item[field]));
}

function requireIds(label, actualSet, requiredIds) {
  const missing = requiredIds.filter((id) => !actualSet.has(id));
  assert(!missing.length, `${label} missing required id(s): ${missing.join(', ')}`);
}

function assertArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  assert(value.length > 0, `${label} must not be empty`);
}

function verifyDocs() {
  for (const doc of REQUIRED_DOCS) {
    assert(fs.existsSync(path.join(ROOT, doc)), `Missing required doc: ${doc}`);
    const text = readText(doc);
    assert(text.includes('halucin') || text.includes('hallucination'), `${doc} must mention hallucination guardrails`);
    assert(text.includes('read-only') || text.includes('read only'), `${doc} must mention read-only safety`);
  }
}

function verifyRuntimeScaffold() {
  for (const file of REQUIRED_RUNTIME_FILES) {
    assert(fs.existsSync(path.join(ROOT, file)), `Missing required runtime file: ${file}`);
  }

  const api = readText('api/pokec.js');
  const ui = readText('src/PokecModule.jsx');
  const app = readText('src/App.jsx');
  const packageJson = readText('package.json');
  const readiness = readText('scripts/check-ai-kolega-readiness.mjs');
  const localEvals = readText('scripts/run-pokec-evals.mjs');

  assert(api.includes('auth.getUser'), 'api/pokec.js must verify the Supabase user token');
  assert(api.includes('ALLOWED_DOMAINS'), 'api/pokec.js must enforce allowed email domains');
  assert(api.includes('POKEC_ALLOWED_EMAILS') || api.includes('canAccessModule'), 'api/pokec.js must enforce Pokec email allowlist or centralized module access');
  assert(api.includes('michal.baturko@regalmaster.cz') || readText('src/userPermissions.js').includes('michal.baturko@regalmaster.cz'), 'Pokec access must default to Michal via API or centralized permissions');
  assert(api.includes('EXCLUDED_STATUSES'), 'api/pokec.js must expose excluded business statuses');
  assert(api.includes('read-only') || api.includes('read_only'), 'api/pokec.js must document/read as read-only');
  assert(api.includes('getKnowledgeContext'), 'api/pokec.js must load relevant team context/memory');
  assert(api.includes("from('ai_business_contexts')"), 'api/pokec.js must read ai_business_contexts');
  assert(api.includes("from('ai_memories')"), 'api/pokec.js must read ai_memories');
  assert(api.includes("from('ai_examples')"), 'api/pokec.js must read ai_examples');
  assert(api.includes("from('ai_meeting_notes')"), 'api/pokec.js must read ai_meeting_notes');
  assert(api.includes("from('ai_experiments')"), 'api/pokec.js must read ai_experiments');
  assert(api.includes("tool: 'compare_periods'"), 'api/pokec.js must execute period comparison');
  assert(api.includes('previousPeriod'), 'api/pokec.js must expose previous period evidence');
  assert(api.includes('PLAYBOOK_HINTS'), 'api/pokec.js must define runtime playbook hints');
  assert(api.includes('buildPlaybookEvidence'), 'api/pokec.js must build playbook evidence');
  assert(api.includes('evaluateMustNotSkipStatuses'), 'api/pokec.js must evaluate must-not-skip guardrails at runtime');
  assert(api.includes('buildCatalogSnapshot'), 'api/pokec.js must build a catalog snapshot for playbooks and data sources');
  assert(api.includes('buildSourceCoverageRows'), 'api/pokec.js must build source coverage rows from runtime evidence');
  assert(api.includes("../src/ai/pokec-playbooks.json"), 'api/pokec.js must read the playbook registry JSON');
  assert(api.includes("../src/ai/pokec-data-sources.json"), 'api/pokec.js must read the data source registry JSON');
  assert(api.includes("../src/ai/pokec-tool-registry.json"), 'api/pokec.js must read the tool registry JSON');
  assert(api.includes('buildDailyBriefingQuestion'), 'api/pokec.js must support a dedicated daily briefing mode');
  assert(api.includes("return 'capabilities_overview'"), 'api/pokec.js must support a capabilities overview intent');
  assert(api.includes("return 'knowledge_review'"), 'api/pokec.js must support a knowledge review intent');
  assert(api.includes("return 'trusted_best_practices'"), 'api/pokec.js must support a trusted best practices intent');
  assert(api.includes("return 'assortment_strategy'"), 'api/pokec.js must support an assortment strategy intent');
  assert(api.includes("return 'storefront_walkthrough'"), 'api/pokec.js must support a storefront walkthrough intent');
  assert(api.includes("return 'import_logistics_overview'"), 'api/pokec.js must support import logistics overview intent');
  assert(api.includes("return 'stockout_risk'"), 'api/pokec.js must support import stockout risk intent');
  assert(api.includes("return 'landed_cost_change'"), 'api/pokec.js must support landed cost intent');
  assert(api.includes("return 'import_data_quality'"), 'api/pokec.js must support import data quality intent');
  assert(api.includes('Co umím z jednotlivých zdrojů'), 'api/pokec.js must return per-source capability overview');
  assert(api.includes('Nejdůležitější business pravdy ke schválení'), 'api/pokec.js must return a knowledge review table');
  assert(api.includes('Trusted doctrine'), 'api/pokec.js must return a trusted doctrine table');
  assert(api.includes('Co už je potvrzené u Regal Master'), 'api/pokec.js must return a Regal-validated context table');
  assert(api.includes('Assortment roles'), 'api/pokec.js must return an assortment roles table');
  assert(api.includes('Produktové rodiny'), 'api/pokec.js must return a product-family aggregation table');
  assert(api.includes('Potvrzené storefront signály'), 'api/pokec.js must return a storefront walkthrough table');
  assert(api.includes("return 'shipping_revenue'"), 'api/pokec.js must support a shipping revenue intent');
  assert(api.includes('Tržba z poštovného po dnech'), 'api/pokec.js must return shipping-by-day table');
  assert(api.includes('Tržba z poštovného podle země'), 'api/pokec.js must return shipping-by-market table');
  assert(api.includes("tool: 'get_shipping_revenue'"), 'api/pokec.js must surface shipping revenue tool usage');
  assert(api.includes("tool: 'get_missing_buy_prices'"), 'api/pokec.js must surface missing buy prices tool usage');
  assert(api.includes('Playbook checklist'), 'api/pokec.js must return a playbook checklist table');
  assert(api.includes('guardrail:'), 'api/pokec.js must surface evaluated guardrails in the playbook checklist');
  assert(api.includes('Použitý playbook a zdroje'), 'api/pokec.js must return a playbook/source snapshot table');
  assert(api.includes('Dostupné datové zdroje pro tuto diagnózu'), 'api/pokec.js must return a data source availability table');
  assert(api.includes('Pokrytí zdrojů'), 'api/pokec.js must return a source coverage table');
  assert(api.includes("action === 'daily_briefing'"), 'api/pokec.js must route daily briefing action');
  assert(api.includes("intent === 'daily_briefing'"), 'api/pokec.js must support daily briefing intent');
  assert(api.includes('buildBriefing'), 'api/pokec.js must build a structured briefing block');
  assert(api.includes('getDataFreshness'), 'api/pokec.js must implement data freshness runtime checks');
  assert(api.includes('getMetaSpend'), 'api/pokec.js must implement Meta spend runtime checks');
  assert(api.includes('getAdsCampaigns'), 'api/pokec.js must implement Google Ads campaign reads');
  assert(api.includes('getAdsSearchTerms'), 'api/pokec.js must implement Google Ads search term reads');
  assert(api.includes('getAdsShoppingProducts'), 'api/pokec.js must implement Google Ads shopping product reads');
  assert(api.includes('getSmallGaLandingPages'), 'api/pokec.js must implement small GA landing page reads');
  assert(api.includes('getSmallGaSessions'), 'api/pokec.js must implement small GA session reads');
  assert(api.includes('SMALL_GA_SESSION_TABLE'), 'api/pokec.js must target a concrete small GA session source');
  assert(api.includes('getMetaCampaigns'), 'api/pokec.js must implement Meta campaign reads');
  assert(api.includes('getCompetitorChanges'), 'api/pokec.js must implement competitor observation reads');
  assert(api.includes('summarizeOrdersByHour'), 'api/pokec.js must implement hourly order breakdown support');
  assert(api.includes('summarizeOrderValueBuckets'), 'api/pokec.js must implement order value bucket breakdown support');
  assert(api.includes('summarizeOrderItemCountBuckets'), 'api/pokec.js must implement order item count bucket breakdown support');
  assert(api.includes("tool: 'get_meta_campaigns'") || api.includes("get_meta_campaigns"), 'api/pokec.js must surface Meta campaign tool usage');
  assert(api.includes("tool: 'get_meta_spend'") || api.includes("get_meta_spend"), 'api/pokec.js must surface Meta spend tool usage');
  assert(api.includes("tool: 'get_ads_campaigns'") || api.includes('get_ads_campaigns'), 'api/pokec.js must surface Ads campaign tool usage');
  assert(api.includes("tool: 'get_ads_search_terms'") || api.includes('get_ads_search_terms'), 'api/pokec.js must surface Ads search term tool usage');
  assert(api.includes("tool: 'get_ads_shopping_products'") || api.includes('get_ads_shopping_products'), 'api/pokec.js must surface Ads shopping product tool usage');
  assert(api.includes("tool: 'get_competitor_changes'") || api.includes("get_competitor_changes"), 'api/pokec.js must surface competitor tool usage');
  assert(api.includes("tool: 'get_import_orders_on_the_way'") || api.includes('get_import_orders_on_the_way'), 'api/pokec.js must surface import orders tool usage');
  assert(api.includes("tool: 'get_inbound_stock_risk'") || api.includes('get_inbound_stock_risk'), 'api/pokec.js must surface inbound stock risk tool usage');
  assert(api.includes("tool: 'get_landed_cost_changes'") || api.includes('get_landed_cost_changes'), 'api/pokec.js must surface landed cost tool usage');
  assert(api.includes("tool: 'get_import_match_gaps'") || api.includes('get_import_match_gaps'), 'api/pokec.js must surface import match gap tool usage');
  assert(api.includes("tool: 'get_import_document_coverage'") || api.includes('get_import_document_coverage'), 'api/pokec.js must surface import document coverage tool usage');
  assert(api.includes('Top Google Ads kampaně') || api.includes('Top Google Ads kampane'), 'api/pokec.js must render a top Google Ads campaigns table');
  assert(api.includes('Top Ads search terms'), 'api/pokec.js must render a top search terms table');
  assert(api.includes('Top Ads shopping produkty'), 'api/pokec.js must render a top shopping products table');
  assert(api.includes('Objednávky podle hodnotových bucketů'), 'api/pokec.js must render order value bucket table');
  assert(api.includes('Objednávky podle počtu kusů'), 'api/pokec.js must render order item-count bucket table');
  assert(api.includes('examples') || api.includes('get_relevant_examples'), 'api/pokec.js must surface approved examples usage');
  assert(api.includes('meetingNotes') || api.includes('get_meeting_notes'), 'api/pokec.js must surface meeting notes usage');
  assert(api.includes('experiments') || api.includes('get_experiments'), 'api/pokec.js must surface experiment usage');
  assert(api.includes('saveMemoryCandidate'), 'api/pokec.js must support explicit memory candidate saving');
  assert(api.includes('saveExampleCandidate'), 'api/pokec.js must support explicit example candidate saving');
  assert(api.includes("action === 'save_example_candidate'"), 'api/pokec.js must route save_example_candidate action');
  assert(api.includes("memory_type: 'example'"), 'api/pokec.js must save examples as memory_type=example candidates');
  assert(api.includes("from('ai_memory_candidates')"), 'api/pokec.js may only append to ai_memory_candidates');
  assert(api.includes('runAiInterpretation'), 'api/pokec.js must define the server-side AI interpretation layer');
  assert(api.includes('AI_INTERPRETATION_SCHEMA'), 'api/pokec.js must use a strict AI interpretation schema');
  assert(api.includes("store: false"), 'api/pokec.js must disable OpenAI response storage for AI interpretation');
  assert(api.includes('safety_identifier'), 'api/pokec.js must use a safety identifier instead of raw user identifiers');
  assert(api.includes('OPENAI_API_KEY'), 'api/pokec.js must keep OpenAI access server-side');
  assert(api.includes('mergeAiInterpretation'), 'api/pokec.js must merge AI output without replacing tool evidence');
  const insertTargets = [...api.matchAll(/from\(['"]([^'"]+)['"]\)\s*\.\s*insert\s*\(/g)].map((match) => match[1]);
  assert(insertTargets.every((target) => target === 'ai_memory_candidates'), `api/pokec.js may only insert into ai_memory_candidates, got: ${insertTargets.join(', ')}`);
  const insertCount = (api.match(/\.insert\s*\(/g) || []).length;
  assert(insertCount === insertTargets.length, 'api/pokec.js must not contain unscoped insert calls');
  assert(!/from\(['"][^'"]+['"]\)\.(update|delete|upsert)/.test(api), 'api/pokec.js must not call destructive Supabase methods');

  assert(ui.includes('/api/pokec'), 'Pokec UI must call /api/pokec');
  assert(ui.includes('Co umíš a k jakým datům máš přístup?'), 'Pokec UI must expose a capabilities starter question');
  assert(ui.includes('Kolik jsme vybrali na poštovném a doběrečném?'), 'Pokec UI must expose a shipping starter question');
  assert(ui.includes('Evidence'), 'Pokec UI must render evidence');
  assert(ui.includes('AI interpretace nad evidencí'), 'Pokec UI must render AI interpretation separately from facts');
  assert(ui.includes('Co chybí') || ui.includes('missingData'), 'Pokec UI must render missing data');
  assert(ui.includes('save_memory_candidate'), 'Pokec UI must be able to save memory candidates');
  assert(ui.includes('save_example_candidate'), 'Pokec UI must be able to save example candidates');
  assert(ui.includes('Přidat příklad, co má Pokec umět'), 'Pokec UI must expose example candidate form');
  assert(ui.includes('candidate-only'), 'Pokec UI must label example workflow as candidate-only');
  assert(ui.includes('localStorage'), 'Pokec UI must persist local conversation continuity');
  assert(ui.includes('buildHistoryKey'), 'Pokec UI must scope local history by user');
  assert(ui.includes('Smazat lokální historii'), 'Pokec UI must allow clearing local history');
  assert(ui.includes('Denní briefing'), 'Pokec UI must expose a daily briefing action');
  assert(ui.includes('Knowledge review'), 'Pokec UI must expose a knowledge review action');
  assert(ui.includes('BriefingCard'), 'Pokec UI must render a dedicated daily briefing block');
  assert(app.includes('POKEC_ALLOWED_EMAILS') || app.includes('getUserAccess'), 'App must define Pokec UI email allowlist or centralized user access guard');
  assert(app.includes('canUsePokec'), 'App must hide Pokec tab behind canUsePokec');
  assert(app.includes("...(canUsePokec ? [{ id: 'pokec'") || (app.includes('allowedTabs.filter') && app.includes('access.modules.includes')), 'App must only render Pokec tab for allowed users');
  assert(app.includes("id: 'pokec'") || app.includes('MODULE_IDS.POKEC'), 'App tabs must include Pokec');
  assert(app.includes('<PokecModule'), 'App must render PokecModule');
  assert(app.includes('userEmail={user?.email}'), 'App must pass userEmail to Pokec for scoped local history');
  assert(packageJson.includes('check:ai-kolega-readiness'), 'package.json must expose AI colleague readiness check');
  assert(packageJson.includes('eval:ai-kolega'), 'package.json must expose AI colleague local eval runner');
  assert(readiness.includes('REQUIRED_TABLES'), 'readiness check must verify expected AI tables');
  assert(readiness.includes('--live'), 'readiness check must support live Supabase verification');
  assert(!/insert\s*\(/.test(readiness), 'readiness check must not insert data');
  assert(localEvals.includes('__pokecTestKit'), 'local eval runner must use Pokec test kit export');
  assert(localEvals.includes('daily_briefing_summary'), 'local eval runner must cover daily briefing scenario');
  assert(localEvals.includes('aov_drop_hu'), 'local eval runner must cover AOV drop scenario');
  assert(localEvals.includes('margin_drop_today'), 'local eval runner must cover margin drop scenario');
  assert(localEvals.includes('high_pno_ro'), 'local eval runner must cover high PNO scenario');
  assert(localEvals.includes('order_drop_intraday'), 'local eval runner must cover intraday order drop scenario');
  assert(localEvals.includes('product_mix_change'), 'local eval runner must cover product mix change scenario');
  assert(localEvals.includes('campaign_mix_change'), 'local eval runner must cover campaign mix change scenario');
  assert(localEvals.includes('country_change'), 'local eval runner must cover country change scenario');
  assert(localEvals.includes('search_vs_shopping_mix'), 'local eval runner must cover search vs shopping scenario');
  assert(localEvals.includes('landing_page_visual_guardrail'), 'local eval runner must cover landing page guardrail scenario');
  assert(localEvals.includes('bundle_margin'), 'local eval runner must cover bundle margin scenario');
  assert(localEvals.includes('missing_buy_prices'), 'local eval runner must cover missing buy prices scenario');
  assert(localEvals.includes('competitor_change'), 'local eval runner must cover competitor scenario');
  assert(localEvals.includes('missing_meta_data'), 'local eval runner must cover missing Meta scenario');
  assert(localEvals.includes('adversarial_no_evidence'), 'local eval runner must cover adversarial no-evidence scenario');
  assert(localEvals.includes('llm_no_new_numbers'), 'local eval runner must cover LLM no-new-numbers scenario');
  assert(localEvals.includes('import_logistics_on_the_way'), 'local eval runner must cover import logistics overview scenario');
  assert(localEvals.includes('import_stockout_risk'), 'local eval runner must cover import stockout risk scenario');
  assert(localEvals.includes('import_landed_cost_change'), 'local eval runner must cover import landed cost scenario');
  assert(localEvals.includes('import_data_quality'), 'local eval runner must cover import data quality scenario');
  assert(!/createClient\(/.test(localEvals), 'local eval runner must stay offline and not create Supabase clients');
}

function verifySources() {
  const data = readJson('src/ai/pokec-data-sources.json');
  assert(data.version >= 1, 'data sources version must be present');
  assertArray(data.sources, 'sources');
  requireIds('sources', ids(data.sources), REQUIRED_SOURCE_IDS);

  for (const source of data.sources) {
    assert(source.label, `source ${source.id} missing label`);
    assertArray(source.can_answer, `source ${source.id}.can_answer`);
    assertArray(source.known_limits, `source ${source.id}.known_limits`);
    assertArray(source.allowed_operations, `source ${source.id}.allowed_operations`);

    if (source.id !== 'ai_memory') {
      assert(source.mutation_allowed === false, `source ${source.id} must be mutation_allowed=false`);
      assert(source.allowed_operations.every((op) => op === 'select'), `source ${source.id} must only allow select`);
    }
  }
}

function verifyTools() {
  const toolsData = readJson('src/ai/pokec-tool-registry.json');
  const sourceData = readJson('src/ai/pokec-data-sources.json');
  const sourceIds = ids(sourceData.sources);

  assert(toolsData.rules?.business_data_mutations_allowed === false, 'business data mutations must be disabled');
  assert(toolsData.rules?.ads_mutations_allowed === false, 'Ads mutations must be disabled');
  assert(toolsData.rules?.meta_mutations_allowed === false, 'Meta mutations must be disabled');
  assert(toolsData.rules?.upgates_mutations_allowed === false, 'Upgates mutations must be disabled');
  assert(toolsData.rules?.requires_evidence_for_numbers === true, 'numbers must require evidence');
  assert(toolsData.rules?.requires_missing_data_disclosure === true, 'missing data disclosure must be required');
  assertArray(toolsData.tools, 'tools');
  requireIds('tools', ids(toolsData.tools), REQUIRED_TOOL_IDS);

  for (const tool of toolsData.tools) {
    assert(sourceIds.has(tool.source_id), `tool ${tool.id} references unknown source ${tool.source_id}`);
    assertArray(tool.inputs, `tool ${tool.id}.inputs`);
    assertArray(tool.outputs, `tool ${tool.id}.outputs`);
    assertArray(tool.evidence_fields, `tool ${tool.id}.evidence_fields`);
    assertArray(tool.allowed_operations, `tool ${tool.id}.allowed_operations`);

    if (tool.id === 'save_memory_candidate') {
      assert(tool.access_mode === 'append_candidate_only', 'save_memory_candidate must only append candidates');
      assert(tool.allowed_operations.length === 1 && tool.allowed_operations[0] === 'insert_ai_memory_candidate', 'save_memory_candidate operation must be candidate-only');
      assert((tool.guardrails || []).some((item) => item.includes('business data')), 'save_memory_candidate must guard business data');
    } else {
      assert(tool.access_mode === 'read_only', `tool ${tool.id} must be read_only`);
      assert(tool.allowed_operations.every((op) => op === 'select'), `tool ${tool.id} must only allow select`);
    }
  }
}

function verifyPlaybooks() {
  const playbookData = readJson('src/ai/pokec-playbooks.json');
  const toolIds = ids(readJson('src/ai/pokec-tool-registry.json').tools);
  assertArray(playbookData.playbooks, 'playbooks');
  requireIds('playbooks', ids(playbookData.playbooks), REQUIRED_PLAYBOOK_IDS);

  for (const playbook of playbookData.playbooks) {
    assertArray(playbook.required_tools, `playbook ${playbook.id}.required_tools`);
    assertArray(playbook.steps, `playbook ${playbook.id}.steps`);
    assertArray(playbook.must_not_skip, `playbook ${playbook.id}.must_not_skip`);

    for (const toolId of playbook.required_tools) {
      assert(toolIds.has(toolId), `playbook ${playbook.id} references unknown tool ${toolId}`);
    }
  }
}

function verifyEvals() {
  const evalData = readJson('src/ai/pokec-evals.json');
  const toolIds = ids(readJson('src/ai/pokec-tool-registry.json').tools);
  const playbookIds = ids(readJson('src/ai/pokec-playbooks.json').playbooks);
  assertArray(evalData.scoring_dimensions, 'scoring_dimensions');
  requireIds('eval dimensions', new Set(evalData.scoring_dimensions), REQUIRED_EVAL_DIMENSIONS);
  assert(evalData.minimum_thresholds?.critical_no_hallucination === 1, 'critical hallucination threshold must be 1');
  assert(evalData.minimum_thresholds?.read_only_safety === 1, 'read-only safety threshold must be 1');
  assertArray(evalData.evals, 'evals');
  requireIds('evals', ids(evalData.evals), REQUIRED_EVAL_IDS);

  for (const evaluation of evalData.evals) {
    assert(evaluation.prompt, `eval ${evaluation.id} missing prompt`);
    assertArray(evaluation.expected_playbooks, `eval ${evaluation.id}.expected_playbooks`);
    assertArray(evaluation.required_tools, `eval ${evaluation.id}.required_tools`);
    assertArray(evaluation.must_include, `eval ${evaluation.id}.must_include`);
    assertArray(evaluation.must_not_claim_without_evidence, `eval ${evaluation.id}.must_not_claim_without_evidence`);

    for (const playbookId of evaluation.expected_playbooks) {
      assert(playbookIds.has(playbookId), `eval ${evaluation.id} references unknown playbook ${playbookId}`);
    }
    for (const toolId of evaluation.required_tools) {
      assert(toolIds.has(toolId), `eval ${evaluation.id} references unknown tool ${toolId}`);
    }
  }
}

function verifySqlSafety() {
  for (const file of REQUIRED_SQL_FILES) {
    assert(fs.existsSync(path.join(ROOT, file)), `Missing required SQL file: ${file}`);
  }

  const sql = REQUIRED_SQL_FILES.map((file) => readText(file).toLowerCase()).join('\n');
  const forbidden = [
    /drop\s+table/,
    /truncate\s+/,
    /delete\s+from\s+public\.(?!ai_)/,
    /update\s+public\.(?!ai_)/,
    /insert\s+into\s+public\.(?!ai_)/,
    /grant\s+(update|delete)\s+on/,
  ];

  for (const pattern of forbidden) {
    assert(!pattern.test(sql), `SQL contains forbidden pattern: ${pattern}`);
  }

  assert(sql.includes('enable row level security'), 'SQL must enable RLS');
  assert(sql.includes('ai_memory_candidates_insert_authenticated'), 'SQL must define candidate-only insert policy');
  assert(sql.includes('grant insert on public.ai_memory_candidates'), 'SQL may only grant insert on memory candidates');

  const tableTouches = [...sql.matchAll(/\b(?:insert\s+into|alter\s+table|create\s+(?:table|index)|grant\s+\w+\s+on)\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/g)]
    .map((match) => match[1]);
  const nonAiTouches = tableTouches.filter((table) => !table.startsWith('ai_'));
  assert(!nonAiTouches.length, `SQL may only touch public.ai_* tables, got: ${nonAiTouches.join(', ')}`);

  const seed = readText('supabase/ai_kolega_seed.sql');
  for (const slug of REQUIRED_SEED_SLUGS) {
    assert(seed.includes(slug), `ai_kolega_seed.sql missing required seed slug: ${slug}`);
  }
  for (const sourceId of REQUIRED_SOURCE_IDS.filter((id) => id !== 'ai_memory')) {
    assert(seed.includes(sourceId), `ai_kolega_seed.sql missing source seed: ${sourceId}`);
  }
}

function main() {
  verifyDocs();
  verifyRuntimeScaffold();
  verifySources();
  verifyTools();
  verifyPlaybooks();
  verifyEvals();
  verifySqlSafety();
  console.log('[verify-ai-kolega] Contract OK: docs, sources, tools, playbooks, evals and SQL safety checks passed.');
}

main();
