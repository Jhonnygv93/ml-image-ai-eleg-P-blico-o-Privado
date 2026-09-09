// Cliente de datos de la API pública de MercadoLibre.
// Requiere un access_token válido (ver oauth.js). No se usa aún en esta
// sesión porque no hay credenciales reales configuradas; queda listo para
// que services/sync.js lo llame y reemplace/complemente los datos demo.
//
// Referencia: https://developers.mercadolibre.com/es_ar/api-docs-es

const API = "https://api.mercadolibre.com";

async function mlFetch(pathAndQuery, accessToken) {
  const res = await fetch(`${API}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`ML API ${pathAndQuery} -> ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getMe(accessToken) {
  return mlFetch("/users/me", accessToken);
}

export async function listItemIds(sellerId, accessToken, { limit = 50, offset = 0 } = {}) {
  return mlFetch(`/users/${sellerId}/items/search?limit=${limit}&offset=${offset}`, accessToken);
}

export async function getItem(itemId, accessToken) {
  return mlFetch(`/items/${itemId}`, accessToken);
}

export async function getItemVisitsTimeWindow(itemId, accessToken, { last = 90, unit = "day" } = {}) {
  return mlFetch(`/items/${itemId}/visits/time_window?last=${last}&unit=${unit}`, accessToken);
}

export async function searchOrders(sellerId, accessToken, { dateFrom, dateTo, offset = 0, limit = 50 } = {}) {
  const params = new URLSearchParams({
    seller: sellerId,
    "order.date_created.from": dateFrom,
    "order.date_created.to": dateTo,
    offset: String(offset),
    limit: String(limit),
  });
  return mlFetch(`/orders/search?${params.toString()}`, accessToken);
}

export async function getSellerReputation(sellerId, accessToken) {
  return mlFetch(`/users/${sellerId}`, accessToken); // incluye seller_reputation
}

export async function searchQuestions(sellerId, accessToken, { status = "UNANSWERED", limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ seller_id: sellerId, status, limit: String(limit), offset: String(offset) });
  return mlFetch(`/questions/search?${params.toString()}`, accessToken);
}

// API de reclamos/post-venta: usada para calcular qué publicaciones concentran
// más reclamos ("Productos con más problemas" del panel de MercadoLibre).
// Requiere que la app tenga el permiso correspondiente habilitado; si no lo
// tiene, la llamada devuelve 403/404 y services/sync.js lo maneja como un
// fallo blando (la sección simplemente no se muestra).
export async function searchClaims(accessToken, sellerId, { limit = 50, offset = 0, status, playerRole = "respondent" } = {}) {
  const params = new URLSearchParams({
    player_role: playerRole,
    player_user_id: String(sellerId),
    limit: String(limit),
    offset: String(offset),
  });
  if (status) params.set("status", status);
  return mlFetch(`/post-purchase/v1/claims/search?${params.toString()}`, accessToken);
}

// Mercado Ads (Product Ads) vive en un scope/host distinto y requiere el
// permiso "advertising" habilitado para la app; se deja el esqueleto para
// cuando esa integración se active.
export async function getAdsCampaigns(_advertiserId, _accessToken) {
  throw new Error("Integración de Mercado Ads pendiente de credenciales/permisos.");
}
