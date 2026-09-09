// Sistema de prioridades: Impacto x Urgencia x Facilidad -> plan de acción
// en 3 horizontes (24-48h / 7 días / 30 días), como en la sección 14 del
// documento de arquitectura.
//
// Se pondera como suma (no como producto puro) para que un hallazgo muy
// urgente e impactante (ej. riesgo de quiebre de stock) no quede enterrado
// solo por ser difícil de resolver (ease bajo): impacto y urgencia son los
// que deciden si algo es prioritario; la facilidad ayuda a desempatar y a
// distinguir "quick wins".
export function prioritize(findings) {
  return findings
    .map((f) => {
      const priorityScore = Number((f.impact * 4 + f.urgency * 4.5 + f.ease * 1.5).toFixed(1));
      const priorityBand = priorityScore >= 70 ? "alta" : priorityScore >= 45 ? "media" : "baja";
      return { ...f, priorityScore, priorityBand };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

export function buildActionPlan(findings, { first = 3, next = 5, rest = 10 } = {}) {
  const ranked = prioritize(findings);
  return {
    ranked,
    "24-48h": ranked.slice(0, first),
    "7d": ranked.slice(first, first + next),
    "30d": ranked.slice(first + next, first + next + rest),
  };
}
