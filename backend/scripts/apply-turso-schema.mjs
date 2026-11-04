import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";

// Wrangler reads .dev.vars for local Worker execution; this script also reads it
// so local schema setup works without exporting every value in the shell.
try {
  const local = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
  for (const line of local.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]!] === undefined) {
      process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // GitHub Actions supplies credentials through environment variables.
}

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");
  process.exit(1);
}

const db = createClient({ url, authToken });
try {
  const sql = await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
  await db.executeMultiple(sql);
  console.log("Turso schema migration 0001 applied.");
} finally {
  db.close();
}
