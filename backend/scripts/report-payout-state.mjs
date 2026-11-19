import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) throw new Error("Turso credentials are required");

const db = createClient({ url, authToken });
try {
  const [withdrawals, renderJobs, payoutEvents, workerLock, manualReviews] = await Promise.all([
    db.execute("SELECT status, COUNT(*) AS count FROM withdrawals GROUP BY status ORDER BY status"),
    db.execute("SELECT status, COUNT(*) AS count FROM render_payout_jobs GROUP BY status ORDER BY status"),
    db.execute("SELECT event_type, COUNT(*) AS count FROM payout_events GROUP BY event_type ORDER BY event_type"),
    db.execute("SELECT CASE WHEN lease_until > ? THEN 'held' ELSE 'clear' END AS lease_state FROM render_payout_worker_lock WHERE id = 'ton-wallet' LIMIT 1", [Date.now()]),
    db.execute("SELECT status, COALESCE(payout_error, '(no recorded reason)') AS reason, CASE WHEN payout_tx_hash IS NULL THEN 'no_transaction_hash' ELSE 'transaction_hash_present' END AS tx_state, COUNT(*) AS count FROM withdrawals WHERE status IN ('pending_review','payout_failed_review') GROUP BY status, payout_error, tx_state ORDER BY status, payout_error"),
  ]);

  const summarize = (rows, key) => Object.fromEntries(
    rows.map((row) => [String(row[key]), Number(row.count)])
  );

  const report = {
    withdrawalsByStatus: summarize(withdrawals.rows, "status"),
    renderQueueByStatus: summarize(renderJobs.rows, "status"),
    payoutEventsByType: summarize(payoutEvents.rows, "event_type"),
    manualReviews: manualReviews.rows.map((row) => ({
      status: String(row.status),
      reason: String(row.reason).slice(0, 200),
      transaction: String(row.tx_state),
      count: Number(row.count),
    })),
    renderTreasuryLease: workerLock.rows[0]?.lease_state ?? "missing",
  };
  console.log("[payout-audit] Aggregate-only report (no user data):");
  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}
