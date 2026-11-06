# Shooting Master — Render backend migration

## Target architecture

- Cloudflare Pages continues to host the static React/Vite frontend.
- Render Web Service `shooting-master-api` hosts the Node.js HTTP API.
- Render Background Worker `shooting-master-payout-worker` consumes the durable payout queue and runs cleanup/recovery every five minutes.
- Turso remains the source-of-truth database. Migration 0005 adds a durable payout-job table; the queue does not require Redis or Render Key Value.

The existing application/game logic and BEP-20 payout implementation remain in `backend/worker/index.ts`. The Render adapters invoke that shared logic under Node.js 22.

## Render services

The root `render.yaml` defines two Starter services in Singapore:

| Service | Purpose | Initial plan |
| --- | --- | --- |
| `shooting-master-api` | HTTP API, Telegram webhook, AdsGram reward callback | Starter |
| `shooting-master-payout-worker` | Sequential payout queue consumer and five-minute maintenance/recovery | Starter |

The currently published Render Starter compute price is $7/month per continuously running service, so the initial compute estimate is about $14/month before applicable taxes/usage. Plans can be upgraded after load testing. This is not a guarantee that the app supports 50–60k daily active users; test peak concurrency, Turso usage, API latency, and queue throughput before a large launch.

## Initial setup and secrets

1. Create a Render Blueprint from this repository's `render.yaml` in the intended Render workspace.
2. In the `shooting-master-api` Environment page, set:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `TELEGRAM_BOT_TOKEN`
   - `ADSGRAM_REWARD_SECRET`
   - `APP_ORIGIN=https://shooting-master.pages.dev`
   - `PAYOUT_ENABLED=false`
3. In the `shooting-master-payout-worker` Environment page, set:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `APP_ORIGIN=https://shooting-master.pages.dev`
   - `PAYOUT_ENABLED=false`
4. Keep the existing Cloudflare Worker and Pages active while validating Render. The Render API's health endpoint is `/health`.
5. The API registers the Telegram bot webhook to its own Render URL at startup using Render's `RENDER_EXTERNAL_URL` variable.
6. The new backend applies existing migrations 0001–0004 and then idempotently applies migration 0005 before the API service starts.

Never paste wallet keys, bot tokens, Turso credentials, or AdsGram secrets into GitHub source files or chat. Set them only in Render's Environment dashboard.

## Frontend cutover

After the Render API responds successfully at `https://shooting-master-api.onrender.com/health`:

1. Set the GitHub Actions repository variable `VITE_API_BASE_URL` to the exact Render API URL.
2. Change the GitHub Pages deployment workflow to stop deploying the Cloudflare Worker and build the Pages frontend with `VITE_API_BASE_URL`.
3. Deploy Pages and verify game loading, Telegram authentication, AdsGram callback, leaderboard, and withdrawal history.
4. Update the AdsGram Reward URL to the Render API:
   `https://shooting-master-api.onrender.com/api/adsgram/reward?userid=[userId]&key=YOUR_SHARED_SECRET`
5. The API re-registers the Telegram webhook to Render automatically. Verify `/start` in a private Telegram chat.

If Render assigns a different hostname, use the exact service URL shown in the Render Dashboard rather than assuming the example URL above.

## Automatic payout cutover

Automatic payout remains disabled in the Render Blueprint by default. Do not enable it until the old Cloudflare payout queue has been drained or deliberately paused and its Cron Trigger/Queue consumer can no longer submit transfers. This prevents two independent consumers from competing for the same BNB Smart Chain treasury nonce.

When ready, set the following on **both** Render services:
- `PAYOUT_ENABLED=true`
- `PAYOUT_PRIVATE_KEY` — dedicated BSC treasury signing key
- `BSC_RPC_URL` — trusted HTTPS BNB Smart Chain RPC endpoint

The web service uses these values to decide whether a new withdrawal can be queued; the background worker uses them to sign and send. Keep the worker at one instance because the treasury uses sequential account nonces. The Render queue has a lease, bounded retries, and a dead-job path that moves withdrawals to manual review after repeated failures.

## Important repository note

The old `backend/worker/wrangler.toml` and current Cloudflare deployment workflow still describe the previous Worker deployment. Do not remove or disable that deployment until the Render Blueprint has been approved, services are healthy, Pages has been switched to the Render URL, and old payout work has been reconciled. The final workflow cutover is a separate step after Render service creation.
