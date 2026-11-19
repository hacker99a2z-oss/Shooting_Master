import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";

// Migration 0005 is intentionally idempotent. Re-run CREATE TABLE IF NOT EXISTS
// even when its version marker exists, so a missing queue table can be repaired
// without touching existing payout jobs or lock state.
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) throw new Error("Turso database credentials are required");

const db = createClient({ url, authToken });
try {
  const sql = await readFile(new URL("../migrations/0005_render_payout_queue.sql", import.meta.url), "utf8");
  await db.executeMultiple(sql);
  console.info("Turso migration 0005 verified and Render payout queue tables ensured.");
} finally {
  db.close();
}
