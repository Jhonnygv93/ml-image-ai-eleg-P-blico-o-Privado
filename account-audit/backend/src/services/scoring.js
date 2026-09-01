// Convierte los KPIs y findings del motor de reglas en un Score 0-100 por
// categoría + un score general ponderado, como en el "Dashboard ejecutivo"
// (sección 1 del documento de arquitectura).

import { accountKpis, itemMetrics, listSellerItems, adsMetrics, stockCoverage, competitiveIndex, reputationMetrics } from "./analytics.js";
import { evaluateItemRules } from "./rules.js";

const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const round = (v) => Math.round(v);

function scoreFromChangePct(pct, { base = 70, sensitivity = 1.2 } = {}) {
  return clamp(base + pct * sensitivity);
}

const CLASSIFICATION_VALUE = {
  "⭐ Estrella": 95,
  "💎 Oportunidad": 80,
  "🟦 Regular": 65,
  "💤 Dormida": 50,
  "⚠️ Problema": 35,
  "❌ Crítica": 15,
};

const WEIGHTS = {
  ventas: 15,
  conversion: 15,
  publicaciones: 10,
  publicidad: 10,
  reputacion: 15,
  logistica: 8,
  stock: 10,
  precios: 5,
  competitividad: 7,
  crecimiento: 5,
};

function healthLabel(score) {
  if (score >= 80) return { emoji: "🟢", label: "Saludable" };
  if (score >= 60) return { emoji: "🟡", label: "Con oportunidades" };
  return { emoji: "🔴", label: "Requiere atención" };
}

export function computeScores(sellerId) {
  const kpis30 = accountKpis(sellerId, 30);
  const kpis90 = accountKpis(sellerId, 90);
  const items = listSellerItems(sellerId);
  const { classification } = evaluateItemRules(sellerId, 14);
  const reputation = reputationMetrics(sellerId, 30);

  const perItem = items.map((it) => ({
    item: it,
    ads: adsMetrics(it.item_id, 30),
    stock: stockCoverage(it.item_id),
    comp: competitiveIndex(it.item_id),
  }));

  // --- Ventas ---
  const ventas = round(scoreFromChangePct(kpis30.revenueChangePct, { base: 70, sensitivity: 1.2 }));

  // --- Conversión ---
  const convAbs = clamp((kpis30.conversion / 5) * 100);
  const convChange = scoreFromChangePct(kpis30.conversionChangePct, { base: 70, sensitivity: 1.5 });
  const conversion = round(convAbs * 0.5 + convChange * 0.5);

  // --- Publicaciones (calidad de catálogo según clasificación) ---
  const publicaciones = classification.length
    ? round(classification.reduce((s, c) => s + (CLASSIFICATION_VALUE[c.tipo] ?? 60), 0) / classification.length)
    : 60;

  // --- Publicidad ---
  const adsWithSpend = perItem.filter((p) => p.ads.investment > 0 && p.ads.minRoas);
  const publicidad = adsWithSpend.length
    ? round(adsWithSpend.reduce((s, p) => s + clamp((p.ads.roas / p.ads.minRoas) * 50), 0) / adsWithSpend.length)
    : 60;

  // --- Reputación ---
  const reputacion = reputation.reputationScore != null ? round(clamp(reputation.reputationScore - reputation.delays * 1.5)) : 70;

  // --- Logística ---
  const logisticaBase = items.length
    ? items.reduce((s, it) => s + ((it.has_full ? 100 : 60) * 0.5 + (it.free_shipping ? 100 : 60) * 0.5), 0) / items.length
    : 70;
  const logistica = round(clamp(logisticaBase - Math.min(30, reputation.delays * 2)));

  // --- Stock ---
  const withVelocity = perItem.filter((p) => p.stock.dailyVelocity > 0);
  const healthy = withVelocity.filter((p) => p.stock.daysOfCoverage >= 10).length;
  const stock = withVelocity.length ? round((healthy / withVelocity.length) * 100) : 75;

  // --- Precios ---
  const withComp = perItem.filter((p) => p.comp);
  const precios = withComp.length
    ? round(withComp.reduce((s, p) => s + clamp(100 + p.comp.priceGapPct * 2), 0) / withComp.length)
    : 65;

  // --- Competitividad ---
  const competitividad = withComp.length ? round(withComp.reduce((s, p) => s + p.comp.overallIndex, 0) / withComp.length) : 65;

  // --- Crecimiento (tendencia 30d vs 90d) ---
  const dailyRev30 = kpis30.revenue / 30;
  const dailyRev90 = kpis90.revenue / 90;
  const growthPct = dailyRev90 > 0 ? Number((((dailyRev30 - dailyRev90) / dailyRev90) * 100).toFixed(1)) : 0;
  const crecimiento = round(scoreFromChangePct(growthPct, { base: 65, sensitivity: 1.0 }));

  const categories = { ventas, conversion, publicaciones, publicidad, reputacion, logistica, stock, precios, competitividad, crecimiento };

  const overall = round(
    Object.entries(categories).reduce((sum, [key, value]) => sum + value * (WEIGHTS[key] / 100), 0)
  );

  return { overall, health: healthLabel(overall), categories, weights: WEIGHTS };
}

/** "Publication Score" (sección 3): salud de una publicación individual, 0-100. */
export function computeItemScore(sellerId, itemId, days = 14) {
  const { averages } = evaluateItemRules(sellerId, days);
  const metrics = itemMetrics(itemId, days);
  const stock = stockCoverage(itemId);
  const ads = adsMetrics(itemId, 30);

  const conversionRatio = averages.avgConversion > 0 ? metrics.conversion / averages.avgConversion : 1;
  const conversionScore = clamp(conversionRatio * 55, 0, 60);
  const stockScore = stock.dailyVelocity === 0 ? 20 : clamp((stock.daysOfCoverage / 10) * 20, 0, 20);
  const adsScore = ads.investment > 0 ? (ads.profitable ? 20 : 5) : 15;

  return { itemId, score: round(clamp(conversionScore + stockScore + adsScore)), metrics, stock, ads };
}
