import { useEffect, useState, Fragment } from "react";
import { listSellers, getDashboard, askAccount, reportUrl } from "./api.js";

const money = (v) => `$${Math.round(v).toLocaleString("es-CL")}`;

function scoreColor(score) {
  if (score >= 80) return "var(--good)";
  if (score >= 60) return "var(--warning)";
  return "var(--critical)";
}

function Delta({ value }) {
  if (value > 0) return <span className="delta delta-up">▲ +{value}%</span>;
  if (value < 0) return <span className="delta delta-down">▼ {value}%</span>;
  return <span className="delta delta-flat">— 0%</span>;
}

function CategoryScores({ categories }) {
  return (
    <div className="cat-grid">
      {Object.entries(categories).map(([cat, val]) => (
        <div className="cat-tile" key={cat}>
          <div className="cat-label">{cat}</div>
          <div className="cat-value">{val}/100</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${val}%`, background: scoreColor(val) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function KpiGrid({ k30 }) {
  const rows = [
    ["Facturación", money(k30.revenue), k30.revenueChangePct],
    ["Unidades", k30.units, k30.unitsChangePct],
    ["Órdenes", k30.orders, k30.ordersChangePct],
    ["Visitas", k30.visits, k30.visitsChangePct],
    ["Conversión", `${k30.conversion}%`, k30.conversionChangePct],
    ["Ticket promedio", money(k30.avgTicket), k30.avgTicketChangePct],
  ];
  return (
    <div className="kpi-grid">
      {rows.map(([label, value, delta]) => (
        <div className="kpi-tile" key={label}>
          <div className="kpi-label">{label}</div>
          <div className="kpi-value">{value}</div>
          <Delta value={delta} />
        </div>
      ))}
    </div>
  );
}

const REPUTATION_TIER = {
  verde: { color: "var(--good)", label: "Verde" },
  amarillo: { color: "var(--warning)", label: "Amarillo" },
  rojo: { color: "var(--critical)", label: "Rojo" },
  "sin-datos": { color: "var(--text-muted)", label: "Sin datos" },
};

function ReputationWidget({ reputation, expanded, onToggle }) {
  const tier = REPUTATION_TIER[reputation.tier] || REPUTATION_TIER["sin-datos"];
  const stats = [
    ["Reclamos", reputation.claimsRate, "% de tus ventas del período con un reclamo abierto."],
    ["Canceladas por ti", reputation.cancellationRate, "% de tus ventas que vos cancelaste."],
    ["Envíos incorrectos", reputation.delayRate, "% de tus ventas con problemas de despacho (según la métrica delayed_handling_time de MercadoLibre)."],
  ];
  return (
    <div className="reputation-card" onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onToggle()}>
      <div className="reputation-header">
        <span className="reputation-dot" style={{ background: tier.color }} />
        <span style={{ fontWeight: 700, color: tier.color }}>{tier.label}</span>
      </div>
      <div className="reputation-stats">
        {stats.map(([label, value, hint]) => (
          <div className="reputation-stat" key={label} title={hint}>
            <div className="reputation-stat-value">{value}%</div>
            <div className="reputation-stat-label">{label}</div>
          </div>
        ))}
      </div>
      <div className="detail-toggle">{expanded ? "Ocultar detalle ▲" : "Ver detalle ▸"}</div>
    </div>
  );
}

function ReputationDetail({ reputation }) {
  const tier = REPUTATION_TIER[reputation.tier] || REPUTATION_TIER["sin-datos"];
  const cards = [
    ["Reclamos", reputation.claims, reputation.claimsRate, reputation.claimsChangePct],
    ["Canceladas por ti", reputation.cancellations, reputation.cancellationRate, reputation.cancellationsChangePct],
    ["Envíos incorrectos", reputation.delays, reputation.delayRate, reputation.delaysChangePct],
  ];
  const reasons = [
    ["Producto distinto al esperado", reputation.returnReasons.mismatchPct],
    ["Talla/medidas incorrectas", reputation.returnReasons.sizePct],
    ["Problema de calidad", reputation.returnReasons.qualityPct],
  ];
  return (
    <div className="reputation-detail">
      <div className="reputation-gauge">
        <div className="bar-track">
          <div className="bar-fill" style={{ width: "100%", background: tier.color }} />
        </div>
        <div style={{ marginTop: 6, fontSize: 13 }}>
          Tenés color <strong style={{ color: tier.color }}>{tier.label}</strong> · medido sobre los últimos {reputation.windowDays} días · {reputation.orders} ventas en el período
        </div>
      </div>

      <div className="reputation-metric-grid">
        {cards.map(([label, count, rate, changePct]) => (
          <div className="reputation-metric-card" key={label}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value">{rate}%</div>
            <Delta value={changePct} />
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{count} de {reputation.orders} ventas</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <h4 style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px" }}>Tu desempeño</h4>
        <div className="reputation-metric-grid">
          <div className="reputation-metric-card">
            <div className="kpi-label">Facturado</div>
            <div className="kpi-value">{money(reputation.revenue)}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>en ventas del período</div>
          </div>
          <div className="reputation-metric-card">
            <div className="kpi-label">Ventas concretadas</div>
            <div className="kpi-value">{reputation.orders}</div>
          </div>
          <div className="reputation-metric-card">
            <div className="kpi-label">Sin reclamos</div>
            <div className="kpi-value">{reputation.salesWithoutClaims}</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <h4 style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 8px" }}>Motivos de devolución</h4>
        {reputation.returns === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Sin devoluciones registradas en el período.</p>
        ) : (
          reasons.map(([label, pct]) => (
            <div key={label} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                <span>{label}</span>
                <span className="num">{pct}%</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${pct}%`, background: "var(--series-1)" }} />
              </div>
            </div>
          ))
        )}
      </div>

      <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 14 }}>
        Nota: la API pública de MercadoLibre no expone el mismo detalle que el panel oficial del vendedor (por ejemplo,
        no desglosa devoluciones por causa ni publicaciones con más problemas). Estos números se calculan con lo que
        la API sí expone: reclamos, cancelaciones y demoras de despacho.
      </p>
    </div>
  );
}

