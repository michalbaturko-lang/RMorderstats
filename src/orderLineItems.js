const toNumber = (value) => {
  const n = Number(String(value ?? 0).replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const productCode = (value) => String(value?.code || value?.product_code || value?.sku || '').trim();
const normalizeCurrency = (value) => String(value || '').trim().toUpperCase();
const normalizeLookupCode = (value) => String(value || '').trim();

const getOrderCurrency = (order) => normalizeCurrency(
  order?.currency
    || order?.raw_data?.currency_id
    || order?.raw_data?.currency?.code
    || order?.raw_data?.currency
    || 'CZK',
);

export const buildPurchasePriceLookup = (rows = []) => {
  const lookup = {};

  for (const row of rows || []) {
    const code = normalizeLookupCode(row?.product_code || row?.code || row?.sku);
    const currency = normalizeCurrency(row?.currency);
    const price = toNumber(row?.purchase_price_without_vat_native ?? row?.buy_price ?? row?.purchase_price);
    if (!code || !currency || !(price > 0)) continue;
    lookup[`${currency}:${code}`] = price;
  }

  return lookup;
};

export const attachPurchasePriceLookup = (orders = [], lookup = {}) => {
  if (!lookup || !Object.keys(lookup).length) return orders || [];

  return (orders || []).map((order) => {
    if (!order || typeof order !== 'object') return order;
    const next = { ...order };
    Object.defineProperty(next, '__purchasePriceLookup', {
      value: lookup,
      enumerable: false,
      configurable: true,
    });
    return next;
  });
};

const getPurchasePriceLookup = (order) => order?.__purchasePriceLookup || order?.purchase_price_lookup || null;

const getCatalogBuyPriceWithoutVat = (order, item, rawProduct) => {
  const lookup = getPurchasePriceLookup(order);
  if (!lookup) return 0;

  const currency = getOrderCurrency(order);
  const candidates = [
    item?.product_code,
    item?.sku,
    rawProduct?.product_code,
    rawProduct?.sku,
    rawProduct?.code,
  ]
    .map(normalizeLookupCode)
    .filter(Boolean);

  for (const code of candidates) {
    const price = toNumber(lookup[`${currency}:${code}`]);
    if (price > 0) return price;
  }

  return 0;
};

export const getRawBuyPriceWithoutVat = (product) => {
  const rawBuyPrice = toNumber(product?.buy_price || product?.purchase_price || product?.cost_without_vat);
  if (!(rawBuyPrice > 0)) return 0;

  const vatRate = toNumber(product?.vat ?? product?.vat_rate);
  return vatRate > 0 ? rawBuyPrice / (1 + vatRate / 100) : rawBuyPrice;
};

const findRawProductForLine = (order, item) => {
  const products = Array.isArray(order?.raw_data?.products) ? order.raw_data.products : [];
  if (!products.length) return null;

  const code = String(item?.product_code || item?.sku || '').trim();
  const ean = String(item?.ean || '').trim();

  return products.find((product) => {
    const rawCode = productCode(product);
    const rawEan = String(product?.ean || '').trim();
    return (code && rawCode === code) || (ean && rawEan === ean);
  }) || null;
};

const getOrderItemBuyPriceWithoutVat = (item, rawProduct) => {
  const snapshotBuyPrice = getRawBuyPriceWithoutVat(rawProduct);
  if (snapshotBuyPrice > 0) return snapshotBuyPrice;
  return toNumber(item?.buy_price);
};

const normalizeOrderItem = (item, order) => {
  const quantity = toNumber(item?.quantity) || 1;
  const unitPriceWithoutVat = toNumber(item?.unit_price_without_vat)
    || (toNumber(item?.total_price_without_vat) > 0 ? toNumber(item.total_price_without_vat) / quantity : 0);
  const lineRevenueWithoutVat = toNumber(item?.total_price_without_vat) || (unitPriceWithoutVat * quantity);
  const rawProduct = findRawProductForLine(order, item);
  const catalogBuyPriceWithoutVat = getCatalogBuyPriceWithoutVat(order, item, rawProduct);
  const rawBuyPriceWithoutVat = getRawBuyPriceWithoutVat(rawProduct);
  const fallbackBuyPriceWithoutVat = getOrderItemBuyPriceWithoutVat(item, rawProduct);

  return {
    code: item?.product_code || item?.sku || '',
    title: item?.product_name || item?.name || '',
    ean: item?.ean || null,
    quantity,
    price_without_vat: lineRevenueWithoutVat,
    price_per_unit_without_vat: unitPriceWithoutVat,
    buy_price: catalogBuyPriceWithoutVat || fallbackBuyPriceWithoutVat,
    catalog_buy_price_without_vat: catalogBuyPriceWithoutVat,
    order_items_buy_price: toNumber(item?.buy_price),
    raw_buy_price_without_vat: rawBuyPriceWithoutVat,
    raw_buy_vat_rate: rawProduct?.vat ?? rawProduct?.vat_rate ?? null,
    vat_rate: item?.vat_rate ?? rawProduct?.vat_rate ?? rawProduct?.vat ?? null,
    source: catalogBuyPriceWithoutVat > 0
      ? 'purchase_price_catalog'
      : (rawBuyPriceWithoutVat > 0 ? 'raw_products_snapshot' : 'order_items'),
  };
};

const normalizeRawItem = (item, order) => {
  const quantity = toNumber(item?.quantity) || 1;
  const unitPriceWithoutVat = toNumber(item?.price_per_unit_without_vat)
    || toNumber(item?.unit_price_without_vat)
    || (toNumber(item?.subtotal_without_vat) > 0 ? toNumber(item.subtotal_without_vat) / quantity : 0)
    || toNumber(item?.price_without_vat)
    || toNumber(item?.price);
  const lineRevenueWithoutVat = toNumber(item?.subtotal_without_vat)
    || toNumber(item?.price_without_vat)
    || toNumber(item?.subtotal)
    || (unitPriceWithoutVat * quantity);
  const catalogBuyPriceWithoutVat = getCatalogBuyPriceWithoutVat(order, item, item);
  const rawBuyPriceWithoutVat = getRawBuyPriceWithoutVat(item);

  return {
    code: item?.product_code || item?.code || item?.sku || '',
    title: item?.name || item?.title || '',
    ean: item?.ean || null,
    quantity,
    price_without_vat: lineRevenueWithoutVat,
    price_per_unit_without_vat: unitPriceWithoutVat,
    buy_price: catalogBuyPriceWithoutVat || rawBuyPriceWithoutVat,
    catalog_buy_price_without_vat: catalogBuyPriceWithoutVat,
    raw_buy_price_without_vat: rawBuyPriceWithoutVat,
    vat_rate: item?.vat_rate ?? null,
    source: catalogBuyPriceWithoutVat > 0 ? 'purchase_price_catalog' : 'raw_items',
  };
};

const normalizeRawProduct = (product, order) => {
  const quantity = toNumber(product?.quantity) || 1;
  const lineRevenueWithoutVat = toNumber(product?.price_without_vat);
  const unitPriceWithoutVat = toNumber(product?.price_per_unit_without_vat)
    || (lineRevenueWithoutVat > 0 ? lineRevenueWithoutVat / quantity : 0);
  const catalogBuyPriceWithoutVat = getCatalogBuyPriceWithoutVat(order, product, product);
  const rawBuyPriceWithoutVat = getRawBuyPriceWithoutVat(product);

  return {
    code: productCode(product),
    title: product?.title || product?.name || product?.product_name || '',
    ean: product?.ean || null,
    quantity,
    price_without_vat: lineRevenueWithoutVat,
    price_per_unit_without_vat: unitPriceWithoutVat,
    buy_price: catalogBuyPriceWithoutVat || rawBuyPriceWithoutVat,
    catalog_buy_price_without_vat: catalogBuyPriceWithoutVat,
    raw_buy_price_without_vat: rawBuyPriceWithoutVat,
    raw_buy_vat_rate: product?.vat ?? product?.vat_rate ?? null,
    vat_rate: product?.vat_rate ?? product?.vat ?? null,
    source: catalogBuyPriceWithoutVat > 0 ? 'purchase_price_catalog' : 'raw_products',
  };
};

export const getOrderLineItems = (order, options = {}) => {
  const allowRawFallback = options.allowRawFallback !== false;

  if (Array.isArray(order?.order_items) && order.order_items.length) {
    return order.order_items.map((item) => normalizeOrderItem(item, order));
  }

  if (!allowRawFallback) {
    return [];
  }

  if (Array.isArray(order?.raw_data?.items) && order.raw_data.items.length) {
    return order.raw_data.items.map((item) => normalizeRawItem(item, order));
  }

  if (Array.isArray(order?.raw_data?.products) && order.raw_data.products.length) {
    return order.raw_data.products.map((product) => normalizeRawProduct(product, order));
  }

  return [];
};

export const getLineQuantity = (line) => toNumber(line?.quantity) || 1;
export const getLineRevenueWithoutVat = (line) => toNumber(line?.price_without_vat);
export const getLineUnitPriceWithoutVat = (line) => toNumber(line?.price_per_unit_without_vat);
export const getLineBuyPriceWithoutVat = (line) => toNumber(line?.buy_price);
