// Capa de interpretación IA. Importante (sección 12 del documento de
// arquitectura): la IA NUNCA calcula números — todos los KPIs, scores y
// findings ya vienen calculados por código determinístico
// (analytics/rules/scoring/priorities). Acá solo se le pide que los
// interprete y redacte en lenguaje natural. Si no hay OPENAI_API_KEY
// configurada, se usa una redacción basada en plantillas sobre los mismos
// findings, para que la app funcione igual de bien sin IA.

import OpenAI from "openai";
import { getFullDiagnosis } from "./diagnosis.js";

let client = null;
function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI();
  return client;
}

const SYSTEM_PROMPT = `Actúa como Senior Account Manager especializado en MercadoLibre.
Se te entrega un diagnóstico ya calculado (KPIs, scores, hallazgos y plan de acción) de la
cuenta de un seller, en JSON. Tu trabajo es SOLO interpretar y redactar recomendaciones claras
y accionables en español, priorizando lo más urgente e impactante primero.
Reglas estrictas:
- No inventes ni recalcules cifras: usa exactamente los números del JSON.
- Sé específico: menciona publicaciones, porcentajes y montos concretos cuando estén disponibles.
- Estructura la respuesta en: (1) diagnóstico general en 2-3 frases, (2) los problemas críticos,
  (3) las oportunidades, (4) una recomendación priorizada de próximos pasos.
- Tono profesional y directo, como si se lo entregaras al dueño de la cuenta.`;

function fallbackNarrative(diagnosis) {
  const { seller, scores, topProblems, topOpportunities, kpis } = diagnosis;
  const k30 = kpis[30];
  const lines = [];
  lines.push(
    `${seller.nickname} tiene una salud de cuenta de ${scores.overall}/100 (${scores.health.emoji} ${scores.health.label}). ` +
      `En los últimos 30 días la facturación varió ${k30.revenueChangePct}% y la conversión ${k30.conversionChangePct}%.`
  );
  if (topProblems.length) {
    lines.push("\nProblemas críticos:");
    topProblems.forEach((f, i) => lines.push(`${i + 1}. ${f.title}. ${f.detail}`));
  }
  if (topOpportunities.length) {
    lines.push("\nOportunidades:");
    topOpportunities.forEach((f, i) => lines.push(`${i + 1}. ${f.title}. ${f.detail}`));
  }
  const next = diagnosis.actionPlan["24-48h"][0];
  if (next) {
    lines.push(`\nPróximo paso recomendado (24-48h): ${next.title}.`);
  }
  return lines.join("\n");
}

export async function interpretAccount(sellerId) {
  const diagnosis = getFullDiagnosis(sellerId);
  if (!diagnosis) return null;

  const openai = getClient();
  if (!openai) {
    return { narrative: fallbackNarrative(diagnosis), source: "rules", diagnosis };
  }

  try {
    const payload = {
      seller: diagnosis.seller.nickname,
      scoreGeneral: diagnosis.scores.overall,
      scoresPorCategoria: diagnosis.scores.categories,
      kpis30dias: diagnosis.kpis[30],
      kpis90dias: diagnosis.kpis[90],
      concentracionFacturacion: diagnosis.concentration.items.slice(0, 5),
      problemasCriticos: diagnosis.topProblems,
      oportunidades: diagnosis.topOpportunities,
      planDeAccion: diagnosis.actionPlan,
    };
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });
    const narrative = completion.choices?.[0]?.message?.content?.trim();
    return { narrative: narrative || fallbackNarrative(diagnosis), source: "openai", diagnosis };
  } catch (err) {
    console.error("Fallo interpretación IA, uso fallback de reglas:", err.message);
    return { narrative: fallbackNarrative(diagnosis), source: "rules-fallback", diagnosis };
  }
}

function fallbackAnswer(diagnosis, question) {
  const q = question.toLowerCase();
  const k30 = diagnosis.kpis[30];
  const k14 = diagnosis.kpis[15];

  if (q.includes("venta") && (q.includes("baj") || q.includes("cae") || q.includes("por qué") || q.includes("porque"))) {
    const trafficIsCause = Math.abs(k30.visitsChangePct) >= Math.abs(k30.revenueChangePct) * 0.6;
    return (
      `Durante los últimos 30 días la facturación varió ${k30.revenueChangePct}%. ` +
      `Las visitas variaron ${k30.visitsChangePct}% y la conversión ${k30.conversionChangePct}%. ` +
      (trafficIsCause
        ? "El factor principal parece ser el tráfico (las visitas se movieron en una magnitud similar a las ventas)."
        : "La conversión se movió mucho más que el tráfico, por lo que el problema principal parece ser de conversión, no de tráfico.")
    );
  }

  if (q.includes("invertir") || q.includes("publicidad") || q.includes("ads")) {
    const candidates = diagnosis.topOpportunities.filter((f) => f.category === "publicidad");
    if (candidates.length) {
      return (
        "Según conversión, ROAS y stock disponible, las mejores candidatas para recibir más inversión publicitaria son:\n" +
        candidates.map((f, i) => `${i + 1}. ${f.title}`).join("\n")
      );
    }
    return "No se detectaron publicaciones con espacio claro para escalar publicidad en este momento (revisa ROAS y stock).";
  }

  return (
    `Resumen de los últimos 30 días: facturación ${k30.revenue} (${k30.revenueChangePct}%), ` +
    `${k30.units} unidades, conversión ${k30.conversion}% (${k30.conversionChangePct}%). ` +
    `Score general de la cuenta: ${diagnosis.scores.overall}/100.`
  );
}

export async function askAccount(sellerId, question) {
  const diagnosis = getFullDiagnosis(sellerId);
  if (!diagnosis) return null;

  const openai = getClient();
  if (!openai) {
    return { answer: fallbackAnswer(diagnosis, question), source: "rules" };
  }

  try {
    const payload = {
      seller: diagnosis.seller.nickname,
      kpisPorVentana: diagnosis.kpis,
      scores: diagnosis.scores,
      topProblemas: diagnosis.topProblems,
      topOportunidades: diagnosis.topOpportunities,
      planDeAccion: diagnosis.actionPlan,
    };
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            SYSTEM_PROMPT +
            "\nAhora el dueño de la cuenta te hace una pregunta puntual. Respondé solo con los datos del JSON, en 3-6 frases.",
        },
        { role: "user", content: `Datos de la cuenta: ${JSON.stringify(payload)}\n\nPregunta: ${question}` },
      ],
    });
    const answer = completion.choices?.[0]?.message?.content?.trim();
    return { answer: answer || fallbackAnswer(diagnosis, question), source: "openai" };
  } catch (err) {
    console.error("Fallo respuesta IA, uso fallback de reglas:", err.message);
    return { answer: fallbackAnswer(diagnosis, question), source: "rules-fallback" };
  }
}
