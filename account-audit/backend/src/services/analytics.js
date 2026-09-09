// Motor de analítica: todos los cálculos numéricos viven acá, en código
// determinístico y testeable. La capa de IA (services/ai.js) solo interpreta
// estos números, nunca los calcula — así el diagnóstico es confiable.

import { db } from "../db/db.js";

export const WINDOWS = [7, 15, 30, 60, 90];

function daysAgoStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** [from, to] inclusivo, ventana de `days` días terminando hoy. */
function windowRange(days) {
  return [daysAgoStr(days - 1), daysAgoStr(0)];
}

/** Ventana previa de igual tamaño, inmediatamente anterior a `windowRange(days)`. */
function previousWindowRange(days) {
  return [daysAgoStr(days * 2 - 1), daysAgoStr(days)];
}

const pctChange = (curr, prev) => {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return Number((((curr - prev) / prev) * 100).toFixed(1));
};

function itemIdsForSeller(sellerId) {
  return db
    .prepare(`SELECT item_id FROM items WHERE seller_id = ? AND status = 'active'`)
    .all(sellerId)
    .map((r) => r.item_id);
}

function sumSales(itemIds, from, to) {
  if (itemIds.length === 0) return { units: 0, revenue: 0, orders: 0 };
  const placeholders = itemIds.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(units),0) units, COALESCE(SUM(revenue),0) revenue, COALESCE(SUM(orders),0) orders
       FROM sales WHERE item_id IN (${placeholders}) AND date BETWEEN ? AND ?`
    )
    .get(...itemIds, from, to);
  return row;
}

function sumVisits(itemIds, from, to) {
  if (itemIds.length === 0) return 0;
  const placeholders = itemIds.map(() => "?").join(",");
  const row = db
    .prepare(`SELECT COALESCE(SUM(visits),0) visits FROM visits WHERE item_id IN (${placeholders}) AND date BETWEEN ? AND ?`)
    .get(...itemIds, from, to);
  return row.visits;
}

function conversion(units, visits) {
  return visits > 0 ? Number(((units / visits) * 100).toFixed(2)) : 0;
}

/** KPIs de cuenta para una ventana de N días, comparados con la ventana previa equivalente. */
export function accountKpis(sellerId, days = 30) {
  const itemIds = itemIdsForSeller(sellerId);
  const [from, to] = windowRange(days);
  const [prevFrom, prevTo] = previousWindowRange(days);

  const curr = sumSales(itemIds, from, to);
  const prev = sumSales(itemIds, prevFrom, prevTo);
  const currVisits = sumVisits(itemIds, from, to);
  const prevVisits = sumVisits(itemIds, prevFrom, prevTo);

  const currConv = conversion(curr.units, currVisits);
  const prevConv = conversion(prev.units, prevVisits);
  const avgTicket = curr.orders > 0 ? Number((curr.revenue / curr.orders).toFixed(0)) : 0;
  const prevAvgTicket = prev.orders > 0 ? Number((prev.revenue / prev.orders).toFixed(0)) : 0;

  return {
    windowDays: days,
    revenue: curr.revenue,
    revenueChangePct: pctChange(curr.revenue, prev.revenue),
    units: curr.units,
    unitsChangePct: pctChange(curr.units, prev.units),
    orders: curr.orders,
    ordersChangePct: pctChange(curr.orders, prev.orders),
    visits: currVisits,
    visitsChangePct: pctChange(currVisits, prevVisits),
    conversion: currConv,
    conversionChangePct: pctChange(currConv, prevConv),
    avgTicket,
    avgTicketChangePct: pctChange(avgTicket, prevAvgTicket),
  };
}

/** KPIs de cuenta para todas las ventanas estándar (7/15/30/60/90). */
export function accountKpisAllWindows(sellerId) {
  return Object.fromEntries(WINDOWS.map((d) => [d, accountKpis(sellerId, d)]));
}

/** Métricas por publicación en una ventana, con comparación a la ventana previa. */
export function itemMetrics(itemId, days = 30) {
  const [from, to] = windowRange(days);
  const [prevFrom, prevTo] = previousWindowRange(days);

  const curr = sumSales([itemId], from, to);
  const prev = sumSales([itemId], prevFrom, prevTo);
  const currVisits = sumVisits([itemId], from, to);
  const prevVisits = sumVisits([itemId], prevFrom, prevTo);
  const currConv = conversion(curr.units, currVisits);
  const prevConv = conversion(prev.units, prevVisits);

  return {
    itemId,
    windowDays: days,
    revenue: curr.revenue,
    revenueChangePct: pctChange(curr.revenue, prev.revenue),
    units: curr.units,
    visits: currVisits,
    visitsChangePct: pctChange(currVisits, prevVisits),
    conversion: currConv,
    conversionChangePct: pctChange(currConv, prevConv),
  };
}

/** Qué % de la facturación de la cuenta concentra cada publicación (ventana de `days`). */
export function revenueConcentration(sellerId, days = 30) {
  const itemIds = itemIdsForSeller(sellerId);
  const [from, to] = windowRange(days);
  const totalRevenue = sumSales(itemIds, from, to).revenue;

  const rows = itemIds.map((itemId) => {
    const { revenue, units } = sumSales([itemId], from, to);
    return { itemId, revenue, units, sharePct: totalRevenue > 0 ? Number(((revenue / totalRevenue) * 100).toFixed(1)) : 0 };
  });
  rows.sort((a, b) => b.revenue - a.revenue);
  return { totalRevenue, items: rows };
}

/** Cobertura de stock: stock actual / velocidad de venta diaria (promedio últimos 14 días). */
export function stockCoverage(itemId) {
  const stockRow = db.prepare(`SELECT stock FROM inventory WHERE item_id = ? ORDER BY date DESC LIMIT 1`).get(itemId);
  const stock = stockRow ? stockRow.stock : 0;

  const [from, to] = windowRange(14);
  const { units } = sumSales([itemId], from, to);
  const dailyVelocity = Number((units / 14).toFixed(2));
  const daysOfCoverage = dailyVelocity > 0 ? Number((stock / dailyVelocity).toFixed(1)) : stock > 0 ? Infinity : 0;

  return { itemId, stock, dailyVelocity, daysOfCoverage };
}

/** Métricas de Mercado Ads por publicación en una ventana, cruzadas con margen si hay base_cost. */
export function adsMetrics(itemId, days = 30) {
  const [from, to] = windowRange(days);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(investment),0) investment, COALESCE(SUM(impressions),0) impressions,
              COALESCE(SUM(clicks),0) clicks, COALESCE(SUM(ad_sales),0) ad_sales, COALESCE(SUM(ad_units),0) ad_units
       FROM ads WHERE item_id = ? AND date BETWEEN ? AND ?`
    )
    .get(itemId, from, to);

  const item = db.prepare(`SELECT price, base_cost FROM items WHERE item_id = ?`).get(itemId);

  const roas = row.investment > 0 ? Number((row.ad_sales / row.investment).toFixed(2)) : null;
  const acos = row.ad_sales > 0 ? Number(((row.investment / row.ad_sales) * 100).toFixed(1)) : null;
  const ctr = row.impressions > 0 ? Number(((row.clicks / row.impressions) * 100).toFixed(2)) : 0;
  const cpc = row.clicks > 0 ? Number((row.investment / row.clicks).toFixed(0)) : 0;
  const convFromAds = row.clicks > 0 ? Number(((row.ad_units / row.clicks) * 100).toFixed(2)) : 0;

  let marginBeforeAds = null;
  let maxAcos = null;
  let minRoas = null;
  if (item && item.base_cost != null) {
    // Comisión ML aproximada 13% + costo logístico estimado 6% del precio (ajustable en el futuro
    // desde la configuración del seller). El objetivo es mostrar el concepto, no ser exacto al peso.
    const mlFee = item.price * 0.13;
    const logisticsCost = item.price * 0.06;
    marginBeforeAds = Number((item.price - item.base_cost - mlFee - logisticsCost).toFixed(0));
    maxAcos = item.price > 0 ? Number(((marginBeforeAds / item.price) * 100).toFixed(1)) : null;
    minRoas = maxAcos > 0 ? Number((100 / maxAcos).toFixed(2)) : null;
  }

  return {
    itemId,
    windowDays: days,
    investment: row.investment,
    impressions: row.impressions,
    clicks: row.clicks,
    adSales: row.ad_sales,
    adUnits: row.ad_units,
    roas,
    acos,
    ctr,
    cpc,
    conversion: convFromAds,
    marginBeforeAds,
    maxAcos,
    minRoas,
    profitable: roas != null && minRoas != null ? roas >= minRoas : null,
  };
}

