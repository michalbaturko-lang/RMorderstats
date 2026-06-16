export const FX_RATES_TO_CZK = {
  CZK: 1,
  EUR: 24.258970358814352,
  USD: 20.958,
  HUF: 0.06822999099587825,
  RON: 4.630859745682293,
};

export const CURRENCY_BY_MARKET = {
  cz: 'CZK',
  sk: 'EUR',
  hu: 'HUF',
  ro: 'RON',
};

export const MARKET_VAT_RATES = {
  CZK: 21,
  EUR: 23,
  HUF: 27,
  RON: 21,
};

export const normalizeCurrency = (currency) => String(currency || 'CZK').trim().toUpperCase();

export const getCurrencyRateToCzk = (currency) => {
  const normalized = normalizeCurrency(currency);
  return FX_RATES_TO_CZK[normalized] || 1;
};

export const convertCurrencyToCzk = (value, currency) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number * getCurrencyRateToCzk(currency) : 0;
};
