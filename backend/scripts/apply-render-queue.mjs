import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) throw new Error("Turso database credentials are required");

const db = createClient({ url, authToken });
try {
  const current = await db.execute("SELECT version FROM schema_migrations WHERE version = 5 LIMIT 1");
  if (!current.rows.length) {
    const sql = await readFile(new URL("../migrations/0005_render_payout_queue.sql", import.meta.url), "utf8");
    await db.executeMultiple(sql);
    console.info("Turso migration 0005 applied.");
  } else {
    console.info("Turso migration 0005 already applied.");
  }
} finally {
  db.close();
}
