const normalizeStatus = (value) => String(value || '').trim().toUpperCase();

export const EXCLUDED_BUSINESS_STATUS_TOKENS = ['STORNO', 'SELHAL'];

export const isExcludedBusinessStatus = (value) => {
  const status = normalizeStatus(value);
  if (!status) return false;
  return EXCLUDED_BUSINESS_STATUS_TOKENS.some((token) => status.includes(token));
};

export const isExcludedBusinessOrder = (order) => {
  return isExcludedBusinessStatus(order?.status) || isExcludedBusinessStatus(order?.raw_data?.status);
};
