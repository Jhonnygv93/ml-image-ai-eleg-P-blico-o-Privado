// Sincroniza una cuenta REAL de MercadoLibre: trae publicaciones, visitas,
// ventas, stock y reputación desde la API y las escribe en las mismas tablas
// que usa el modo demo (db/seed.js). No calcula ningún indicador — analytics/
// rules/scoring/pdf son exactamente el mismo código para datos demo o reales.
//
// Limitaciones conocidas (API pública de MercadoLibre):
// - No expone el costo del producto -> base_cost queda null (el score de
//   publicidad/ROAS por margen requiere que el seller lo cargue a mano).
// - No expone histórico de stock -> solo se guarda el stock de "hoy"; el
//   histórico se va construyendo con syncs sucesivos.
// - No expone devoluciones por causa (mismatch/talla/calidad) -> quedan en 0.

import { db } from "../db/db.js";
import { getMe, listItemIds, getItem, getItemVisitsTimeWindow, searchOrders, getSellerReputation, searchClaims } from "../ml/client.js";
import { refreshAccessToken } from "../ml/oauth.js";

const MAX_ITEMS = 200; // cota razonable para no colgar el sync en catálogos enormes
const HISTORY_DAYS = 90;
const MAX_ORDERS = 1000; // cota de seguridad al paginar órdenes
const MAX_CLAIMS = 300; // cota de seguridad al paginar reclamos
// Los reclamos en MercadoLibre suelen resolverse (y cerrarse) semanas o meses
// después de la compra, así que muchos reclamos "cerrados" apuntan a órdenes
// muy anteriores a la ventana de 90 días que usamos para ventas/KPIs. Para
// correlacionarlos con su publicación usamos una ventana de órdenes mucho más
// amplia, pero SOLO para este propósito (no toca la tabla `sales` ni los
// KPIs de 30/90 días, que siguen midiéndose igual que siempre).
const CLAIMS_LOOKBACK_DAYS = 730;
const MAX_CLAIMS_ORDERS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reintenta una llamada a la API hasta `retries` veces con backoff simple (útil para 429/timeouts transitorios). */
async function withRetry(fn, { retries = 2, delayMs = 400 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastErr;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const upsertSellerBasic = db.prepare(`
  INSERT INTO sellers (seller_id, nickname, site_id, reputation_tier, is_demo, access_token, refresh_token, token_expires_at, last_synced_at)
  VALUES (@seller_id, @nickname, @site_id, @reputation_tier, 0, @access_token, @refresh_token, @token_expires_at, @last_synced_at)
  ON CONFLICT(seller_id) DO UPDATE SET
    nickname = excluded.nickname,
    site_id = excluded.site_id,
    reputation_tier = COALESCE(excluded.reputation_tier, sellers.reputation_tier),
    access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    token_expires_at = excluded.token_expires_at,
    last_synced_at = excluded.last_synced_at
`);

const upsertItem = db.prepare(`
  INSERT INTO items (item_id, seller_id, title, category, price, base_cost, status, has_full, free_shipping, photos_count, catalog, permalink, variations_count)
  VALUES (@item_id, @seller_id, @title, @category, @price, @base_cost, @status, @has_full, @free_shipping, @photos_count, @catalog, @permalink, @variations_count)
  ON CONFLICT(item_id) DO UPDATE SET
    title = excluded.title,
    category = excluded.category,
    price = excluded.price,
    status = excluded.status,
    has_full = excluded.has_full,
    free_shipping = excluded.free_shipping,
    photos_count = excluded.photos_count,
    catalog = excluded.catalog,
    permalink = excluded.permalink,
    variations_count = excluded.variations_count
`);

const deleteVisits = db.prepare(`DELETE FROM visits WHERE item_id = ?`);
const insertVisit = db.prepare(`INSERT INTO visits (item_id, date, visits) VALUES (?, ?, ?)`);

const deleteInventoryToday = db.prepare(`DELETE FROM inventory WHERE item_id = ? AND date = ?`);
const insertInventory = db.prepare(`INSERT INTO inventory (item_id, date, stock) VALUES (?, ?, ?)`);

const deleteSalesForItem = db.prepare(`DELETE FROM sales WHERE item_id = ?`);
const insertSale = db.prepare(`INSERT INTO sales (item_id, date, units, revenue, orders) VALUES (?, ?, ?, ?, ?)`);

const deleteItemClaims = db.prepare(`DELETE FROM item_claims WHERE item_id = ?`);
const insertItemClaims = db.prepare(
  `INSERT INTO item_claims (item_id, claims_count, updated_at) VALUES (?, ?, datetime('now'))`
);

const deleteReputationToday = db.prepare(`DELETE FROM reputation WHERE seller_id = ? AND date = ?`);
const insertReputation = db.prepare(`
  INSERT INTO reputation (
    seller_id, date, claims, cancellations, delays, returns, return_reason_mismatch, return_reason_size, return_reason_quality,
    reputation_score, claims_rate, cancellations_rate, delays_rate,
    transactions_total, transactions_completed, transactions_canceled,
    ratings_positive_pct, ratings_negative_pct, ratings_neutral_pct, sales_completed_60d
  )
  VALUES (
    @seller_id, @date, @claims, @cancellations, @delays, @returns, @return_reason_mismatch, @return_reason_size, @return_reason_quality,
    @reputation_score, @claims_rate, @cancellations_rate, @delays_rate,
    @transactions_total, @transactions_completed, @transactions_canceled,
    @ratings_positive_pct, @ratings_negative_pct, @ratings_neutral_pct, @sales_completed_60d
  )
`);

function mapHasFull(item) {
  return item.shipping && item.shipping.logistic_type === "fulfillment" ? 1 : 0;
}

/** Refresca el access_token si ya venció (dura ~6hs), guardando el nuevo par en `sellers`. */
async function ensureFreshToken(seller) {
  const expiresAt = seller.token_expires_at ? new Date(seller.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60_000) return seller; // todavía válido, con 1 min de margen

  const refreshed = await refreshAccessToken(seller.refresh_token);
  const tokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  const updated = {
    seller_id: seller.seller_id,
    nickname: seller.nickname,
    site_id: seller.site_id,
    reputation_tier: seller.reputation_tier,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || seller.refresh_token,
    token_expires_at: tokenExpiresAt,
    last_synced_at: seller.last_synced_at,
  };
  upsertSellerBasic.run(updated);
  return { ...seller, ...updated };
}

async function syncItemVisits(itemId, accessToken) {
  try {
    const data = await withRetry(() => getItemVisitsTimeWindow(itemId, accessToken, { last: HISTORY_DAYS, unit: "day" }));
    const results = Array.isArray(data.results) ? data.results : [];
    deleteVisits.run(itemId);
    for (const r of results) {
      const date = String(r.date).slice(0, 10); // la API devuelve fecha+hora ISO
      insertVisit.run(itemId, date, r.total || 0);
    }
  } catch (err) {
    console.warn(`sync: no se pudieron traer visitas de ${itemId}: ${err.message}`);
  }
}

async function syncSellerReputation(sellerId, accessToken) {
  try {
    const user = await getSellerReputation(sellerId, accessToken);
    const rep = user.seller_reputation || {};
    const metrics = rep.metrics || {};
    const claims = metrics.claims ? Math.round(metrics.claims.value || 0) : 0;
    const cancellations = metrics.cancellations ? Math.round(metrics.cancellations.value || 0) : 0;
    const delays = metrics.delayed_handling_time ? Math.round(metrics.delayed_handling_time.value || 0) : 0;

    // MercadoLibre ya calcula estas tasas sobre su propia ventana de medición
    // (hasta 365 días, con su propia metodología) — usamos ese % directamente
    // en vez de recalcularlo nosotros con datos incompletos.
    const toPct = (m) => (m && typeof m.rate === "number" ? Number((m.rate * 100).toFixed(2)) : null);
    const claimsRate = toPct(metrics.claims);
    const cancellationsRate = toPct(metrics.cancellations);
    const delaysRate = toPct(metrics.delayed_handling_time);

    // La API pública no desglosa devoluciones por causa (mismatch/talla/calidad):
    // ese dato vive en el panel interno del seller, no en este endpoint.
    const levelScores = { 5: 98, 4: 90, 3: 78, 2: 60, 1: 40 };
    const levelNumber = Number(String(rep.level_id || "").match(/\d/)?.[0]);
    const reputationScore = levelScores[levelNumber] ?? null;

    // Histórico de transacciones y calificación de compradores (seller_reputation.transactions),
    // y ventas medidas en la ventana de 60 días que usa MercadoLibre (metrics.sales).
    const tx = rep.transactions || {};
    const ratings = tx.ratings || {};
    const pct = (v) => (typeof v === "number" ? Number((v * 100).toFixed(1)) : null);

    const date = todayStr();
    deleteReputationToday.run(sellerId, date);
    insertReputation.run({
      seller_id: sellerId,
      date,
      claims,
      cancellations,
      delays,
      returns: 0,
      return_reason_mismatch: 0,
      return_reason_size: 0,
      return_reason_quality: 0,
      reputation_score: reputationScore,
      claims_rate: claimsRate,
      cancellations_rate: cancellationsRate,
      delays_rate: delaysRate,
      transactions_total: tx.total ?? null,
      transactions_completed: tx.completed ?? null,
      transactions_canceled: tx.canceled ?? null,
      ratings_positive_pct: pct(ratings.positive),
      ratings_negative_pct: pct(ratings.negative),
      ratings_neutral_pct: pct(ratings.neutral),
      sales_completed_60d: metrics.sales ? metrics.sales.completed ?? null : null,
    });
    return rep.power_seller_status || null;
  } catch (err) {
    console.warn(`sync: no se pudo traer reputación de ${sellerId}: ${err.message}`);
    return null;
  }
}

/** Sincroniza ventas por publicación y devuelve el mapa orden -> Set(item_id) para correlacionar reclamos. */
async function syncSales(sellerId, itemIds, accessToken) {
  const itemIdSet = new Set(itemIds);
  const dateFrom = `${dateStr(HISTORY_DAYS - 1)}T00:00:00.000-00:00`;
  const dateTo = `${todayStr()}T23:59:59.999-00:00`;

  const perItemPerDate = new Map(); // item_id -> date -> { units, revenue, orders: Set }
  const orderItemMap = new Map(); // order_id (string) -> Set(item_id)

  let offset = 0;
  const limit = 50;
  let total = Infinity;
  try {
    while (offset < total && offset < MAX_ORDERS) {
      const page = await searchOrders(sellerId, accessToken, { dateFrom, dateTo, offset, limit });
      total = page.paging ? page.paging.total : 0;
      const results = Array.isArray(page.results) ? page.results : [];
      for (const order of results) {
        if (order.status === "cancelled") continue;
        const date = String(order.date_created).slice(0, 10);
        for (const oi of order.order_items || []) {
          const itemId = oi.item && oi.item.id;
          if (!itemId || !itemIdSet.has(itemId)) continue;
          if (!perItemPerDate.has(itemId)) perItemPerDate.set(itemId, new Map());
          const perDate = perItemPerDate.get(itemId);
          if (!perDate.has(date)) perDate.set(date, { units: 0, revenue: 0, orders: new Set() });
          const bucket = perDate.get(date);
          bucket.units += oi.quantity || 0;
          bucket.revenue += (oi.quantity || 0) * (oi.unit_price || 0);
          bucket.orders.add(order.id);

          const orderKey = String(order.id);
          if (!orderItemMap.has(orderKey)) orderItemMap.set(orderKey, new Set());
          orderItemMap.get(orderKey).add(itemId);
        }
      }
      offset += limit;
      if (results.length === 0) break;
    }
  } catch (err) {
    console.warn(`sync: no se pudieron traer órdenes de ${sellerId}: ${err.message}`);
  }

  for (const itemId of itemIds) {
    deleteSalesForItem.run(itemId);
    const perDate = perItemPerDate.get(itemId);
    if (!perDate) continue;
    for (const [date, bucket] of perDate) {
      insertSale.run(itemId, date, bucket.units, Number(bucket.revenue.toFixed(2)), bucket.orders.size);
    }
  }

  return orderItemMap;
}

/**
 * Igual que el mapa orden->publicaciones que arma syncSales, pero con una
 * ventana mucho más amplia (ver CLAIMS_LOOKBACK_DAYS) para poder correlacionar
 * reclamos ya cerrados con órdenes antiguas. No toca `sales` ni ninguna otra
 * tabla — solo se usa en memoria para syncClaimsByItem.
 */
async function buildOrderItemMapForClaims(sellerId, itemIds, accessToken) {
  const itemIdSet = new Set(itemIds);
  const dateFrom = `${dateStr(CLAIMS_LOOKBACK_DAYS - 1)}T00:00:00.000-00:00`;
  const dateTo = `${todayStr()}T23:59:59.999-00:00`;
  const orderItemMap = new Map();

  let offset = 0;
  const limit = 50;
  let total = Infinity;
  try {
    while (offset < total && offset < MAX_CLAIMS_ORDERS) {
      const page = await searchOrders(sellerId, accessToken, { dateFrom, dateTo, offset, limit });
      total = page.paging ? page.paging.total : 0;
      const results = Array.isArray(page.results) ? page.results : [];
      for (const order of results) {
        const orderKey = String(order.id);
        for (const oi of order.order_items || []) {
          const itemId = oi.item && oi.item.id;
          if (!itemId || !itemIdSet.has(itemId)) continue;
          if (!orderItemMap.has(orderKey)) orderItemMap.set(orderKey, new Set());
          orderItemMap.get(orderKey).add(itemId);
        }
      }
      offset += limit;
      if (results.length === 0) break;
    }
  } catch (err) {
    console.warn(`sync: no se pudieron traer órdenes históricas de ${sellerId} para correlacionar reclamos: ${err.message}`);
  }
  return orderItemMap;
}

/**
 * Trae los reclamos de la cuenta (API de post-venta) y los correlaciona con
 * publicaciones a través de `orderItemMap` (orden -> publicaciones de esa
 * orden, armado en syncSales). Es un fallo blando: si la API de reclamos no
 * está habilitada para esta app o cambia de forma, simplemente no se
 * completa `item_claims` y la sección de "Productos con más problemas" no
 * se muestra — no rompe el resto del sync.
 */
async function syncClaimsByItem(sellerId, itemIds, accessToken, orderItemMap) {
  const claimsByItem = new Map();
  const seenClaimIds = new Set();
  const limit = 50;
  let claimsSeen = 0;
  let claimsMatched = 0;
  const perStatus = {};

  try {
    for (const status of ["opened", "closed"]) {
      let offset = 0;
      let total = Infinity;
      let statusSeen = 0;
      while (offset < total && offset < MAX_CLAIMS) {
        const page = await searchClaims(accessToken, sellerId, { limit, offset, status });
        const results = Array.isArray(page.data) ? page.data : Array.isArray(page.results) ? page.results : [];
        total = page.paging ? page.paging.total : results.length + offset;
        for (const claim of results) {
          const claimId = String(claim.id ?? claim.claim_id ?? "");
          if (claimId && seenClaimIds.has(claimId)) continue;
          if (claimId) seenClaimIds.add(claimId);
          claimsSeen += 1;
          statusSeen += 1;
          const orderKey = String(claim.resource_id ?? claim.order_id ?? "");
          const items = orderItemMap.get(orderKey);
          if (!items) continue;
          claimsMatched += 1;
          for (const itemId of items) {
            claimsByItem.set(itemId, (claimsByItem.get(itemId) || 0) + 1);
          }
        }
        offset += limit;
        if (results.length === 0) break;
      }
      perStatus[status] = statusSeen;
    }
  } catch (err) {
    console.warn(`sync: no se pudieron traer reclamos de ${sellerId} (¿permiso no habilitado?): ${err.message}`);
    return;
  }

  for (const itemId of itemIds) {
    deleteItemClaims.run(itemId);
    const count = claimsByItem.get(itemId);
    if (count) insertItemClaims.run(itemId, count);
  }
  console.log(
    `sync: reclamos de ${sellerId} — ${claimsSeen} recibidos de la API (${perStatus.opened || 0} abiertos, ${perStatus.closed || 0} cerrados), ${claimsMatched} correlacionados con órdenes de los últimos ${CLAIMS_LOOKBACK_DAYS} días, ${claimsByItem.size} publicaciones afectadas.`
  );
}

/**
 * Sincroniza una cuenta ya conectada (con access_token/refresh_token
 * guardados en `sellers`, ver routes/seller.js#oauth/callback) trayendo sus
 * publicaciones, visitas, ventas, stock y reputación reales.
 */
export async function syncSeller(sellerId) {
  let seller = db.prepare(`SELECT * FROM sellers WHERE seller_id = ?`).get(sellerId);
  if (!seller || !seller.access_token) {
    throw new Error(`Seller ${sellerId} no tiene una cuenta de MercadoLibre conectada.`);
  }
  seller = await ensureFreshToken(seller);
  const accessToken = seller.access_token;

  const me = await getMe(accessToken);
  upsertSellerBasic.run({
    seller_id: sellerId,
    nickname: me.nickname || seller.nickname,
    site_id: me.site_id || seller.site_id,
    reputation_tier: null,
    access_token: seller.access_token,
    refresh_token: seller.refresh_token,
    token_expires_at: seller.token_expires_at,
    last_synced_at: new Date().toISOString(),
  });

  const itemIds = [];
  let offset = 0;
  const limit = 50;
  let total = Infinity;
  while (offset < total && itemIds.length < MAX_ITEMS) {
    const page = await listItemIds(sellerId, accessToken, { limit, offset });
    total = page.paging ? page.paging.total : 0;
    const pageIds = Array.isArray(page.results) ? page.results : [];
    itemIds.push(...pageIds);
    offset += limit;
    if (pageIds.length === 0) break;
  }

  const syncedItemIds = [];
  for (const itemId of itemIds.slice(0, MAX_ITEMS)) {
    try {
      const item = await withRetry(() => getItem(itemId, accessToken));
      upsertItem.run({
        item_id: item.id,
        seller_id: sellerId,
        title: item.title,
        category: item.category_id || null,
        price: item.price,
        base_cost: null, // no disponible vía API pública; el seller puede cargarlo a futuro
        status: item.status || "active",
        has_full: mapHasFull(item),
        free_shipping: item.shipping && item.shipping.free_shipping ? 1 : 0,
        photos_count: Array.isArray(item.pictures) ? item.pictures.length : 0,
        catalog: item.catalog_listing ? 1 : 0,
        permalink: item.permalink || null,
        variations_count: Array.isArray(item.variations) ? item.variations.length : 0,
      });

      const today = todayStr();
      deleteInventoryToday.run(item.id, today);
      insertInventory.run(item.id, today, item.available_quantity ?? 0);

      await syncItemVisits(item.id, accessToken);
      syncedItemIds.push(item.id);
    } catch (err) {
      console.warn(`sync: error sincronizando publicación ${itemId}: ${err.message}`);
    }
    await sleep(80); // evita ráfagas que disparen el rate limit de la API de MercadoLibre
  }

  await syncSales(sellerId, syncedItemIds, accessToken);
  const claimsOrderItemMap = await buildOrderItemMapForClaims(sellerId, syncedItemIds, accessToken);
  await syncClaimsByItem(sellerId, syncedItemIds, accessToken, claimsOrderItemMap);
  const powerSellerStatus = await syncSellerReputation(sellerId, accessToken);
  if (powerSellerStatus) {
    db.prepare(`UPDATE sellers SET reputation_tier = ? WHERE seller_id = ?`).run(powerSellerStatus, sellerId);
  }

  db.prepare(`UPDATE sellers SET last_synced_at = ? WHERE seller_id = ?`).run(new Date().toISOString(), sellerId);

  return { sellerId, itemsSynced: syncedItemIds.length };
}

/** Guarda el par de tokens recién obtenido por OAuth y crea/actualiza el seller. Uso interno del callback. */
export function saveSellerToken(sellerId, { nickname, siteId, accessToken, refreshToken, expiresIn }) {
  upsertSellerBasic.run({
    seller_id: sellerId,
    nickname: nickname || sellerId,
    site_id: siteId || "MLC",
    reputation_tier: null,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    last_synced_at: null,
  });
}
