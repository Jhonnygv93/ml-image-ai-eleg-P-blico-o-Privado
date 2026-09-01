# Auditoría de Cuentas MercadoLibre

Aplicación de diagnóstico avanzado de cuentas de sellers en MercadoLibre:
KPIs, motor de reglas, score 0-100 por categoría, clasificación automática de
publicaciones, plan de acción priorizado, capa de interpretación con IA y
generación de informe en PDF.

Implementa el MVP descrito en la propuesta de arquitectura: **dashboard
ejecutivo → ventas → publicaciones → conversión → stock → reputación →
score → recomendaciones → plan de acción 30 días → PDF**, con soporte para
manejar varias cuentas de sellers desde una misma pantalla.

## Modo demo (sin credenciales)

Esta app corre out-of-the-box con **datos demo sembrados** (2 sellers,
14 publicaciones, 90 días de histórico con patrones reales: una publicación
"estrella", una "oportunidad" de conversión alta con poco tráfico, un
"problema" de conversión, riesgo de quiebre de stock, campaña de Ads no
rentable, etc.) para que todo el pipeline —analítica, reglas, scoring, IA,
PDF— se pueda ver funcionando sin necesitar credenciales reales todavía.

```bash
# Backend
cd backend
npm install
npm start          # http://localhost:3001 (siembra datos demo automáticamente)

# Frontend (en otra terminal)
cd frontend
npm install
npm run dev         # http://localhost:5173
```

Sin `OPENAI_API_KEY`, la sección "Diagnóstico IA" y "Pregúntale a tu cuenta"
igual funcionan, usando texto redactado a partir de las mismas reglas
(nunca inventan números: los cálculos siempre vienen del motor de
analítica/reglas, la IA solo interpreta).

## Arquitectura

```
account-audit/
  backend/
    src/
      db/          esquema SQLite + histórico (sellers, items, sales, visits,
                    ads, inventory, reputation, competitors) + seed demo
      ml/           cliente real de la API de MercadoLibre + OAuth
                    (listo para conectar credenciales reales, no se usa en demo)
      services/
        analytics.js    KPIs, comparaciones 7/15/30/60/90d, concentración de
                         facturación, cobertura de stock, ROAS/ACOS, reputación
        rules.js         motor de reglas (SI/ENTONCES) + matriz de
                         clasificación de publicaciones (⭐💎⚠️💤❌)
        scoring.js       score 0-100 por categoría + score general ponderado
        priorities.js    impacto x urgencia x facilidad -> plan de acción
        ai.js            capa de interpretación IA con fallback a reglas
        pdf.js           informe PDF completo
        diagnosis.js     compone todo lo anterior (fuente única de verdad)
      routes/seller.js  API REST
  frontend/           dashboard React (Vite)
```

Principio clave (sección 12 de la propuesta): **la IA nunca calcula
números** — todos los KPIs, scores y hallazgos los calcula código
determinístico y testeable en `services/`; la IA (u opcionalmente las
plantillas de fallback) solo los interpreta y redacta.

## API

- `GET /api/sellers` — listado de cuentas con score general (para manejar
  varias cuentas desde una pantalla).
- `GET /api/sellers/:id/dashboard` — diagnóstico completo: KPIs, scores,
  clasificación de publicaciones, problemas, oportunidades, plan de acción,
  narrativa de IA.
- `GET /api/sellers/:id/items` — detalle y "Publication Score" por
  publicación.
- `POST /api/sellers/:id/ask` — `{ "question": "..." }`, responde usando los
  datos reales de la cuenta ("Pregúntale a tu cuenta").
- `GET /api/sellers/:id/report.pdf` — informe PDF descargable.
- `GET /api/ml/oauth/url`, `GET /api/ml/oauth/callback` — flujo OAuth real
  contra MercadoLibre (requiere credenciales, ver abajo).

## Conectar una cuenta real de MercadoLibre

1. Registrá una app en el [portal de Developers de MercadoLibre](https://developers.mercadolibre.com/).
2. Completá `backend/.env` (copiando `.env.example`) con `ML_CLIENT_ID`,
   `ML_CLIENT_SECRET` y `ML_REDIRECT_URI`.
3. `src/ml/oauth.js` y `src/ml/client.js` ya implementan el intercambio de
   `code` por `access_token`/`refresh_token` y los fetchers de items,
   órdenes, visitas, preguntas y reputación.
4. Falta el paso de sincronización (`services/sync.js`, no incluido en este
   MVP): un job que llame a `ml/client.js` y escriba en las mismas tablas
   que hoy llena `db/seed.js`, para reemplazar los datos demo por datos
   reales sin tocar analytics/rules/scoring/pdf.
5. La integración de **Mercado Ads** requiere el permiso "advertising"
   habilitado para la app (endpoint distinto, no cubierto todavía —
   `ml/client.js#getAdsCampaigns` queda como stub).

## Qué falta para producción (fuera del alcance de este MVP)

- Job de sincronización real desde la API de MercadoLibre (reemplaza el seed).
- Autenticación de usuarios/gestores de la app (hoy no hay login).
- Persistir histórico de recomendaciones (la tabla `recommendations` ya
  existe en el esquema; hoy el dashboard las calcula al vuelo).
- Migrar de SQLite a PostgreSQL si el volumen de cuentas/publicaciones lo
  justifica (el código de `services/` no depende de SQLite específicamente
  más que en `db/db.js`).
- Índice competitivo real (hoy usa una tabla `competitors` que se carga a
  mano/demo; en producción requiere scraping o una fuente de datos de
  competencia).
