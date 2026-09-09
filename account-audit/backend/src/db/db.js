import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.DB_PATH || "./data/account-audit.db";
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

// Migración simple para bases creadas antes de agregar las columnas de token
// real de MercadoLibre a `sellers` (CREATE TABLE IF NOT EXISTS no las agrega
// a una tabla que ya existía).
const sellerColumns = db.prepare("PRAGMA table_info(sellers)").all().map((c) => c.name);
for (const [column, ddl] of [
  ["access_token", "ALTER TABLE sellers ADD COLUMN access_token TEXT"],
  ["refresh_token", "ALTER TABLE sellers ADD COLUMN refresh_token TEXT"],
  ["token_expires_at", "ALTER TABLE sellers ADD COLUMN token_expires_at TEXT"],
  ["last_synced_at", "ALTER TABLE sellers ADD COLUMN last_synced_at TEXT"],
]) {
  if (!sellerColumns.includes(column)) db.exec(ddl);
}

const reputationColumns = db.prepare("PRAGMA table_info(reputation)").all().map((c) => c.name);
for (const [column, ddl] of [
  ["claims_rate", "ALTER TABLE reputation ADD COLUMN claims_rate REAL"],
  ["cancellations_rate", "ALTER TABLE reputation ADD COLUMN cancellations_rate REAL"],
  ["delays_rate", "ALTER TABLE reputation ADD COLUMN delays_rate REAL"],
]) {
  if (!reputationColumns.includes(column)) db.exec(ddl);
}

const itemColumns = db.prepare("PRAGMA table_info(items)").all().map((c) => c.name);
for (const [column, ddl] of [
  ["permalink", "ALTER TABLE items ADD COLUMN permalink TEXT"],
  ["variations_count", "ALTER TABLE items ADD COLUMN variations_count INTEGER DEFAULT 0"],
]) {
  if (!itemColumns.includes(column)) db.exec(ddl);
}
