# Shooting Master

Telegram Mini App with a React/Vite frontend, animated archery game, Turso database, Telegram authentication, AdsGram reward verification, leaderboard, and optional USDT BEP-20 payouts.

## Target deployment

- `frontend/` — static React/Vite app hosted on Cloudflare Pages.
- `backend/` — shared API, authentication, game and payout logic.
- Render Free Web Service — Node.js API; while the Free instance is awake it also processes the durable Turso payout queue and recovery tasks.
- Turso — persistent player, game, withdrawal, payout-event, and queue records.

The Free deployment intentionally uses one Render Web Service only. Render Free does not offer free Background Workers or Cron Jobs. See [RENDER_MIGRATION.md](./RENDER_MIGRATION.md) for current limitations, secrets, safe cutover steps, and the upgrade path.

The frontend API URL and Telegram bot webhook now point to the Render Free service. The old Cloudflare Worker is still deployed as a temporary fallback and may still own older AdsGram callbacks or queued payout work. Do not remove its Queue consumer/Cron Trigger or disable its secrets until the AdsGram callback is switched and outstanding Cloudflare queue jobs have been reconciled.

Add these GitHub Actions repository secrets:

- CLOUDFLARE_API_TOKEN — account token with Cloudflare Pages Edit, Workers Scripts Edit and Queues Edit.
- CLOUDFLARE_ACCOUNT_ID
- TURSO_DATABASE_URL
- TURSO_AUTH_TOKEN
- TELEGRAM_BOT_TOKEN
- `RENDER_API_KEY` — optional Render API key used by CI to sync payout credentials without exposing their values in logs.
- `PAYOUT_PRIVATE_KEY` — optional BNB Smart Chain treasury key; synced to Render when the required Render API key is present.
- `BSC_RPC_URL` — optional trusted HTTPS BNB Smart Chain RPC URL; synced to Render with the private key.

