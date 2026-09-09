// Motor de reglas: SI <condición numérica> ENTONCES <diagnóstico>.
// Todo acá es determinístico (sin IA); la capa de IA (ai.js) solo redacta
// una explicación en lenguaje natural a partir de estos findings.

import {
  accountKpis,
  itemMetrics,
  revenueConcentration,
  stockCoverage,
  adsMetrics,
  reputationMetrics,
  listSellerItems,
  classifyListing,
  getSeller,
} from "./analytics.js";

let _idCounter = 0;
function finding({ scope, itemId = null, category, type, title, detail, evidence, impact, urgency, ease }) {
  _idCounter += 1;
  return { id: `f${_idCounter}`, scope, itemId, category, type, title, detail, evidence, impact, urgency, ease };
}

const STOCK_RISK_DAYS = 10;

// ---------------------------------------------------------------------------
// Reglas de cuenta
// ---------------------------------------------------------------------------
export function evaluateAccountRules(sellerId, days = 30) {
  const findings = [];
  const kpis = accountKpis(sellerId, days);
  const concentration = revenueConcentration(sellerId, days);
  const reputation = reputationMetrics(sellerId, days);

  // SI ventas bajan Y visitas se mantienen relativamente estables => problema de conversión
  if (kpis.revenueChangePct < -5 && kpis.visitsChangePct > kpis.revenueChangePct / 2) {
    findings.push(
      finding({
        scope: "account",
        category: "conversion",
        type: "problema",
        title: "Las ventas caen más rápido que las visitas: el problema es de conversión",
        detail: `Tus ventas bajaron ${Math.abs(kpis.revenueChangePct)}% en los últimos ${days} días, pero las visitas cayeron solo ${Math.abs(kpis.visitsChangePct)}%. No hay un problema de tráfico: hay un problema de conversión (${kpis.conversion}%, ${kpis.conversionChangePct}% vs. el período anterior).`,
        evidence: { revenueChangePct: kpis.revenueChangePct, visitsChangePct: kpis.visitsChangePct, conversion: kpis.conversion },
        impact: 9,
        urgency: 8,
        ease: 5,
      })
    );
  }

  // SI visitas bajan fuerte Y conversión estable => problema de tráfico
  if (kpis.visitsChangePct < -15 && Math.abs(kpis.conversionChangePct) < 8) {
    findings.push(
      finding({
        scope: "account",
        category: "trafico",
        type: "problema",
        title: "Caída de tráfico con conversión estable",
        detail: `Las visitas cayeron ${Math.abs(kpis.visitsChangePct)}% en los últimos ${days} días mientras la conversión se mantuvo estable (${kpis.conversionChangePct}%). El problema principal es generación de tráfico, no la publicación en sí.`,
        evidence: { visitsChangePct: kpis.visitsChangePct, conversionChangePct: kpis.conversionChangePct },
        impact: 8,
        urgency: 7,
        ease: 6,
      })
    );
  }

  // SI concentración de un producto > 35% => dependencia excesiva
  const top = concentration.items[0];
  if (top && top.sharePct > 35) {
    findings.push(
      finding({
        scope: "account",
        itemId: top.itemId,
        category: "ventas",
        type: "riesgo",
        title: "Dependencia excesiva de un producto",
        detail: `El ${top.sharePct}% de la facturación de los últimos ${days} días proviene de una sola publicación (${top.itemId}). Diversificar el catálogo reduce el riesgo si esa publicación pierde posicionamiento.`,
        evidence: { itemId: top.itemId, sharePct: top.sharePct },
        impact: 7,
        urgency: 4,
        ease: 4,
      })
    );
  }

  // SI el motivo de devolución dominante no es "calidad" => problema de publicación, no de producto
  const reasons = reputation.returnReasons;
  const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
  if (reputation.returns > 5 && topReason && topReason[0] !== "qualityPct" && topReason[1] > 30) {
    const label = topReason[0] === "mismatchPct" ? "producto distinto a lo esperado" : "medidas incorrectas";
    findings.push(
      finding({
        scope: "account",
        category: "reputacion",
        type: "problema",
        title: "Las devoluciones parecen originarse en la publicación, no en el producto",
        detail: `El ${topReason[1]}% de las devoluciones se debe a "${label}". Esto sugiere reforzar fotografías y especificaciones (medidas, materiales) más que un problema de calidad del producto.`,
        evidence: reasons,
        impact: 6,
        urgency: 5,
        ease: 6,
      })
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Reglas por publicación + clasificación (matriz estrella/oportunidad/etc.)
// ---------------------------------------------------------------------------
function level(value, avg, { highMult = 1.15, lowMult = 0.6 } = {}) {
  if (avg <= 0) return "media";
  if (value >= avg * highMult) return "alta";
  if (value <= avg * lowMult) return "baja";
  return "media";
}

const CLASSIFICATION_MATRIX = [
  { tipo: "⭐ Estrella", visitas: "alta", conversion: "alta", ventas: "alta", accion: "Defender" },
  { tipo: "💎 Oportunidad", visitas: "alta", conversion: "alta", ventas: "media", accion: "Publicidad" },
  { tipo: "⚠️ Problema", visitas: "alta", conversion: "baja", ventas: "baja", accion: "Optimizar" },
  { tipo: "💤 Dormida", visitas: "baja", conversion: "media", ventas: "baja", accion: "Generar tráfico" },
  { tipo: "💤 Dormida", visitas: "baja", conversion: "alta", ventas: "baja", accion: "Generar tráfico" },
  { tipo: "❌ Crítica", visitas: "baja", conversion: "baja", ventas: "baja", accion: "Replantear" },
];

function classifyItem(visitsLevel, conversionLevel, salesLevel) {
  const match = CLASSIFICATION_MATRIX.find(
    (r) => r.visitas === visitsLevel && r.conversion === conversionLevel && r.ventas === salesLevel
  );
  return match || { tipo: "🟦 Regular", accion: "Monitorear" };
}

export function evaluateItemRules(sellerId, days = 14) {
  const items = listSellerItems(sellerId);
  const seller = getSeller(sellerId);
  const metricsByItem = Object.fromEntries(items.map((it) => [it.item_id, itemMetrics(it.item_id, days)]));
  const all = Object.values(metricsByItem);

  const avgVisits = all.reduce((s, m) => s + m.visits, 0) / (all.length || 1);
  const avgConversion = all.reduce((s, m) => s + m.conversion, 0) / (all.length || 1);
  const avgUnits = all.reduce((s, m) => s + m.units, 0) / (all.length || 1);

  const findings = [];
  const classification = [];

  for (const item of items) {
    const m = metricsByItem[item.item_id];
    const visitsLevel = level(m.visits, avgVisits);
    const conversionLevel = level(m.conversion, avgConversion, { highMult: 1.1, lowMult: 0.65 });
    const salesLevel = level(m.units, avgUnits);
    const cls = classifyItem(visitsLevel, conversionLevel, salesLevel);

    classification.push({
      itemId: item.item_id,
      title: item.title,
      tipo: cls.tipo,
      accion: cls.accion,
      visitas: m.visits,
      visitasNivel: visitsLevel,
      conversion: m.conversion,
      conversionNivel: conversionLevel,
      ventas: m.units,
      ventasNivel: salesLevel,
      precio: item.price,
      permalink: item.permalink || null,
      listingType: classifyListing(item, seller?.site_id),
      variationsCount: item.variations_count || 0,
    });

    // Muchas visitas + pocas ventas -> problema de conversión de la publicación
    if (visitsLevel === "alta" && conversionLevel === "baja") {
      findings.push(
        finding({
          scope: "item",
          itemId: item.item_id,
          category: "conversion",
          type: "problema",
          title: `${item.title}: recibe tráfico pero convierte bajo el promedio de la cuenta`,
          detail: `Esta publicación recibe ${m.visits} visitas (por encima del promedio) pero su conversión es ${m.conversion}%, por debajo del promedio de la cuenta (${avgConversion.toFixed(2)}%). Recomendamos revisar precio, fotografías y propuesta comercial antes de aumentar inversión publicitaria.`,
          evidence: { visits: m.visits, conversion: m.conversion, avgConversion: Number(avgConversion.toFixed(2)) },
          impact: 8,
          urgency: 6,
          ease: 5,
        })
      );
    }

    // Alta conversión + pocas visitas -> oportunidad de tráfico/publicidad
    if (conversionLevel === "alta" && visitsLevel === "baja") {
      findings.push(
        finding({
          scope: "item",
          itemId: item.item_id,
          category: "publicidad",
          type: "oportunidad",
          title: `${item.title}: convierte muy bien pero le falta tráfico`,
          detail: `Convierte a ${m.conversion}% (sobre el promedio de la cuenta) pero recibe solo ${m.visits} visitas. Es una buena candidata para activar o aumentar publicidad.`,
          evidence: { visits: m.visits, conversion: m.conversion },
          impact: 7,
          urgency: 5,
          ease: 7,
        })
      );
    }

    // Riesgo de quiebre de stock
    const stock = stockCoverage(item.item_id);
    if (stock.daysOfCoverage < STOCK_RISK_DAYS && stock.dailyVelocity > 0) {
      findings.push(
        finding({
          scope: "item",
          itemId: item.item_id,
          category: "stock",
          type: "riesgo",
          title: `${item.title}: riesgo de quiebre de stock`,
          detail: `Stock actual: ${stock.stock} unidades. Venta promedio: ${stock.dailyVelocity}/día. Cobertura: ${stock.daysOfCoverage} días. Recomendamos reponer antes de ${Math.max(1, Math.floor(stock.daysOfCoverage - 1))} días para no perder posicionamiento.`,
          evidence: stock,
          impact: 8,
          urgency: 9,
          ease: 3,
        })
      );
    }

    // Publicidad no rentable / oportunidad de escalar
    const ads = adsMetrics(item.item_id, days);
    if (ads.investment > 0 && ads.profitable === false) {
      findings.push(
        finding({
          scope: "item",
          itemId: item.item_id,
          category: "publicidad",
          type: "problema",
          title: `${item.title}: publicidad no rentable`,
          detail: `ROAS actual ${ads.roas} vs. ROAS mínimo rentable ${ads.minRoas} (ACOS actual ${ads.acos}% vs. máximo ${ads.maxAcos}% según tu margen). Reduce la inversión o mejora la conversión antes de seguir escalando.`,
          evidence: ads,
          impact: 8,
          urgency: 7,
          ease: 6,
        })
      );
    } else if (ads.investment > 0 && ads.profitable === true && ads.minRoas && ads.roas >= ads.minRoas * 1.5 && stock.daysOfCoverage > STOCK_RISK_DAYS) {
      findings.push(
        finding({
          scope: "item",
          itemId: item.item_id,
          category: "publicidad",
          type: "oportunidad",
          title: `${item.title}: hay espacio para escalar inversión publicitaria`,
          detail: `ROAS actual ${ads.roas} está muy por encima del ROAS mínimo rentable (${ads.minRoas}) y el stock alcanza (${stock.daysOfCoverage} días de cobertura). Es un buen candidato para aumentar el presupuesto de Ads.`,
          evidence: ads,
          impact: 6,
          urgency: 3,
          ease: 8,
        })
      );
    }
  }

  return { classification, findings, averages: { avgVisits, avgConversion, avgUnits } };
}

export function runFullDiagnosis(sellerId) {
  const accountFindings = evaluateAccountRules(sellerId, 30);
  const { classification, findings: itemFindings, averages } = evaluateItemRules(sellerId, 14);
  return {
    findings: [...accountFindings, ...itemFindings],
    classification,
    averages,
  };
}
