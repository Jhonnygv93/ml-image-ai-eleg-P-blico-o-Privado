import { useEffect, useState } from "react";
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

function ClassificationTable({ classification }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Publicación</th>
            <th>Visitas (14d)</th>
            <th>Conversión</th>
            <th>Ventas</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          {classification.map((c) => (
            <tr key={c.itemId}>
              <td>
                <span className={`badge ${TYPE_BADGE[c.tipo] || "badge-muted"}`}>{c.tipo}</span>
              </td>
              <td>{c.title}</td>
              <td className="num">{c.visitas}</td>
              <td className="num">{c.conversion}%</td>
              <td className="num">{c.ventas}u</td>
              <td>{c.accion}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

  useEffect(() => {
    setData(null);
    setError(null);
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
        <ClassificationTable classification={data.classification} />
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