function ListingTypeBreakdown({ listingTypes }) {
  if (!listingTypes || listingTypes.total === 0) return null;
  const rows = [
    ["Catálogo", listingTypes.catalogCount, listingTypes.catalogPct],
    ["Tradicional", listingTypes.traditionalCount, listingTypes.traditionalPct],
    ["Producto de usuario", listingTypes.userProductCount, listingTypes.userProductPct],
  ];
  return (
    <div className="kpi-grid">
      {rows.map(([label, count, pct]) => (
        <div className="kpi-tile" key={label}>
          <div className="kpi-label">{label}</div>
          <div className="kpi-value">{count}</div>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{pct}% del total</span>
        </div>
      ))}
      <div className="kpi-tile">
        <div className="kpi-label">Total activas</div>
        <div className="kpi-value">{listingTypes.total}</div>
      </div>
    </div>
  );
}

function FindingsColumn({ title, findings, tone }) {
  return (
    <div>
      <h3>{title}</h3>
      {findings.length === 0 && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Sin hallazgos.</p>}
      {findings.map((f) => (
        <div className={`finding-card ${tone}`} key={f.id}>
          <div className="finding-title">{f.title}</div>
          <div className="finding-detail">{f.detail}</div>
        </div>
      ))}
    </div>
  );
}

const TYPE_BADGE = {
  "⭐ Estrella": "badge-good",
  "💎 Oportunidad": "badge-series1",
  "⚠️ Problema": "badge-critical",
  "💤 Dormida": "badge-warning",
  "❌ Crítica": "badge-critical",
  "🟦 Regular": "badge-muted",
};

const LISTING_TYPE_LABEL = {
  catalogo: "Catálogo",
  tradicional: "Tradicional",
  producto_usuario: "Producto de usuario",
};
const LISTING_TYPE_BADGE = {
  catalogo: "badge-series1",
  tradicional: "badge-muted",
  producto_usuario: "badge-warning",
};

