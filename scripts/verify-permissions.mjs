import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_MODULES,
  MODULE_IDS,
  ROLES,
  canAccessModule,
  getDefaultTab,
  getUserAccess,
} from '../src/userPermissions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const env = {
  RM_TEAM_EMAILS: 'honza.test@regalmaster.cz',
  RM_LOGISTICS_ONLY_EMAILS: 'alex.test@regalmaster.cz',
};

const michal = getUserAccess('michal.baturko@regalmaster.cz', { env });
assert.equal(michal.role, ROLES.OWNER);
assert.deepEqual([...michal.modules].sort(), [...ALL_MODULES].sort());
assert.equal(michal.canUsePokec, true);
assert.equal(michal.canUseProducts, true);
assert.equal(michal.canUseFinance, true);
assert.equal(michal.canUploadImportDocuments, true);

const kristyna = getUserAccess('kristyna.vencel@regalmaster.cz', { env });
assert.equal(kristyna.role, ROLES.TEAM);
assert.equal(kristyna.canUsePokec, false);
assert.equal(kristyna.canUseProducts, false);
assert.equal(kristyna.canUseFinance, true);
assert.equal(canAccessModule(kristyna.email, MODULE_IDS.POKEC, { env }), false);
assert.equal(canAccessModule(kristyna.email, MODULE_IDS.PRODUCTS, { env }), false);

const honza = getUserAccess('honza.test@regalmaster.cz', { env });
assert.equal(honza.role, ROLES.TEAM);
assert.equal(honza.canUsePokec, false);
assert.equal(honza.canUseProducts, false);
assert.equal(honza.canUseFinance, true);

const honzaProduction = getUserAccess('jan.olbert@regalmaster.cz', { env });
assert.equal(honzaProduction.role, ROLES.TEAM);
assert.equal(honzaProduction.canUsePokec, false);
assert.equal(honzaProduction.canUseProducts, false);
assert.equal(honzaProduction.canUseFinance, true);

const alex = getUserAccess('alex.test@regalmaster.cz', { env });
assert.equal(alex.role, ROLES.LOGISTICS_ONLY);
assert.deepEqual(alex.modules, [MODULE_IDS.IMPORT_LOGISTICS]);
assert.equal(alex.defaultTab, MODULE_IDS.IMPORT_LOGISTICS);
assert.equal(getDefaultTab(alex.email, { env }), MODULE_IDS.IMPORT_LOGISTICS);
assert.equal(alex.canFetchDashboardOrders, false);
assert.equal(alex.canUploadImportDocuments, false);
assert.equal(canAccessModule(alex.email, MODULE_IDS.HEATMAP, { env }), false);
assert.equal(canAccessModule(alex.email, MODULE_IDS.IMPORT_LOGISTICS, { env }), true);

const alexWithUpload = getUserAccess('alex.test@regalmaster.cz', {
  env: {
    ...env,
    RM_IMPORT_DOCUMENT_UPLOAD_EMAILS: 'alex.test@regalmaster.cz',
  },
});
assert.equal(alexWithUpload.canUploadImportDocuments, true);

const unknown = getUserAccess('unknown@example.com', { env });
assert.equal(unknown.role, ROLES.NONE);
assert.deepEqual(unknown.modules, []);
assert.equal(unknown.hasAccess, false);
assert.equal(getDefaultTab(unknown.email, { env }), MODULE_IDS.HEATMAP);

const appSource = readText('src/App.jsx');
assert.match(appSource, /if \(!user \|\| !access\.canFetchDashboardOrders\)/, 'App must guard dashboard orders fetch by permission.');
assert.match(appSource, /if \(!user \|\| !canUseAds\)/, 'App must guard ads summary fetch by permission.');
assert(appSource.includes('const navContent') && appSource.includes('allowedTabs.filter'), 'App must render navigation from allowedTabs.');
assert(appSource.includes('canUploadDocuments={access.canUploadImportDocuments}'), 'App must pass import document upload permission.');
assert(!appSource.includes("Authorization': `Bearer ${SUPABASE_KEY}`"), 'App direct REST reads must use the signed-in user token, not the anon key as bearer token.');

const importLogisticsSource = readText('src/ImportLogisticsModule.jsx');
assert(importLogisticsSource.includes('canLoadSalesHistory'), 'Import logistics must support disabling sales history fetches.');
assert(importLogisticsSource.includes('canLoadSalesHistory') && importLogisticsSource.includes('fetchOrdersViaRest'), 'Import logistics history fetch must be gated.');
assert(importLogisticsSource.includes('Upload dokumentů není pro tento účet povolený.'), 'Import document upload must have a read-only denial path.');
assert(!importLogisticsSource.includes('Authorization: `Bearer ${supabaseKey}`'), 'Import logistics sales-history REST reads must use the signed-in user token.');
assert(!readText('src/ProductsModule.jsx').includes('Authorization: `Bearer ${supabaseKey}`'), 'Products REST reads must use the signed-in user token.');

const pokecApiSource = readText('api/pokec.js');
assert(pokecApiSource.includes('canAccessModule(email, MODULE_IDS.POKEC)'), 'Pokec API must use module permission guard.');

const importDocumentsApiSource = readText('api/import-documents.js');
assert(importDocumentsApiSource.includes('MODULE_IDS.IMPORT_LOGISTICS'), 'Import documents API must require import logistics read access.');
assert(importDocumentsApiSource.includes('canUploadImportDocuments'), 'Import documents API must require upload permission for writes.');

const adsApiSource = readText('api/ads-summary.js');
assert(adsApiSource.includes('canAccessModule(email, MODULE_IDS.ADS)'), 'Ads summary API must use module permission guard.');

console.log('Permissions verification passed.');
