# Shooting Master — Render Free backend setup

## Target architecture

- Cloudflare Pages continues to host the static React/Vite frontend.
- One Render **Free Web Service** hosts the Node.js API.
- The API process also drains the Turso-backed payout queue when it is awake.
- Turso remains the persistent source of truth for player data, withdrawals, queue jobs, and payout leases.

There is deliberately no Render Background Worker or Cron Job in the Free configuration because those service types do not have Free compute plans. The existing game/authentication and BEP-20 payout implementation is reused from `backend/worker/index.ts`, behind a Node.js HTTP adapter.

## Free plan and monthly usage

The root `render.yaml` creates one service only:

| Service | Type | Compute plan | Monthly compute price |
| --- | --- | --- | ---: |
| `shooting-master-api` | Web Service | Free | $0 |

Render provides 750 free instance hours per workspace per calendar month. One service running continuously for a 31-day month uses 744 hours; naturally sleeping during idle periods uses fewer. The 750-hour allowance is shared with other Free services in the same workspace, so check the Render Dashboard's Monthly Included Usage. Do not add an external keep-alive monitor: it is unnecessary for this setup and prevents normal idle spin-down.

Render Free web services sleep after 15 minutes without inbound HTTP/WebSocket traffic and take about one minute to wake on the next request. They can restart at any time, have 512 MB RAM / 0.1 CPU, and cannot scale beyond one instance or run attached persistent disks. Free compute is intended for hobby/testing use, not production. It is not a guarantee of 50–60k DAU capacity.

Because the service sleeps, payout processing is best-effort and may pause while there is no inbound traffic. A withdrawal request schedules processing immediately while the API is awake; subsequent retries and stale-job recovery happen on later traffic/startup. Do not promise instant or fixed-time auto payouts on Free. Move to a paid Web Service plus a separate Background Worker/Cron arrangement when usage or payout reliability requires it.

## Blueprint and environment setup

1. In Render, create a Blueprint from this repository's root `render.yaml`.
2. Choose the **Free** compute plan for `shooting-master-api`.
3. Set these environment variables on the web service:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `TELEGRAM_BOT_TOKEN`
   - `ADSGRAM_REWARD_SECRET`
   - `APP_ORIGIN=https://shooting-master.pages.dev`
   - `PAYOUT_ENABLED=false` (keep automatic signing disabled until cutover and testing)
   - `TELEGRAM_WEBHOOK_ENABLED=false` (keep the existing Cloudflare webhook until Render has passed smoke tests)
4. The start command applies existing Turso migrations and then idempotently applies migration 0005 before starting the API.
5. Confirm `/health` responds at the exact service URL shown by Render.

Do not put secrets into GitHub source, a frontend `VITE_*` variable, or this document. Add secrets only in Render's Environment page.

## Frontend and Telegram cutover

Keep the existing Cloudflare Worker active during the Render smoke-test phase. When Render is healthy:

1. Set GitHub Actions repository variable `VITE_API_BASE_URL` to the exact Render service URL shown in the Dashboard.
2. Update the frontend build workflow to use that value and stop deploying/registering the Cloudflare API Worker.
3. Deploy Cloudflare Pages and verify Telegram authentication, game start/finish, AdsGram reward callback, leaderboard, withdrawals, and CORS.
4. Change AdsGram Reward URL to:
   `https://YOUR-RENDER-SERVICE.onrender.com/api/adsgram/reward?userid=[userId]&key=YOUR_SHARED_SECRET`
5. Once the app and AdsGram callback are confirmed on Render, set `TELEGRAM_WEBHOOK_ENABLED=true` on the Render service and verify a private Telegram `/start` message.

Use the exact Render hostname from the dashboard; do not assume the example hostname.

## Automatic BEP-20 payout safety

Automatic payout remains disabled by default. Do not enable it until the Render queue has been tested with a small test payout and the previous Cloudflare Queue consumer / cron trigger can no longer submit transfers. Never run two independent queue consumers against the same BNB Smart Chain treasury.

For an explicitly approved payout cutover, add these secrets to the Render service:
- `PAYOUT_PRIVATE_KEY` — dedicated BNB Smart Chain treasury key.
- `BSC_RPC_URL` — trusted HTTPS BNB Smart Chain RPC endpoint.

Then explicitly set `PAYOUT_ENABLED=true` only after the Cloudflare payout queue is drained/paused, transaction history has been reconciled, and the service is tested. Keep the service to one instance and retain the global Turso treasury lease, sequential processing, persisted signed transaction, receipt/Transfer-event verification, bounded retry and manual-review fallback. Never use the treasury wallet for unrelated transactions while automation is active.

## Upgrade path

When the app outgrows Free or needs more dependable background processing:
- upgrade the API Web Service to an appropriate paid compute plan;
- add a separately paid Render Background Worker for queue consumption;
- optionally add a Cron Job or scheduler for recovery independent of user traffic;
- load-test and tune Turso/Worker concurrency before adding multiple API instances.

Free plan use does not establish that the app is ready for 50–60k daily active users; that requires measured load testing.
