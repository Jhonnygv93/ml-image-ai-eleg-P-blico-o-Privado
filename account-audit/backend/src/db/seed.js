// Genera datos demo realistas (90 días) para poder mostrar el pipeline
// completo -analítica, motor de reglas, scoring, IA, PDF- sin necesitar
// credenciales reales de la API de MercadoLibre todavía.
//
// El diseño de cada publicación es intencional: hay una "estrella", una
// "oportunidad", un "problema" de conversión, una "dormida", una "crítica",
// un riesgo de quiebre de stock y una campaña de ads no rentable, para que
// el motor de reglas tenga algo real que detectar.

import { db } from "./db.js";

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260901);
const ri = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const rf = (min, max, decimals = 2) => Number((rand() * (max - min) + min).toFixed(decimals));

const DAYS = 90;
function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function clearAll() {
  const tables = [
    "recommendations",
    "competitors",
    "reputation",
    "inventory",
    "ads",
    "visits",
    "sales",
    "items",
    "sellers",
  ];
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
}

const insertSeller = db.prepare(
  `INSERT INTO sellers (seller_id, nickname, site_id, reputation_tier, is_demo) VALUES (?, ?, ?, ?, 1)`
);
const insertItem = db.prepare(
  `INSERT INTO items (item_id, seller_id, title, category, price, base_cost, status, has_full, free_shipping, photos_count, catalog)
   VALUES (@item_id, @seller_id, @title, @category, @price, @base_cost, 'active', @has_full, @free_shipping, @photos_count, @catalog)`
);
const insertSale = db.prepare(`INSERT INTO sales (item_id, date, units, revenue, orders) VALUES (?, ?, ?, ?, ?)`);
const insertVisit = db.prepare(`INSERT INTO visits (item_id, date, visits) VALUES (?, ?, ?)`);
const insertAd = db.prepare(
  `INSERT INTO ads (item_id, date, investment, impressions, clicks, ad_sales, ad_units) VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const insertInventory = db.prepare(`INSERT INTO inventory (item_id, date, stock) VALUES (?, ?, ?)`);
const insertReputation = db.prepare(
  `INSERT INTO reputation (seller_id, date, claims, cancellations, delays, returns, return_reason_mismatch, return_reason_size, return_reason_quality, reputation_score)
   VALUES (@seller_id, @date, @claims, @cancellations, @delays, @returns, @return_reason_mismatch, @return_reason_size, @return_reason_quality, @reputation_score)`
);
const insertCompetitor = db.prepare(
  `INSERT INTO competitors (item_id, competitor_price, has_full, free_shipping, reputation, sold_qty) VALUES (?, ?, ?, ?, ?, ?)`
);

/**
 * archetype controla cómo evolucionan visitas/conversión en los últimos 14
 * días vs. los 76 anteriores, para que el motor de reglas tenga patrones
 * reales que detectar (no solo ruido aleatorio).
 */
function seedItemHistory(itemId, { basePrice, baseVisits, baseConversion, archetype, stockStart, dailySalesForStock, adsDaily }) {
  for (let d = DAYS - 1; d >= 0; d--) {
    const date = dateStr(d);
    const recent = d < 14; // ventana "reciente" para simular quiebres de tendencia

    let visits = baseVisits * rf(0.85, 1.15);
    let conversion = baseConversion * rf(0.85, 1.15);

    if (archetype === "problema_conversion" && recent) {
      // visitas se mantienen, conversión se derrumba
      conversion = baseConversion * rf(0.35, 0.55);
    }
    if (archetype === "problema_trafico" && recent) {
      // conversión estable, visitas caen fuerte
      visits = baseVisits * rf(0.4, 0.6);
    }
    if (archetype === "estrella") {
      visits = baseVisits * rf(0.95, 1.3);
      conversion = baseConversion * rf(0.95, 1.2);
    }
    if (archetype === "dormida") {
      visits = baseVisits * rf(0.7, 1.1);
    }
    if (archetype === "critica") {
      visits = baseVisits * rf(0.6, 1.1);
      conversion = baseConversion * rf(0.5, 1.0);
    }

    visits = Math.max(0, Math.round(visits));
    const units = Math.max(0, Math.round((visits * conversion) / 100));
    const orders = units > 0 ? Math.max(1, Math.round(units * rf(0.8, 1))) : 0;
    const revenue = Number((units * basePrice).toFixed(2));

    insertVisit.run(itemId, date, visits);
    insertSale.run(itemId, date, units, revenue, orders);

    if (adsDaily) {
      const investment = adsDaily.investment * rf(0.85, 1.15);
      const clicks = Math.max(0, Math.round(visits * rf(0.3, 0.6)));
      const impressions = Math.max(clicks, Math.round(clicks * rf(8, 15)));
      const adUnits = Math.round(units * rf(0.4, 0.7));
      const adSales = Number((adUnits * basePrice).toFixed(2));
      insertAd.run(itemId, date, Number(investment.toFixed(2)), impressions, clicks, adSales, adUnits);
    }

    if (dailySalesForStock !== undefined) {
      // El stock declina en los últimos 30 días hasta llegar HOY a `stockStart`
      // (el nivel de riesgo actual), venía de un nivel ~3x mayor recién repuesto.
      const declineWindow = 30;
      const stock =
        d >= declineWindow
          ? stockStart * 3
          : Math.round(stockStart * (1 + 2 * (d / declineWindow)));
      insertInventory.run(itemId, date, stock);
    } else {
      insertInventory.run(itemId, date, Math.max(0, stockStart - ri(0, 3)));
    }
  }
}

function seedReputation(sellerId) {
  for (let d = DAYS - 1; d >= 0; d--) {
    const date = dateStr(d);
    const claims = ri(0, 4);
    const cancellations = ri(0, 3);
    const delays = ri(0, 2);
    const returns = ri(1, 6);
    const mismatch = Math.round(returns * 0.38);
    const size = Math.round(returns * 0.21);
    const quality = Math.max(0, returns - mismatch - size);
    insertReputation.run({
      seller_id: sellerId,
      date,
      claims,
      cancellations,
      delays,
      returns,
      return_reason_mismatch: mismatch,
      return_reason_size: size,
      return_reason_quality: quality,
      reputation_score: ri(88, 98),
    });
  }
}

export function seed() {
  clearAll();

  // ---- Seller 1: Tienda Andes Home ----
  insertSeller.run("DEMO-SELLER-1", "Tienda Andes Home", "MLC", "green");

  const s1Items = [
    {
      item_id: "MLC-DEMO-1001",
      seller_id: "DEMO-SELLER-1",
      title: "Set de Sábanas Microfibra King 4 Piezas",
      category: "Hogar > Ropa de Cama",
      price: 24990,
      base_cost: 9800,
      has_full: 1,
      free_shipping: 1,
      photos_count: 8,
      catalog: 1,
      cfg: { basePrice: 24990, baseVisits: 480, baseConversion: 4.2, archetype: "estrella", stockStart: 260, adsDaily: { investment: 9000 } },
    },
    {
      item_id: "MLC-DEMO-1002",
      seller_id: "DEMO-SELLER-1",
      title: "Almohada Viscoelástica Cervical Ortopédica",
      category: "Hogar > Ropa de Cama > Almohadas",
      price: 15990,
      base_cost: 6200,
      has_full: 1,
      free_shipping: 1,
      photos_count: 6,
      catalog: 0,
      cfg: { basePrice: 15990, baseVisits: 150, baseConversion: 5.1, archetype: "oportunidad", stockStart: 180, adsDaily: { investment: 1200 } },
    },
    {
      item_id: "MLC-DEMO-1003",
      seller_id: "DEMO-SELLER-1",
      title: "Cortina Blackout Térmica 140x220",
      category: "Hogar > Cortinas",
      price: 18990,
      base_cost: 8100,
      has_full: 0,
      free_shipping: 1,
      photos_count: 4,
      catalog: 0,
      cfg: { basePrice: 18990, baseVisits: 410, baseConversion: 3.6, archetype: "problema_conversion", stockStart: 140 },
    },
    {
      item_id: "MLC-DEMO-1004",
      seller_id: "DEMO-SELLER-1",
      title: "Organizador de Closet Modular 6 Cajones",
      category: "Hogar > Organizadores",
      price: 32990,
      base_cost: 15400,
      has_full: 1,
      free_shipping: 1,
      photos_count: 7,
      catalog: 0,
      cfg: { basePrice: 32990, baseVisits: 260, baseConversion: 4.4, archetype: "problema_trafico", stockStart: 90 },
    },
    {
      item_id: "MLC-DEMO-1005",
      seller_id: "DEMO-SELLER-1",
      title: "Pack 2 Cojines Decorativos Terciopelo",
      category: "Hogar > Decoración",
      price: 12990,
      base_cost: 5300,
      has_full: 0,
      free_shipping: 0,
      photos_count: 5,
      catalog: 0,
      cfg: { basePrice: 12990, baseVisits: 60, baseConversion: 4.0, archetype: "dormida", stockStart: 200 },
    },
    {
      item_id: "MLC-DEMO-1006",
      seller_id: "DEMO-SELLER-1",
      title: "Alfombra Sala 160x230 Antideslizante",
      category: "Hogar > Alfombras",
      price: 27990,
      base_cost: 13500,
      has_full: 0,
      free_shipping: 0,
      photos_count: 3,
      catalog: 0,
      cfg: { basePrice: 27990, baseVisits: 40, baseConversion: 1.1, archetype: "critica", stockStart: 55 },
    },
    {
      item_id: "MLC-DEMO-1007",
      seller_id: "DEMO-SELLER-1",
      title: "Shampoo Seco Multiuso Pack x2",
      category: "Belleza > Cabello",
      price: 8990,
      base_cost: 3100,
      has_full: 1,
      free_shipping: 1,
      photos_count: 6,
      catalog: 1,
      // venta diaria alta y poco stock: gatilla riesgo de quiebre
      cfg: { basePrice: 8990, baseVisits: 300, baseConversion: 6.5, archetype: "estrella", stockStart: 180, dailySalesForStock: 5.3 },
    },
    {
      item_id: "MLC-DEMO-1008",
      seller_id: "DEMO-SELLER-1",
      title: "Difusor Aromático Ultrasónico 500ml",
      category: "Hogar > Ambientadores",
      price: 16990,
      base_cost: 7000,
      has_full: 0,
      free_shipping: 1,
      photos_count: 5,
      catalog: 0,
      // ads con ROAS bajo respecto al margen -> no rentable
      cfg: { basePrice: 16990, baseVisits: 220, baseConversion: 2.4, archetype: "normal", stockStart: 130, adsDaily: { investment: 21000 } },
    },
  ];

  for (const it of s1Items) {
    insertItem.run(it);
    seedItemHistory(it.item_id, { basePrice: it.cfg.basePrice, ...it.cfg });
  }
  seedReputation("DEMO-SELLER-1");

  insertCompetitor.run("MLC-DEMO-1001", 22990, 1, 1, 5, 5400);
  insertCompetitor.run("MLC-DEMO-1003", 15990, 1, 1, 5, 3100);
  insertCompetitor.run("MLC-DEMO-1006", 19990, 1, 1, 5, 2200);

  // ---- Seller 2: ElectroMax CL ----
  insertSeller.run("DEMO-SELLER-2", "ElectroMax CL", "MLC", "yellow");

  const s2Items = [
    {
      item_id: "MLC-DEMO-2001",
      seller_id: "DEMO-SELLER-2",
      title: "Audífonos Bluetooth TWS Cancelación de Ruido",
      category: "Electrónica > Audio",
      price: 34990,
      base_cost: 17500,
      has_full: 1,
      free_shipping: 1,
      photos_count: 9,
      catalog: 1,
      cfg: { basePrice: 34990, baseVisits: 620, baseConversion: 3.8, archetype: "estrella", stockStart: 210, adsDaily: { investment: 15000 } },
    },
    {
      item_id: "MLC-DEMO-2002",
      seller_id: "DEMO-SELLER-2",
      title: "Cargador Rápido USB-C 65W GaN",
      category: "Electrónica > Accesorios",
      price: 14990,
      base_cost: 6100,
      has_full: 1,
      free_shipping: 1,
      photos_count: 6,
      catalog: 1,
      cfg: { basePrice: 14990, baseVisits: 130, baseConversion: 5.6, archetype: "oportunidad", stockStart: 300, adsDaily: { investment: 900 } },
    },
    {
      item_id: "MLC-DEMO-2003",
      seller_id: "DEMO-SELLER-2",
      title: "Mouse Gamer RGB 12000 DPI",
      category: "Electrónica > Periféricos",
      price: 19990,
      base_cost: 9200,
      has_full: 0,
      free_shipping: 1,
      photos_count: 4,
      catalog: 0,
      cfg: { basePrice: 19990, baseVisits: 380, baseConversion: 3.1, archetype: "problema_conversion", stockStart: 160 },
    },
    {
      item_id: "MLC-DEMO-2004",
      seller_id: "DEMO-SELLER-2",
      title: "Power Bank 20000mAh Carga Rápida",
      category: "Electrónica > Baterías",
      price: 22990,
      base_cost: 10800,
      has_full: 1,
      free_shipping: 1,
      photos_count: 7,
      catalog: 0,
      cfg: { basePrice: 22990, baseVisits: 300, baseConversion: 4.0, archetype: "problema_trafico", stockStart: 120 },
    },
    {
      item_id: "MLC-DEMO-2005",
      seller_id: "DEMO-SELLER-2",
      title: "Soporte de Notebook Aluminio Ajustable",
      category: "Electrónica > Accesorios",
      price: 13990,
      base_cost: 5900,
      has_full: 0,
      free_shipping: 0,
      photos_count: 5,
      catalog: 0,
      cfg: { basePrice: 13990, baseVisits: 45, baseConversion: 4.2, archetype: "dormida", stockStart: 90 },
    },
    {
      item_id: "MLC-DEMO-2006",
      seller_id: "DEMO-SELLER-2",
      title: "Hub USB 7 Puertos 3.0",
      category: "Electrónica > Accesorios",
      price: 9990,
      base_cost: 4600,
      has_full: 0,
      free_shipping: 0,
      photos_count: 2,
      catalog: 0,
      cfg: { basePrice: 9990, baseVisits: 35, baseConversion: 0.9, archetype: "critica", stockStart: 70 },
    },
  ];

  for (const it of s2Items) {
    insertItem.run(it);
    seedItemHistory(it.item_id, { basePrice: it.cfg.basePrice, ...it.cfg });
  }
  seedReputation("DEMO-SELLER-2");

  insertCompetitor.run("MLC-DEMO-2001", 31990, 1, 1, 5, 8900);
  insertCompetitor.run("MLC-DEMO-2003", 17990, 1, 1, 5, 4100);

  console.log("Datos demo sembrados: 2 sellers, %d + %d publicaciones, %d días de histórico.", s1Items.length, s2Items.length, DAYS);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  seed();
  console.log("Listo.");
}
