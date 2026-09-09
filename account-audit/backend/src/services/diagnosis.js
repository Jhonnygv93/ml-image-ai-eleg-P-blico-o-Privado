// Compone el diagnóstico completo de una cuenta combinando analítica, motor
// de reglas, scoring y prioridades. Es la única fuente de verdad que
// consumen el dashboard, el PDF y la capa de IA — así los tres siempre
// muestran exactamente los mismos números.

import { accountKpisAllWindows, revenueConcentration, reputationDetail, listingTypeBreakdown, getSeller, listSellers } from "./analytics.js";
import { runFullDiagnosis } from "./rules.js";
import { computeScores } from "./scoring.js";
import { buildActionPlan } from "./priorities.js";

export function getFullDiagnosis(sellerId) {
  const seller = getSeller(sellerId);
  if (!seller) return null;

  const kpis = accountKpisAllWindows(sellerId);
  const scores = computeScores(sellerId);
  const { findings, classification } = runFullDiagnosis(sellerId);
  const plan = buildActionPlan(findings);
  const concentration = revenueConcentration(sellerId, 30);
  const reputation = reputationDetail(sellerId, 30);
  const listingTypes = listingTypeBreakdown(sellerId);

  const problems = plan.ranked.filter((f) => f.type === "problema" || f.type === "riesgo").slice(0, 5);
  const opportunities = plan.ranked.filter((f) => f.type === "oportunidad").slice(0, 5);

  return {
    seller,
    kpis,
    scores,
    classification,
    concentration,
    reputation,
    listingTypes,
    findings: plan.ranked,
    actionPlan: { "24-48h": plan["24-48h"], "7d": plan["7d"], "30d": plan["30d"] },
    topProblems: problems,
    topOpportunities: opportunities,
  };
}

export function listAllSellersSummary() {
  return listSellers().map((s) => {
    const scores = computeScores(s.seller_id);
    return { seller_id: s.seller_id, nickname: s.nickname, site_id: s.site_id, overall: scores.overall, health: scores.health };
  });
}
