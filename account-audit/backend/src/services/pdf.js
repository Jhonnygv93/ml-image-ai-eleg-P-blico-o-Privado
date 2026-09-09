// Genera el informe PDF de auditoría de cuenta (sección 15 del documento de
// arquitectura): portada, resumen ejecutivo, KPIs, diagnóstico de
// publicaciones, publicidad, inventario, reputación, competencia,
// oportunidades, riesgos, recomendaciones IA y plan de acción a 30 días.

import PDFDocument from "pdfkit";

const money = (v) => `$${Math.round(v).toLocaleString("es-CL")}`;
const pct = (v) => `${v > 0 ? "+" : ""}${v}%`;

function sectionTitle(doc, text) {
  doc.moveDown(1);
  doc.fontSize(16).fillColor("#1a1a1a").text(text, { underline: false });
  doc.moveTo(doc.x, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2).strokeColor("#cccccc").stroke();
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#333333");
}

function bullet(doc, text) {
  doc.fontSize(10).fillColor("#333333").text(`•  ${text}`, { indent: 10 });
}

function kpiLine(doc, label, value, changePct) {
  doc.fontSize(10).fillColor("#333333").text(`${label}: `, { continued: true }).fillColor("#000000").text(`${value}  `, { continued: true });
  const color = changePct > 0 ? "#1a7f37" : changePct < 0 ? "#c92a2a" : "#666666";
  doc.fillColor(color).text(`(${pct(changePct)} vs. período anterior)`);
}

