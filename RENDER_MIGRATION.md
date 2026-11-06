# Shooting Master — Render Free backend migration status

## Current deployment (2026-11-06)

- Cloudflare Pages hosts the static React/Vite frontend.
- The frontend build uses `https://shooting-master-api-5ao3.onrender.com` as `VITE_API_BASE_URL`.
- One Render **Free Web Service** hosts the Node.js API.
- Turso is the persistent source of truth for players, game sessions, AdsGram reward sessions, withdrawals, payout events, and the Render payout queue.
- The Telegram bot webhook is registered on the Render API (`/telegram/webhook`).
- AdsGram Reward URL should point to the Render endpoint; the app owner has confirmed that the provider callback URL was corrected.
- The legacy Cloudflare Worker and its Queue/Cron configuration remain deployed temporarily for fallback and historical payout queue reconciliation. Do not delete them yet.

## Verified deployment checks

The latest GitHub Actions deployment completed successfully:
- backend dependency installation and Turso schema migration;
- Cloudflare Pages frontend build and deploy;
- Render `/health` smoke test;
- CORS preflight/response header check for `https://shooting-master.pages.dev`;
- Pages homepage smoke test.

Render logs confirmed:
- migration 0005 applied (Render payout queue tables);
- API process listening on port 10000;
- `[telegram] webhook registered`;
- `Your service is live`.

These are deployment checks, not a complete end-to-end test of every Telegram login, gameplay, AdsGram reward, or withdrawal flow. Test those in the live Telegram Mini App before announcing the migration as fully complete.

## Render Free plan and monthly usage

The root `render.yaml` creates exactly one Render service:

| Service | Type | Compute plan | Monthly compute price |
| --- | --- | --- | ---: |
| `shooting-master-api` | Web Service | Free | $0 |

Render Free provides 750 instance hours per workspace per calendar month. One service running continuously for a 31-day month uses 744 hours. The allowance is shared with other Free services in the workspace; check Render Dashboard → Monthly Included Usage.

Render Free web services sleep after 15 minutes without inbound HTTP/WebSocket traffic and take about one minute to wake on the next request. They can restart at any time, have 512 MB RAM / 0.1 CPU, and cannot scale beyond one instance or run attached persistent disks. Free compute is for hobby/testing and is not a guarantee of 50–60k DAU capacity.

There is no Render Background Worker or Cron Job in this Free configuration. The Node API processes bounded queue work and runs maintenance only while the Web Service is awake on inbound traffic. Payout processing is therefore best-effort and can pause while the service sleeps.

## Current Render environment

Required secrets on the Render Web Service:
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `ADSGRAM_REWARD_SECRET`

Non-secret settings:
- `APP_ORIGIN=https://shooting-master.pages.dev`
- `PAYOUT_ENABLED=false`
- `TELEGRAM_WEBHOOK_ENABLED=true`
- `OFFICIAL_CHANNEL_URL=https://t.me/shooting_master`
- `OFFICIAL_GROUP_URL=https://t.me/shooting_master_group`

Keep secrets in Render Environment only. Never put them in Git, a frontend `VITE_*` variable, or chat.

## Remaining cutover checklist

### 1. Live app smoke test

In the Telegram Mini App, verify:
- Telegram login and player profile;
- start a game, finish it, and confirm server-credited coins;
- AdsGram production ad callback grants exactly one extra play/reward;
- leaderboard and withdrawal history load;
- a small withdrawal request appears as manual review while `PAYOUT_ENABLED=false`;
- the Render API wakes correctly after idle sleep.

Do not use a fake user ID or manually call the AdsGram Reward URL with a real user's ID to test rewards; use a real eligible ad session.

### 2. Reconcile payout records before enabling transfers

A read-only GitHub Actions step reports aggregate withdrawal, Render queue, and payout-event counts. Review pending/processing/dead records before changing payout settings.

The old Cloudflare Queue/Cron remains deployed. Do not enable Render automatic payouts until:
- legacy Cloudflare payout processing is confirmed paused or safely drained;
- pending withdrawal records and prior transactions are reconciled against BscScan;
- no signed/broadcast transaction is in-flight or awaiting receipt;
- Render queue state and the global Turso treasury lock are clear;
- a small approved test payout is completed and its receipt/Transfer event is verified.

Never run two independent consumers with the same BNB treasury. Never manually mark a withdrawal paid without checking the transaction on BscScan.

### 3. Future automatic payout configuration (not enabled now)

Only after the above checks, add to the Render Web Service:
- `PAYOUT_PRIVATE_KEY` — dedicated BNB Smart Chain treasury key;
- `BSC_RPC_URL` — trusted HTTPS BNB Smart Chain RPC endpoint;
- `PAYOUT_ENABLED=true` — explicit approval to activate signing.

Keep one Render instance. Preserve the global Turso treasury lease, sequential processing, persisted signed transaction, receipt/Transfer-event verification, bounded retries, and manual-review fallback. Do not use the treasury wallet for unrelated transactions.

### 4. Retire the old Worker only after reconciliation

After the legacy queue has been drained/reconciled and AdsGram/Telegram are confirmed on Render:
- stop the old Cloudflare Worker Queue consumer and Cron trigger;
- remove the legacy Worker deployment/secrets only after confirming no other integration still calls it;
- retain the Pages project and Turso database.

## Upgrade path

When traffic or payout reliability outgrows Free:
- upgrade the API Web Service to an appropriate paid plan;
- add a separate paid Background Worker for queue consumption;
- optionally add a Cron Job for recovery independent of user traffic;
- load-test API, Turso, and queue concurrency before scaling horizontally.

Free plan use does not establish readiness for 50–60k daily active users; that requires measured load testing.