function ClassificationTable({ classification }) {
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>Clasificación</th>
            <th>Publicación</th>
            <th>Visitas (14d)</th>
            <th>Conversión</th>
            <th>Ventas</th>
            <th>Acción</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {classification.map((c) => {
            const isOpen = expandedId === c.itemId;
            return (
              <Fragment key={c.itemId}>
                <tr onClick={() => setExpandedId(isOpen ? null : c.itemId)} style={{ cursor: "pointer" }}>
                  <td>
                    <span className={`badge ${TYPE_BADGE[c.tipo] || "badge-muted"}`}>{c.tipo}</span>
                  </td>
                  <td>
                    {c.permalink ? (
                      <a
                        href={c.permalink}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: "var(--series-1)", fontWeight: 600, textDecoration: "none" }}
                      >
                        {c.title} ↗
                      </a>
                    ) : (
                      c.title
                    )}
                  </td>
                  <td className="num">{c.visitas}</td>
                  <td className="num">{c.conversion}%</td>
                  <td className="num">{c.ventas}u</td>
                  <td>{c.accion}</td>
                  <td style={{ color: "var(--text-muted)" }}>{isOpen ? "▲" : "▼"}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={7} style={{ background: "var(--surface-2)" }}>
                      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", padding: "10px 4px", fontSize: 12.5 }}>
                        <div>
                          <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>Tipo de publicación</div>
                          <span className={`badge ${LISTING_TYPE_BADGE[c.listingType] || "badge-muted"}`}>
                            {LISTING_TYPE_LABEL[c.listingType] || "—"}
                          </span>
                        </div>
                        <div>
                          <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>Variantes</div>
                          <strong>{c.variationsCount > 0 ? `${c.variationsCount} variantes` : "0 variantes"}</strong>
                        </div>
                        <div>
                          <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>Precio</div>
                          <strong>{money(c.precio)}</strong>
                        </div>
                        {c.permalink && (
                          <div>
                            <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>&nbsp;</div>
                            <a href={c.permalink} target="_blank" rel="noreferrer" className="btn" style={{ padding: "4px 10px", fontSize: 12 }}>
                              Ver en MercadoLibre ↗
                            </a>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClassificationPanel({ classification }) {
  const [expanded, setExpanded] = useState(false);
  const [filterType, setFilterType] = useState(null);

  const counts = {};
  for (const c of classification) counts[c.tipo] = (counts[c.tipo] || 0) + 1;
  const types = Object.keys(counts);
  const filtered = filterType ? classification.filter((c) => c.tipo === filterType) : classification;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, cursor: "pointer" }} onClick={() => setExpanded((v) => !v)}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {types.map((t) => (
            <span
              key={t}
              className={`badge ${TYPE_BADGE[t] || "badge-muted"}`}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
                setFilterType((cur) => (cur === t ? null : t));
              }}
              style={{ cursor: "pointer", boxShadow: filterType === t ? "0 0 0 2px var(--series-1)" : "none" }}
              title={`Filtrar por ${t}`}
            >
              {t} {counts[t]}
            </span>
          ))}
        </div>
        <span className="detail-toggle">{expanded ? "Ocultar detalle ▲" : "Ver detalle ▸"}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 14 }}>
          {filterType && (
            <button
              type="button"
              className="btn"
              style={{ marginBottom: 10, fontSize: 12, padding: "5px 10px" }}
              onClick={() => setFilterType(null)}
            >
              Quitar filtro: {filterType} ✕
            </button>
          )}
          <ClassificationTable classification={filtered} />
        </div>
      )}
    </div>
  );
}

const PRIORITY_BADGE = { alta: "badge-critical", media: "badge-warning", baja: "badge-muted" };