/** Reputación de cuenta: reclamos, cancelaciones, demoras, devoluciones y sus causas principales. */
export function reputationMetrics(sellerId, days = 30) {
  const [from, to] = windowRange(days);
  const [prevFrom, prevTo] = previousWindowRange(days);

  const agg = (f, t) =>
    db
      .prepare(
        `SELECT COALESCE(SUM(claims),0) claims, COALESCE(SUM(cancellations),0) cancellations,
                COALESCE(SUM(delays),0) delays, COALESCE(SUM(returns),0) returns,
                COALESCE(SUM(return_reason_mismatch),0) mismatch, COALESCE(SUM(return_reason_size),0) size,
                COALESCE(SUM(return_reason_quality),0) quality, AVG(reputation_score) score
         FROM reputation WHERE seller_id = ? AND date BETWEEN ? AND ?`
      )
      .get(sellerId, f, t);

  const curr = agg(from, to);
  const prev = agg(prevFrom, prevTo);
  const totalReturns = curr.returns || 1;

  return {
    windowDays: days,
    claims: curr.claims,
    claimsChangePct: pctChange(curr.claims, prev.claims),
    cancellations: curr.cancellations,
    cancellationsChangePct: pctChange(curr.cancellations, prev.cancellations),
    delays: curr.delays,
    delaysChangePct: pctChange(curr.delays, prev.delays),
    returns: curr.returns,
    returnsChangePct: pctChange(curr.returns, prev.returns),
    reputationScore: curr.score ? Math.round(curr.score) : null,
    returnReasons: {
      mismatchPct: Number(((curr.mismatch / totalReturns) * 100).toFixed(1)),
      sizePct: Number(((curr.size / totalReturns) * 100).toFixed(1)),
      qualityPct: Number(((curr.quality / totalReturns) * 100).toFixed(1)),
    },
  };
}

