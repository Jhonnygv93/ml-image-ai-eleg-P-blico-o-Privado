import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import { db } from "./db/db.js";
import { seed } from "./db/seed.js";
import sellerRoutes from "./routes/seller.js";

if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️  OPENAI_API_KEY no está definida: las interpretaciones usarán texto basado en reglas en vez de IA.");
}
if (!process.env.ML_CLIENT_ID) {
  console.warn("⚠️  Sin credenciales de MercadoLibre: la app corre en modo demo con datos sembrados.");
}

const sellerCount = db.prepare("SELECT COUNT(*) AS n FROM sellers").get().n;
if (sellerCount === 0) {
  console.log("Base de datos vacía, sembrando datos demo...");
  seed();
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api", sellerRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Account Audit backend escuchando en http://localhost:${PORT}`);
});