function ActionPlan({ actionPlan }) {
  const cols = [
    ["24-48h", "Próximas 24-48 horas"],
    ["7d", "Próximos 7 días"],
    ["30d", "Próximos 30 días"],
  ];
  return (
    <div className="plan-cols">
      {cols.map(([key, label]) => (
        <div className="plan-col" key={key}>
          <h4>{label}</h4>
          {actionPlan[key].length === 0 && <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Sin acciones.</p>}
          {actionPlan[key].map((f) => (
            <div className="plan-item" key={f.id}>
              <span className={`badge ${PRIORITY_BADGE[f.priorityBand]}`}>{f.priorityBand}</span>
              <div className="plan-title">{f.title}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function AskAccount({ sellerId }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    try {
      const res = await askAccount(sellerId, question);
      setAnswer(res.answer);
    } catch (err) {
      setAnswer(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ask-box">
      <form onSubmit={submit}>
        <textarea
          placeholder="Ej: ¿Por qué bajaron mis ventas? ¿Dónde debería invertir en publicidad?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Pensando…" : "Preguntar"}
          </button>
        </div>
      </form>
      {answer && <div className="ask-answer">{answer}</div>}
    </div>
  );
}

function Dashboard({ sellerId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reputationExpanded, setReputationExpanded] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    setReputationExpanded(false);
    getDashboard(sellerId).then(setData).catch((err) => setError(err.message));
  }, [sellerId]);

  if (error) return <div className="error-box">Error cargando el diagnóstico: {error}</div>;
  if (!data) return <div className="loading">Calculando diagnóstico…</div>;

  const k30 = data.kpis[30];

  return (
    <>
      <div className="page-header">
        <div>
          <h2>{data.seller.nickname}</h2>
          <div className="site">Sitio {data.seller.site_id} · Conectada {new Date(data.seller.connected_at).toLocaleDateString("es-CL")}</div>
        </div>
        <a className="btn btn-primary" href={reportUrl(sellerId)}>
          ⬇ Descargar informe PDF
        </a>
      </div>

      <div className="hero-score">
        <div className="value" style={{ color: scoreColor(data.scores.overall) }}>
          {data.scores.overall}
          <span style={{ fontSize: 20, color: "var(--text-muted)" }}>/100</span>
        </div>
        <div>
          <div className="health-label">
            {data.scores.health.emoji} {data.scores.health.label}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Salud general de la cuenta</div>
        </div>
      </div>

      <section className="panel">
        <h3>Score por categoría</h3>
        <CategoryScores categories={data.scores.categories} />
      </section>

      <section className="panel">
        <h3>Reputación</h3>
        <ReputationWidget
          reputation={data.reputation}
          expanded={reputationExpanded}
          onToggle={() => setReputationExpanded((v) => !v)}
        />
        {reputationExpanded && <ReputationDetail reputation={data.reputation} />}
      </section>

      <section className="panel">
        <h3>KPIs — últimos 30 días</h3>
        <KpiGrid k30={k30} />
      </section>

      <section className="panel">
        <h3>Tipo de publicación</h3>
        <ListingTypeBreakdown listingTypes={data.listingTypes} />
      </section>

      <section className="panel">
        <div className="two-col">
          <FindingsColumn title={`Problemas críticos (${data.topProblems.length})`} findings={data.topProblems} tone="problema" />
          <FindingsColumn title={`Oportunidades (${data.topOpportunities.length})`} findings={data.topOpportunities} tone="oportunidad" />
        </div>
      </section>

      <section className="panel">
        <h3>Diagnóstico de publicaciones</h3>
        <ClassificationPanel classification={data.classification} />
      </section>

      <section className="panel">
        <h3>Plan de acción</h3>
        <ActionPlan actionPlan={data.actionPlan} />
      </section>

      <section className="panel">
        <h3>Diagnóstico IA {data.aiSource !== "openai" && <span style={{ fontWeight: 400, textTransform: "none", color: "var(--text-muted)" }}>(basado en reglas — configurá OPENAI_API_KEY para redacción con IA)</span>}</h3>
        <div className="narrative">{data.aiNarrative}</div>
      </section>

      <section className="panel">
        <h3>Pregúntale a tu cuenta</h3>
        <AskAccount sellerId={sellerId} />
      </section>
    </>
  );
}

export default function App() {
  const [sellers, setSellers] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    listSellers()
      .then((list) => {
        setSellers(list);
        if (list.length) setSelected(list[0].seller_id);
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Auditoría ML</h1>
        <p className="subtitle">Diagnóstico avanzado de cuentas</p>
        {error && <div className="error-box">Error: {error}</div>}
        {sellers === null && !error && <div className="loading">Cargando cuentas…</div>}
        {sellers?.map((s) => (
          <div
            key={s.seller_id}
            className={`seller-item ${s.seller_id === selected ? "active" : ""}`}
            onClick={() => setSelected(s.seller_id)}
          >
            <span className="name">{s.nickname}</span>
            <span className="score-pill" style={{ background: `color-mix(in srgb, ${scoreColor(s.overall)} 18%, transparent)`, color: scoreColor(s.overall) }}>
              {s.overall}
            </span>
          </div>
        ))}
      </aside>
      <main className="main">{selected ? <Dashboard sellerId={selected} /> : <div className="loading">Seleccioná una cuenta…</div>}</main>
    </div>
  );
}
