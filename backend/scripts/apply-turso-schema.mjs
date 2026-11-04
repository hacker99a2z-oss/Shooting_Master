import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
const url=process.env.TURSO_DATABASE_URL,authToken=process.env.TURSO_AUTH_TOKEN;
if(!url||!authToken){console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");process.exit(1);}
const db=createClient({url,authToken});
try{const sql=await readFile(new URL("../migrations/0001_initial.sql",import.meta.url),"utf8");await db.executeMultiple(sql);console.log("Turso schema migration 0001 applied.");}
finally{db.close();}