export function streamReportPdf(diagnosis, narrative, res) {
  const doc = new PDFDocument({ margin: 50, bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="auditoria-${diagnosis.seller.seller_id}.pdf"`);
  doc.pipe(res);

  const { seller, scores, kpis, topProblems, topOpportunities, actionPlan, classification, reputation, concentration } = diagnosis;
  const today = new Date().toLocaleDateString("es-CL", { year: "numeric", month: "long" });

  // ---- Portada ----
  doc.fontSize(24).fillColor("#000000").text("Auditoría de Cuenta MercadoLibre", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(14).fillColor("#444444").text(`Seller: ${seller.nickname}`, { align: "center" });
  doc.fontSize(12).text(`Período: ${today}`, { align: "center" });
  doc.moveDown(2);
  doc.fontSize(48).fillColor(scores.overall >= 80 ? "#1a7f37" : scores.overall >= 60 ? "#e0a800" : "#c92a2a").text(
    `${scores.overall}/100`,
    { align: "center" }
  );
  doc.fontSize(14).fillColor("#444444").text(`${scores.health.emoji} ${scores.health.label}`, { align: "center" });

  // ---- 1. Resumen ejecutivo ----
  doc.addPage();
  sectionTitle(doc, "1. Resumen ejecutivo");
  doc.fontSize(10).fillColor("#333333").text(narrative, { align: "left" });

  // ---- 2. KPIs ----
  doc.addPage();
  sectionTitle(doc, "2. KPIs (30 días vs. período anterior)");
  const k30 = kpis[30];
  kpiLine(doc, "Facturación", money(k30.revenue), k30.revenueChangePct);
  kpiLine(doc, "Unidades vendidas", k30.units, k30.unitsChangePct);
  kpiLine(doc, "Órdenes", k30.orders, k30.ordersChangePct);
  kpiLine(doc, "Visitas", k30.visits, k30.visitsChangePct);
  kpiLine(doc, "Conversión", `${k30.conversion}%`, k30.conversionChangePct);
  kpiLine(doc, "Ticket promedio", money(k30.avgTicket), k30.avgTicketChangePct);

  doc.moveDown(1);
  sectionTitle(doc, "Scores por categoría");
  for (const [cat, val] of Object.entries(scores.categories)) {
    doc.fontSize(10).fillColor("#333333").text(`${cat}: ${val}/100`);
  }

  // ---- 3. Evolución de ventas ----
  doc.addPage();
  sectionTitle(doc, "3. Evolución de ventas (7 / 15 / 30 / 60 / 90 días)");
  for (const w of [7, 15, 30, 60, 90]) {
    const k = kpis[w];
    doc.fontSize(10).fillColor("#333333").text(`${w} días: facturación ${money(k.revenue)} (${pct(k.revenueChangePct)}), conversión ${k.conversion}% (${pct(k.conversionChangePct)})`);
  }
  doc.moveDown(1);
  sectionTitle(doc, "Concentración de facturación");
  concentration.items.slice(0, 5).forEach((it) => bullet(doc, `${it.itemId}: ${it.sharePct}% de la facturación (${money(it.revenue)})`));

  // ---- 4. Diagnóstico de publicaciones ----
  doc.addPage();
  sectionTitle(doc, "4. Diagnóstico de publicaciones");
  const byTipo = {};
  for (const c of classification) (byTipo[c.tipo] ??= []).push(c);
  for (const [tipo, items] of Object.entries(byTipo)) {
    doc.fontSize(11).fillColor("#000000").text(`${tipo} (${items.length})`);
    items.forEach((it) => bullet(doc, `${it.title} — visitas ${it.visitas}, conversión ${it.conversion}%, ventas ${it.ventas}u → ${it.accion}`));
    doc.moveDown(0.3);
  }

  // ---- 5. Publicidad / Rentabilidad ----
  doc.addPage();
  sectionTitle(doc, "5. Publicidad y rentabilidad");
  const adsFindings = diagnosis.findings.filter((f) => f.category === "publicidad");
  if (adsFindings.length) adsFindings.forEach((f) => bullet(doc, `${f.type === "problema" ? "🔴" : "🟢"} ${f.title}`));
  else doc.text("Sin hallazgos de publicidad en el período.");

  // ---- 6. Inventario ----
  doc.moveDown(1);
  sectionTitle(doc, "6. Inventario");
  const stockFindings = diagnosis.findings.filter((f) => f.category === "stock");
  if (stockFindings.length) stockFindings.forEach((f) => bullet(doc, `⚠️ ${f.title} — ${f.detail}`));
  else doc.text("Sin riesgos de quiebre de stock detectados.");

  // ---- 7. Reputación ----
  doc.moveDown(1);
  sectionTitle(doc, "7. Reputación");
  doc.text(`Reclamos: ${reputation.claims} (${pct(reputation.claimsChangePct)})  |  Cancelaciones: ${reputation.cancellations} (${pct(reputation.cancellationsChangePct)})  |  Devoluciones: ${reputation.returns}`);
  doc.text(`Principales causas de devolución: producto distinto ${reputation.returnReasons.mismatchPct}%, medidas ${reputation.returnReasons.sizePct}%, calidad ${reputation.returnReasons.qualityPct}%`);

  // ---- 8. Oportunidades y riesgos ----
  doc.addPage();
  sectionTitle(doc, "8. Oportunidades detectadas");
  topOpportunities.forEach((f) => bullet(doc, `${f.title}`));
  doc.moveDown(1);
  sectionTitle(doc, "9. Riesgos");
  topProblems.forEach((f) => bullet(doc, `${f.title}`));

  // ---- 10. Recomendaciones IA ----
  doc.addPage();
  sectionTitle(doc, "10. Recomendaciones IA");
  doc.fontSize(10).fillColor("#333333").text(narrative);

  // ---- 11. Plan de acción 30 días ----
  doc.addPage();
  sectionTitle(doc, "11. Plan de acción");
  for (const [horizon, label] of [
    ["24-48h", "Próximas 24-48 horas"],
    ["7d", "Próximos 7 días"],
    ["30d", "Próximos 30 días"],
  ]) {
    doc.fontSize(12).fillColor("#000000").text(label);
    const items = actionPlan[horizon];
    if (!items.length) doc.fontSize(10).fillColor("#666666").text("Sin acciones en este horizonte.");
    items.forEach((f) => bullet(doc, `[${f.priorityBand.toUpperCase()}] ${f.title}`));
    doc.moveDown(0.5);
  }

  doc.moveDown(1);
  sectionTitle(doc, "Las 5 acciones prioritarias");
  diagnosis.findings.slice(0, 5).forEach((f, i) => bullet(doc, `${i + 1}. ${f.title} — Responsable: Gestor de cuenta — Prioridad: ${f.priorityBand}`));

  doc.end();
}
