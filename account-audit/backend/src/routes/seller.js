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

router.get("/ml/oauth/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "Falta ?code en el callback de MercadoLibre." });
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

    res.json({ connected: true, user_id: sellerId, nickname: me.nickname, sync });
  } catch (err) {
    res.status(400).json({ error: err.message });
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
