export const ROLES = Object.freeze({
  OWNER: 'owner',
  TEAM: 'team',
  LOGISTICS_ONLY: 'logistics_only',
  NONE: 'none',
});

export const MODULE_IDS = Object.freeze({
  HEATMAP: 'heatmap',
  MARGIN: 'margin',
  TEMPO: 'tempo',
  GEO: 'geo',
  B2B: 'b2b',
  PRODUCTS: 'products',
  IMPORT_LOGISTICS: 'import-logistics',
  ADS: 'ads',
  POKEC: 'pokec',
  FINANCE: 'finance',
});

export const ALL_MODULES = Object.freeze([
  MODULE_IDS.HEATMAP,
  MODULE_IDS.MARGIN,
  MODULE_IDS.TEMPO,
  MODULE_IDS.GEO,
  MODULE_IDS.B2B,
  MODULE_IDS.PRODUCTS,
  MODULE_IDS.IMPORT_LOGISTICS,
  MODULE_IDS.ADS,
  MODULE_IDS.POKEC,
  MODULE_IDS.FINANCE,
]);

export const DASHBOARD_ORDER_MODULES = Object.freeze([
  MODULE_IDS.HEATMAP,
  MODULE_IDS.MARGIN,
  MODULE_IDS.TEMPO,
  MODULE_IDS.GEO,
  MODULE_IDS.B2B,
  MODULE_IDS.PRODUCTS,
  MODULE_IDS.ADS,
]);

export const ROLE_MODULES = Object.freeze({
  [ROLES.OWNER]: ALL_MODULES,
  [ROLES.TEAM]: [
    MODULE_IDS.HEATMAP,
    MODULE_IDS.MARGIN,
    MODULE_IDS.TEMPO,
    MODULE_IDS.GEO,
    MODULE_IDS.B2B,
    MODULE_IDS.ADS,
    MODULE_IDS.FINANCE,
  ],
  [ROLES.LOGISTICS_ONLY]: [MODULE_IDS.IMPORT_LOGISTICS],
  [ROLES.NONE]: [],
});

const DEFAULT_USER_ACCESS = Object.freeze([
  {
    email: 'michal.baturko@regalmaster.cz',
    role: ROLES.OWNER,
    canUploadImportDocuments: true,
  },
  {
    email: 'kristyna.vencel@regalmaster.cz',
    role: ROLES.TEAM,
  },
  {
    email: 'jan.olbert@regalmaster.cz',
    role: ROLES.TEAM,
  },
]);

const ROLE_ENV_KEYS = Object.freeze({
  [ROLES.OWNER]: ['RM_OWNER_EMAILS', 'VITE_RM_OWNER_EMAILS'],
  [ROLES.TEAM]: ['RM_TEAM_EMAILS', 'VITE_RM_TEAM_EMAILS'],
  [ROLES.LOGISTICS_ONLY]: ['RM_LOGISTICS_ONLY_EMAILS', 'VITE_RM_LOGISTICS_ONLY_EMAILS'],
});

const IMPORT_UPLOAD_ENV_KEYS = Object.freeze([
  'RM_IMPORT_DOCUMENT_UPLOAD_EMAILS',
  'VITE_RM_IMPORT_DOCUMENT_UPLOAD_EMAILS',
]);

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getRuntimeEnv() {
  if (typeof process !== 'undefined' && process.env) return process.env;
  if (import.meta?.env) return import.meta.env;
  return {};
}

function parseEmailList(value) {
  return String(value || '')
    .split(/[,\s;]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

function readEnvEmailList(env, keys) {
  return keys.flatMap((key) => parseEmailList(env?.[key]));
}

export function buildUserAccessConfig(env = getRuntimeEnv()) {
  const users = new Map();

  for (const user of DEFAULT_USER_ACCESS) {
    const email = normalizeEmail(user.email);
    if (!email) continue;
    users.set(email, {
      role: user.role,
      canUploadImportDocuments: Boolean(user.canUploadImportDocuments),
    });
  }

  for (const role of [ROLES.TEAM, ROLES.LOGISTICS_ONLY, ROLES.OWNER]) {
    for (const email of readEnvEmailList(env, ROLE_ENV_KEYS[role])) {
      users.set(email, {
        ...(users.get(email) || {}),
        role,
      });
    }
  }

  const uploadEmails = new Set(readEnvEmailList(env, IMPORT_UPLOAD_ENV_KEYS));
  for (const email of uploadEmails) {
    users.set(email, {
      ...(users.get(email) || { role: ROLES.LOGISTICS_ONLY }),
      canUploadImportDocuments: true,
    });
  }

  return users;
}

export function getUserAccess(email, options = {}) {
  const normalizedEmail = normalizeEmail(email);
  const users = buildUserAccessConfig(options.env);
  const configured = normalizedEmail ? users.get(normalizedEmail) : null;
  const role = configured?.role || ROLES.NONE;
  const modules = [...(ROLE_MODULES[role] || ROLE_MODULES[ROLES.NONE])];
  const moduleSet = new Set(modules);
  const canUploadImportDocuments = role === ROLES.OWNER || Boolean(configured?.canUploadImportDocuments);

  return {
    email: normalizedEmail,
    role,
    modules,
    defaultTab: role === ROLES.LOGISTICS_ONLY ? MODULE_IDS.IMPORT_LOGISTICS : MODULE_IDS.HEATMAP,
    canUploadImportDocuments,
    canUsePokec: moduleSet.has(MODULE_IDS.POKEC),
    canUseProducts: moduleSet.has(MODULE_IDS.PRODUCTS),
    canUseFinance: moduleSet.has(MODULE_IDS.FINANCE),
    canUseAds: moduleSet.has(MODULE_IDS.ADS),
    isLogisticsOnly: role === ROLES.LOGISTICS_ONLY,
    hasAccess: modules.length > 0,
    canFetchDashboardOrders: DASHBOARD_ORDER_MODULES.some((moduleId) => moduleSet.has(moduleId)),
  };
}

export function canAccessModule(email, moduleId, options = {}) {
  return getUserAccess(email, options).modules.includes(moduleId);
}

export function getDefaultTab(email, options = {}) {
  return getUserAccess(email, options).defaultTab;
}
