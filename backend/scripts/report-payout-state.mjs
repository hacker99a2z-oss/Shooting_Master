import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) throw new Error("Turso credentials are required");

const db = createClient({ url, authToken });
try {
  const [withdrawals, renderJobs, payoutEvents, workerLock] = await Promise.all([
    db.execute("SELECT status, COUNT(*) AS count FROM withdrawals GROUP BY status ORDER BY status"),
    db.execute("SELECT status, COUNT(*) AS count FROM render_payout_jobs GROUP BY status ORDER BY status"),
    db.execute("SELECT event_type, COUNT(*) AS count FROM payout_events GROUP BY event_type ORDER BY event_type"),
    db.execute("SELECT CASE WHEN lease_until > ? THEN 'held' ELSE 'clear' END AS lease_state FROM render_payout_worker_lock WHERE id = 'ton-wallet' LIMIT 1", [Date.now()]),
  ]);

  const summarize = (rows, key) => Object.fromEntries(
    rows.map((row) => [String(row[key]), Number(row.count)])
  );

  const report = {
    withdrawalsByStatus: summarize(withdrawals.rows, "status"),
    renderQueueByStatus: summarize(renderJobs.rows, "status"),
    payoutEventsByType: summarize(payoutEvents.rows, "event_type"),
    renderTreasuryLease: workerLock.rows[0]?.lease_state ?? "missing",
  };
  console.log("[payout-audit] Aggregate-only report (no user data):");
  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}
