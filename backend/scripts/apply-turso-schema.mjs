import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";

// Read local-only Worker variables for manual migration runs.
try {
  const local = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
  for (const line of local.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    const key = match && match[1];
    if (key && process.env[key] === undefined) {
      process.env[key] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // CI injects the required values through the process environment.
}

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");
  process.exit(1);
}

const db = createClient({ url, authToken });
try {
  const initialSql = await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
  await db.executeMultiple(initialSql);
  console.log("Turso schema migration 0001 applied.");

  const referralIndexSql = await readFile(new URL("../migrations/0002_referral_index.sql", import.meta.url), "utf8");
  await db.executeMultiple(referralIndexSql);
  console.log("Turso schema migration 0002 applied.");
} finally {
  db.close();
}
