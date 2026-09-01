// OAuth 2.0 (Authorization Code) contra la API de MercadoLibre.
// https://developers.mercadolibre.com/es_ar/autenticacion-y-autorizacion
//
// Flujo:
//   1) getAuthorizationUrl(siteId) -> el gestor abre esa URL y autoriza la app
//   2) ML redirige a ML_REDIRECT_URI con ?code=...
//   3) exchangeCodeForToken(code) -> guarda access_token/refresh_token
//   4) refreshAccessToken(refresh_token) cuando expira (dura 6hs)

const SITE_AUTH_HOST = {
  MLA: "https://auth.mercadolibre.com.ar",
  MLB: "https://auth.mercadolibre.com.br",
  MLM: "https://auth.mercadolibre.com.mx",
  MLC: "https://auth.mercadolibre.cl",
  MCO: "https://auth.mercadolibre.com.co",
};

const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

function requireCredentials() {
  const { ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI } = process.env;
  if (!ML_CLIENT_ID || !ML_CLIENT_SECRET || !ML_REDIRECT_URI) {
    throw new Error(
      "Faltan credenciales de MercadoLibre (ML_CLIENT_ID / ML_CLIENT_SECRET / ML_REDIRECT_URI). " +
        "Registrá una app en https://developers.mercadolibre.com/ y completá el .env. " +
        "Mientras tanto, la app sigue funcionando en modo demo con datos sembrados."
    );
  }
  return { ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI };
}

export function getAuthorizationUrl(siteId = "MLC", state = "") {
  const { ML_CLIENT_ID, ML_REDIRECT_URI } = requireCredentials();
  const host = SITE_AUTH_HOST[siteId] || SITE_AUTH_HOST.MLC;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: ML_CLIENT_ID,
    redirect_uri: ML_REDIRECT_URI,
    state,
  });
  return `${host}/authorization?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const { ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI } = requireCredentials();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: ML_CLIENT_ID,
    client_secret: ML_CLIENT_SECRET,
    code,
    redirect_uri: ML_REDIRECT_URI,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`Error intercambiando code por token: ${res.status} ${await res.text()}`);
  return res.json(); // { access_token, token_type, expires_in, refresh_token, user_id, ... }
}

export async function refreshAccessToken(refreshToken) {
  const { ML_CLIENT_ID, ML_CLIENT_SECRET } = requireCredentials();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: ML_CLIENT_ID,
    client_secret: ML_CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`Error refrescando token: ${res.status} ${await res.text()}`);
  return res.json();
}
