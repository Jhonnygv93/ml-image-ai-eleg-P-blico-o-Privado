import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import generateRoutes from "./routes/generate.js";

dotenv.config();

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "⚠️  OPENAI_API_KEY no está definida. Copiá .env.example a .env y pegá tu API key."
  );
}

const app = express();

// En producción: restringir a chrome-extension://<TU_ID_DE_EXTENSIÓN> en vez de cors() abierto.
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api", generateRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ML Image AI backend escuchando en http://localhost:${PORT}`);
});