/**
 * Reputación con tasas sobre el volumen de ventas (como el panel de MercadoLibre) y un
 * "tier" de color (verde/amarillo/rojo) según el reputationScore calculado.
 */
export function reputationDetail(sellerId, days = 30) {
  const base = reputationMetrics(sellerId, days);
  const { orders, revenue } = accountKpis(sellerId, days);
  const rate = (n) => (orders > 0 ? Number(((n / orders) * 100).toFixed(2)) : 0);
  const salesWithoutClaims = Math.max(0, orders - base.claims);
  const score = base.reputationScore;
  const tier = score == null ? "sin-datos" : score >= 90 ? "verde" : score >= 60 ? "amarillo" : "rojo";

  // Si sincronizamos una cuenta real, MercadoLibre ya nos da el % calculado con su propia
  // metodología (ventana de hasta 365 días) — lo usamos tal cual en vez de recalcularlo
  // nosotros con la ventana corta de `days`, que da porcentajes irreales con pocas ventas.
  const latestRates = db
    .prepare(
      `SELECT claims_rate, cancellations_rate, delays_rate,
              transactions_total, transactions_completed, transactions_canceled,
              ratings_positive_pct, ratings_negative_pct, ratings_neutral_pct, sales_completed_60d
       FROM reputation WHERE seller_id = ? ORDER BY date DESC LIMIT 1`
    )
    .get(sellerId);

  return {
    ...base,
    orders,
    revenue,
    salesWithoutClaims,
    claimsRate: latestRates?.claims_rate ?? rate(base.claims),
    cancellationRate: latestRates?.cancellations_rate ?? rate(base.cancellations),
    delayRate: latestRates?.delays_rate ?? rate(base.delays),
    transactionsTotal: latestRates?.transactions_total ?? null,
    transactionsCompleted: latestRates?.transactions_completed ?? null,
    transactionsCanceled: latestRates?.transactions_canceled ?? null,
    ratingsPositivePct: latestRates?.ratings_positive_pct ?? null,
    ratingsNegativePct: latestRates?.ratings_negative_pct ?? null,
    ratingsNeutralPct: latestRates?.ratings_neutral_pct ?? null,
    salesCompleted60d: latestRates?.sales_completed_60d ?? null,
    tier,
  };
}

