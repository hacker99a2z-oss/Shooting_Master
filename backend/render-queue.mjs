import { createClient } from "@libsql/client/web";
import { randomUUID } from "node:crypto";

const LEASE_MS = 120_000;
const MAX_ATTEMPTS = 6;

export function createRenderQueue() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error("Turso credentials are required");
  const db = createClient({ url, authToken });

  async function send(payload) {
    const now = Date.now();
    const withdrawalId = String(payload.withdrawalId);
    await db.execute({
      sql: `INSERT INTO render_payout_jobs
        (id, withdrawal_id, payload, status, attempts, available_at, created_at)
        VALUES (?, ?, ?, 'pending', 0, ?, ?)
        ON CONFLICT(withdrawal_id) DO UPDATE SET
          payload = excluded.payload, status = 'pending', attempts = 0,
          available_at = excluded.available_at, lease_until = NULL,
          owner_token = NULL, last_error = NULL, completed_at = NULL
        WHERE render_payout_jobs.status IN ('completed', 'dead')`,
      args: [randomUUID(), withdrawalId, JSON.stringify(payload), now, new Date(now).toISOString()],
    });
  }

  async function claimNext() {
    const now = Date.now();
    const token = randomUUID();
    const tx = await db.transaction("write");
    try {
      const rows = await tx.execute({
        sql: `SELECT id, payload, attempts FROM render_payout_jobs
          WHERE (status = 'pending' AND available_at <= ?)
             OR (status = 'processing' AND lease_until <= ?)
          ORDER BY created_at, id LIMIT 1`,
        args: [now, now],
      });
      if (!rows.rows.length) {
        await tx.commit();
        return null;
      }
      const row = rows.rows[0];
      const id = String(row.id);
      const updated = await tx.execute({
        sql: `UPDATE render_payout_jobs
          SET status = 'processing', attempts = attempts + 1,
              owner_token = ?, lease_until = ?
          WHERE id = ?
            AND ((status = 'pending' AND available_at <= ?)
              OR (status = 'processing' AND lease_until <= ?))`,
        args: [token, now + LEASE_MS, id, now, now],
      });
      if (updated.rowsAffected !== 1) {
        await tx.commit();
        return null;
      }
      await tx.commit();
      return {
        id,
        token,
        attempts: Number(row.attempts || 0) + 1,
        payload: JSON.parse(String(row.payload)),
      };
    } catch (error) {
      if (!tx.closed) await tx.rollback();
      throw error;
    }
  }

  async function renew(job) {
    const result = await db.execute({
      sql: `UPDATE render_payout_jobs SET lease_until = ?
        WHERE id = ? AND status = 'processing' AND owner_token = ?`,
      args: [Date.now() + LEASE_MS, job.id, job.token],
    });
    return result.rowsAffected === 1;
  }

  async function complete(job) {
    await db.execute({
      sql: `UPDATE render_payout_jobs
        SET status = 'completed', completed_at = ?, lease_until = NULL,
            owner_token = NULL, last_error = NULL
        WHERE id = ? AND status = 'processing' AND owner_token = ?`,
      args: [new Date().toISOString(), job.id, job.token],
    });
  }

  async function retry(job, reason) {
    const now = Date.now();
    const safeReason = String(reason || "Temporary payout processing failure").slice(0, 500);
    if (job.attempts >= MAX_ATTEMPTS) {
      const tx = await db.transaction("write");
      try {
        const updated = await tx.execute({
          sql: `UPDATE render_payout_jobs
            SET status = 'dead', lease_until = NULL, owner_token = NULL, last_error = ?
            WHERE id = ? AND status = 'processing' AND owner_token = ?`,
          args: [safeReason, job.id, job.token],
        });
        if (updated.rowsAffected === 1) {
          await tx.execute({
            sql: `UPDATE withdrawals
              SET status = 'payout_failed_review', payout_error = ?, payout_updated_at = ?
              WHERE id = ? AND status IN ('pending_auto', 'processing')`,
            args: [safeReason, new Date(now).toISOString(), String(job.payload.withdrawalId)],
          });
          await tx.execute({
            sql: `INSERT OR IGNORE INTO payout_events (withdrawal_id, event_type, payload, created_at)
              VALUES (?, 'failed_review', ?, ?)`,
            args: [String(job.payload.withdrawalId), JSON.stringify({ reason: safeReason, at: new Date(now).toISOString() }), new Date(now).toISOString()],
          });
        }
        await tx.commit();
        return "dead";
      } catch (error) {
        if (!tx.closed) await tx.rollback();
        throw error;
      }
    }

    const result = await db.execute({
      sql: `UPDATE render_payout_jobs
        SET status = 'pending', available_at = ?, lease_until = NULL,
            owner_token = NULL, last_error = ?
        WHERE id = ? AND status = 'processing' AND owner_token = ?`,
      args: [now + 60_000, safeReason, job.id, job.token],
    });
    return result.rowsAffected === 1 ? "retry" : "lost";
  }

  return { send, claimNext, renew, complete, retry, close: () => db.close() };
}