Optional GitHub Actions variables: VITE_ADSGRAM_BLOCK_ID, VITE_SUPPORT_URL, VITE_PROOF_URL, OFFICIAL_CHANNEL_URL, OFFICIAL_GROUP_URL. The Telegram bot username is fetched directly from the configured bot token during deployment. Set OFFICIAL_CHANNEL_URL and OFFICIAL_GROUP_URL to the real HTTPS Telegram channel/group links (for example, https://t.me/yourchannel or https://t.me/+invitecode); each configured link adds its matching button to the Telegram /start welcome message. Missing links are reported as deployment warnings rather than replaced with a non-working https://t.me/ homepage.

The workflow uses Pages project shooting-master and API CORS origin https://shooting-master.pages.dev.


## Automatic USDT BEP-20 payouts

Automatic payouts are currently **disabled on the Render backend**. New withdrawals are therefore routed to manual review until the queue cutover is complete. The legacy Cloudflare Worker is being disabled (no workers.dev route, Queue consumer, or Cron trigger). Cloudflare Pages remains the frontend host. Keep legacy Queue resources only until the Render cutover audit is complete.

Do not enable Render automatic payouts until the old Cloudflare payout consumer and scheduled recovery are confirmed paused/drained and all pending withdrawals have been reconciled. This prevents two services from attempting transactions with the same BNB treasury nonce. Once safe, create a dedicated BNB Smart Chain treasury wallet used only by the payout backend, fund it with the configured token and enough BNB for gas, and add the secrets to the Render Web Service Environment (not to frontend variables).

When the payout cutover is approved, add these Render Web Service environment variables:

- `PAYOUT_PRIVATE_KEY` — dedicated treasury wallet's 32-byte EVM private key in `0x...` format.
- `BSC_RPC_URL` — trusted HTTPS BNB Smart Chain mainnet RPC endpoint.
- `PAYOUT_ENABLED=true` — enable only after the Cloudflare consumer is drained/paused and the queue is reconciled.

Never commit the private key, place it in a frontend `VITE_*` variable, or send it in chat.

The active payout code runs on the Render API service. When `RENDER_API_KEY`, `PAYOUT_PRIVATE_KEY`, and `BSC_RPC_URL` are present as GitHub Actions secrets, the deployment workflow syncs the two payout credentials directly to Render using its per-variable API and never prints their values. The workflow does not change `PAYOUT_ENABLED`: automatic transfers remain disabled unless you explicitly set `PAYOUT_ENABLED=true` on Render after completing the payout reconciliation and test checklist below.

### Payout safety controls

- The Worker fixes the token contract in backend code to `0x55d398326f99059fF775485246999027B3197955` on BNB Smart Chain chain ID 56 and verifies the contract symbol and 18 decimals before signing.
- Each automatic payout is capped at $10 USDT-equivalent, and automatic payouts are capped at $100 in a UTC day. Requests outside those limits stay in manual review.
- The treasury must have enough token balance and at least twice the estimated BNB transaction fee. Automatic signing is paused when estimated gas exceeds 20 gwei or 150,000 gas.
- The Worker signs the transfer server-side, persists the signed transaction and hash before broadcasting, and reuses that same signed transaction on retries. This is intended to prevent duplicate sends after queue retries or Worker restarts.
- A withdrawal is marked paid only after the receipt succeeds and the expected token Transfer event matches the treasury, recipient and exact amount. Reverts, balance problems, unexpected token metadata, or unverifiable receipts are sent to manual review.
- The queue has one consumer at a time because the treasury uses sequential account nonces. Do not send unrelated transactions from the payout treasury while this automation is active.
- During the transition, review any legacy Cloudflare Queue dead-letter entries and the Render `render_payout_jobs` table alongside Turso `withdrawals` / `payout_events`. The Render API polls the durable Turso payout queue while the Free Web Service is awake; it is not an always-on worker and pauses during Free-service sleep. Never manually mark a withdrawal paid without verifying the transaction on BscScan.

### Important BNB Chain token identity note

The configured BNB Chain token contract is the widely used BEP-20 token labelled USDT on BNB Chain and has 18 decimals. It is **not the Ethereum 6-decimal USDT contract**. Tether's current supported-protocol page does not list BNB Smart Chain as a native USD₮ network, so confirm that your exchange and recipients accept this specific BNB Chain token representation before enabling payouts. The contract address—not the token name shown in a wallet—is the asset identifier.

Keep a reserve for gas, monitor treasury balances and queue failures, and start with a small test payout to a wallet you control before raising limits. The code change alone does not fund the treasury or activate automatic payouts; activation requires the secrets and variable above.

## One-time Supabase data import

Schema deployment does not automatically import old Supabase records. To preserve existing balances and withdrawal history, add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as temporary Actions secrets, then manually run the Import legacy Supabase data workflow from the Actions tab. It imports player and withdrawal rows. Verify record counts before switching all traffic, then remove the legacy secrets. Do not rerun after Turso becomes the source of truth.

## Local development

Frontend: cd frontend, npm install, npm run dev.
Backend: cd backend, npm install, copy .dev.vars.example to .dev.vars, fill local-only values, then npm run db:migrate and npm run dev.

## Operational and security limits

- Withdrawals atomically reserve coins. When explicitly enabled and fully configured, eligible USDT BEP-20 withdrawals are signed by the backend treasury and sent through the Cloudflare Queue; otherwise requests remain in manual review. Automatic payouts are off by default and require the secrets and activation steps below.
- AdsGram rewards are credited only after the protected server-to-server Reward URL callback consumes a pending one-time session. AdsGram's documented callback has no signature or unique event ID, so the shared-secret URL is not a cryptographically signed receipt.
- The archery game is client-rendered. Server-issued one-time sessions, target limits and bounded rewards reduce simple replay/overclaiming, but do not prove the client played honestly. Do not pay high-value prizes until authoritative gameplay or stronger anti-cheat is implemented.
- The leaderboard shows up to 50 players who played at least 1 game this season; the top 30 share a $10 prize pool every 48 hours. Displayed prize values are calculations, not automatic payouts.
- 50–60k daily active users is a target, not a verified capacity guarantee. Complete load tests and review Turso plan limits, Worker concurrency, Queue throughput, observability and recovery before public launch.
- Never commit environment files, bot/API tokens, database credentials or service-role keys. Any secret that entered Git history must be rotated; deleting the latest file does not erase historical commits.


## AdsGram server-side reward confirmation

Add a strong random `ADSGRAM_REWARD_SECRET` as a Render Web Service Environment secret. Do not commit it or expose it as a Vite/frontend variable.

The Render API callback URL is:

`https://shooting-master-api-5ao3.onrender.com/api/adsgram/reward?userid=[userId]&key=YOUR_SHARED_SECRET`

Update the Reward URL in AdsGram's dashboard to this Render URL and replace `YOUR_SHARED_SECRET` with the value already stored in Render. Until that provider-side URL is updated, the legacy Cloudflare callback may still be needed. The client completion event only marks a one-time ad session as awaiting postback. The frontend waits for the protected server-to-server Reward URL callback before starting the game; the backend also rejects game-start requests until that exact ad session is marked rewarded. AdsGram's documented callback identifies the Telegram user but does not provide a signed event ID/signature, so the shared-secret callback is not equivalent to a cryptographically signed receipt. AdsGram does not send the Reward URL callback for debug ads; test with a production ad block.


## Telegram bot /start message

The Render API now registers the Telegram bot webhook when `TELEGRAM_WEBHOOK_ENABLED=true`. A private-chat `/start` command sends an English feature summary and an inline keyboard with an **Open App** Web App button. The GitHub Pages deployment workflow resolves the bot username but no longer resets the webhook to the legacy Worker. Set the optional repository Actions variables `OFFICIAL_CHANNEL_URL` and `OFFICIAL_GROUP_URL` to valid public Telegram links to show the Official Channel and Official Group buttons. The webhook secret is derived from the bot token and is not stored as a separate plaintext variable.