/** Comparación simple contra el top competidor conocido para una publicación. */
export function competitiveIndex(itemId) {
  const item = db.prepare(`SELECT price, has_full, free_shipping FROM items WHERE item_id = ?`).get(itemId);
  const comp = db.prepare(`SELECT * FROM competitors WHERE item_id = ? ORDER BY captured_at DESC LIMIT 1`).get(itemId);
  if (!item || !comp) return null;

  const priceGapPct = Number((((comp.competitor_price - item.price) / comp.competitor_price) * 100).toFixed(1));
  const priceScore = Math.max(0, Math.min(100, 100 + priceGapPct * 2));
  const fullScore = item.has_full === comp.has_full ? 100 : item.has_full ? 100 : 60;
  const shippingScore = item.free_shipping === comp.free_shipping ? 100 : item.free_shipping ? 100 : 60;
  const overall = Math.round(priceScore * 0.5 + fullScore * 0.25 + shippingScore * 0.25);

  return {
    itemId,
    yourPrice: item.price,
    competitorPrice: comp.competitor_price,
    priceGapPct,
    overallIndex: overall,
    gaps: {
      precio: Math.round(priceScore - 100),
      logistica: Math.round(fullScore - 100),
      envio: Math.round(shippingScore - 100),
    },
  };
}

export function listSellerItems(sellerId) {
  return db.prepare(`SELECT * FROM items WHERE seller_id = ?`).all(sellerId);
}

/**
 * Clasifica las publicaciones activas en 3 tipos:
 * - "Catálogo": item.catalog = 1 (compite en el buybox de un catalog_product de MercadoLibre).
 * - "Producto de usuario": el item_id empieza con "<SITE>U" (ej. MLCU...) — el formato de
 *   publicación multi-variación más nuevo de MercadoLibre ("user product").
 * - "Tradicional": el resto (item_id clásico "<SITE>...", sin catálogo).
 */
export function classifyListing(item, siteId) {
  const userProductPrefix = `${siteId || "MLC"}U`;
  if (item.catalog) return "catalogo";
  if (item.item_id.startsWith(userProductPrefix)) return "producto_usuario";
  return "tradicional";
}

export function listingTypeBreakdown(sellerId) {
  const seller = db.prepare(`SELECT site_id FROM sellers WHERE seller_id = ?`).get(sellerId);
  const siteId = seller?.site_id || "MLC";
  const items = db.prepare(`SELECT item_id, catalog FROM items WHERE seller_id = ? AND status = 'active'`).all(sellerId);

  let catalogCount = 0;
  let userProductCount = 0;
  let traditionalCount = 0;
  for (const it of items) {
    const type = classifyListing(it, siteId);
    if (type === "catalogo") catalogCount += 1;
    else if (type === "producto_usuario") userProductCount += 1;
    else traditionalCount += 1;
  }

  const total = items.length;
  const pct = (n) => (total > 0 ? Number(((n / total) * 100).toFixed(1)) : 0);
  return {
    catalogCount,
    traditionalCount,
    userProductCount,
    total,
    catalogPct: pct(catalogCount),
    traditionalPct: pct(traditionalCount),
    userProductPct: pct(userProductCount),
  };
}

export function getSeller(sellerId) {
  return db.prepare(`SELECT * FROM sellers WHERE seller_id = ?`).get(sellerId);
}

export function listSellers() {
  return db.prepare(`SELECT * FROM sellers ORDER BY nickname`).all();
}
