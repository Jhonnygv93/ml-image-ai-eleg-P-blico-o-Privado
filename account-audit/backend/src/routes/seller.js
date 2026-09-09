import { Router } from "express";
import { listAllSellersSummary, getFullDiagnosis } from "../services/diagnosis.js";
import { listSellerItems, competitiveIndex } from "../services/analytics.js";
import { computeItemScore } from "../services/scoring.js";
import { interpretAccount, askAccount } from "../services/ai.js";
import { streamReportPdf } from "../services/pdf.js";
import { getAuthorizationUrl, exchangeCodeForToken } from "../ml/oauth.js";
import { getMe } from "../ml/client.js";
import { saveSellerToken, syncSeller } from "../services/sync.js";

const router = Router();

router.get("/sellers", (req, res) => {
  res.json(listAllSellersSummary());
});

router.get("/sellers/:id/dashboard", async (req, res) => {
  const diagnosis = getFullDiagnosis(req.params.id);
  if (!diagnosis) return res.status(404).json({ error: "Seller no encontrado" });

  const { narrative, source } = await interpretAccount(req.params.id);
  res.json({ ...diagnosis, aiNarrative: narrative, aiSource: source });
});

router.get("/sellers/:id/items", (req, res) => {
  const items = listSellerItems(req.params.id);
  if (!items.length) return res.status(404).json({ error: "Seller no encontrado o sin publicaciones" });

  const detailed = items.map((item) => ({
    ...item,
    publicationScore: computeItemScore(req.params.id, item.item_id),
    competitive: competitiveIndex(item.item_id),
  }));
  res.json(detailed);
});

router.post("/sellers/:id/ask", async (req, res) => {
  const { question } = req.body || {};
  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Falta 'question' (string) en el body." });
  }
  const result = await askAccount(req.params.id, question);
  if (!result) return res.status(404).json({ error: "Seller no encontrado" });
  res.json(result);
});

router.get("/sellers/:id/report.pdf", async (req, res) => {
  const diagnosis = getFullDiagnosis(req.params.id);
  if (!diagnosis) return res.status(404).json({ error: "Seller no encontrado" });

  const { narrative } = await interpretAccount(req.params.id);
  streamReportPdf(diagnosis, narrative, res);
});

// --- Conexión real de cuenta (OAuth MercadoLibre) ---
// No se ejercita en el modo demo: requiere ML_CLIENT_ID/SECRET reales.
router.get("/ml/oauth/url", (req, res) => {
  try {
    const url = getAuthorizationUrl(req.query.site_id || "MLC");
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Página de resultado del OAuth: la ve el vendedor real justo después de
// autorizar en MercadoLibre, así que tiene que verse como parte confiable de
// la app (misma marca/paleta que el dashboard) y no como una respuesta de API.
function renderOauthResultPage({ ok, nickname, sellerId, itemsSynced, message }) {
  const title = ok ? "Cuenta conectada" : "No se pudo conectar";
  const icon = ok
    ? `<svg width="52" height="52" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#0ca30c" opacity="0.12"/><path d="M7 12.5l3 3 7-7" stroke="#0ca30c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg width="52" height="52" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#d03b3b" opacity="0.12"/><path d="M12 7v6M12 16.5v.01" stroke="#d03b3b" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  const body = ok
    ? `<p class="lead">Autorizaste a <strong>Auditoría ML</strong> a leer los datos de tu cuenta de MercadoLibre.</p>
       <div class="account-box">
         <span class="account-name">${escapeHtml(nickname)}</span>
         <span class="account-id">ID ${escapeHtml(sellerId)}</span>
       </div>
       <p class="hint">${itemsSynced ? `Ya sincronizamos ${escapeHtml(itemsSynced)} publicaciones reales.` : "Estamos trayendo tus publicaciones, ventas y reputación reales."}</p>
       <a class="cta" href="/?connected=${encodeURIComponent(sellerId)}">Ir a mi panel →</a>`
    : `<p class="lead">${escapeHtml(message || "Ocurrió un error inesperado durante la autorización.")}</p>
       <a class="cta" href="/">Volver e intentar de nuevo</a>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Auditoría ML</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #f9f9f7; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #0b0b0b;
    padding: 24px;
  }
  .card {
    background: #ffffff; border: 1px solid rgba(11,11,11,0.1); border-radius: 16px;
    padding: 40px 36px; max-width: 420px; width: 100%; text-align: center;
    box-shadow: 0 1px 3px rgba(11,11,11,0.06);
  }
  .brand { font-size: 13px; font-weight: 800; letter-spacing: 0.02em; color: #898781; margin-bottom: 18px; text-transform: uppercase; }
  h1 { font-size: 21px; font-weight: 800; margin: 16px 0 8px; }
  .lead { font-size: 14.5px; color: #52514e; line-height: 1.5; margin: 0 0 18px; }
  .account-box { background: #f9f9f7; border: 1px solid rgba(11,11,11,0.1); border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 2px; }
  .account-name { font-weight: 700; font-size: 15px; }
  .account-id { font-size: 12.5px; color: #898781; }
  .hint { font-size: 13px; color: #898781; margin: 0 0 22px; }
  .cta {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    background: #2a78d6; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px;
    padding: 12px 22px; border-radius: 999px; transition: background 0.15s;
  }
  .cta:hover { background: #1f63b8; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">Auditoría ML</div>
    ${icon}
    <h1>${title}</h1>
    ${body}
  </div>
</body>
</html>`;
}

router.get("/ml/oauth/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) throw new Error("Falta ?code en el callback de MercadoLibre.");
    const token = await exchangeCodeForToken(code);
    const sellerId = String(token.user_id);

    const me = await getMe(token.access_token);
    saveSellerToken(sellerId, {
      nickname: me.nickname,
      siteId: me.site_id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
    });

    let sync = null;
    try {
      sync = await syncSeller(sellerId);
    } catch (err) {
      console.warn(`No se pudo sincronizar ${sellerId} tras conectar: ${err.message}`);
    }

    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(renderOauthResultPage({ ok: true, nickname: me.nickname, sellerId, itemsSynced: sync?.itemsSynced }));
  } catch (err) {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.status(400).send(renderOauthResultPage({ ok: false, message: err.message }));
  }
});

// Re-sincroniza una cuenta real ya conectada (usa el refresh_token guardado si el access_token venció).
router.post("/sellers/:id/sync", async (req, res) => {
  try {
    const result = await syncSeller(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
