import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

dotenv.config();

import { db } from "./db/db.js";
import { seed } from "./db/seed.js";
import sellerRoutes from "./routes/seller.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.join(__dirname, "../../frontend/dist");

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

// Sirve el frontend ya compilado (frontend/dist) desde el mismo servicio, para
// desplegar backend + dashboard como un solo servicio web (ej. Render).
// En desarrollo local ese directorio no existe todavía (se usa `npm run dev`
// del frontend con su propio servidor Vite), así que esto es un no-op ahí.
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Account Audit backend escuchando en http://localhost:${PORT}`);
});
