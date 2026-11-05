# Shooting Master

Telegram Mini App. The only application folders at repository root are:

- frontend/ — React/Vite UI, animated shooter game, pages and static assets; deployed to Cloudflare Pages.
- backend/ — Cloudflare Worker API, Turso schema/migrations and operational scripts; deployed to Cloudflare Workers.

## Deployment

A push to main runs .github/workflows/deploy.yml. The workflow installs app dependencies, creates payout queues if missing, applies the Turso schema, deploys the Worker, builds the frontend with the Worker API URL, and publishes Pages.

Add these GitHub Actions repository secrets:

- CLOUDFLARE_API_TOKEN — account token with Cloudflare Pages Edit, Workers Scripts Edit and Queues Edit.
- CLOUDFLARE_ACCOUNT_ID
- TURSO_DATABASE_URL
- TURSO_AUTH_TOKEN
- TELEGRAM_BOT_TOKEN

Optional GitHub Actions variables: VITE_ADSGRAM_BLOCK_ID, VITE_SUPPORT_URL, VITE_PROOF_URL, OFFICIAL_CHANNEL_URL, OFFICIAL_GROUP_URL. The Telegram bot username is fetched directly from the configured bot token during deployment. Set OFFICIAL_CHANNEL_URL and OFFICIAL_GROUP_URL to the real HTTPS Telegram channel/group links (for example, https://t.me/yourchannel or https://t.me/+invitecode); each configured link adds its matching button to the Telegram /start welcome message. Missing links are reported as deployment warnings rather than replaced with a non-working https://t.me/ homepage.

The workflow uses Pages project shooting-master and API CORS origin https://shooting-master.pages.dev.


## Automatic USDT BEP-20 payouts

Automatic payouts are **off by default**. To enable them, first create a dedicated BNB Smart Chain treasury wallet used only by this Worker. Fund it with the supported BSC USDT token and enough BNB for gas. Do not use a personal wallet or reuse its key elsewhere.

Add these encrypted GitHub Actions repository secrets under Settings → Secrets and variables → Actions → Secrets:

- `PAYOUT_PRIVATE_KEY` — the dedicated treasury wallet's 32-byte EVM private key in `0x...` format. Never commit it, paste it into Lovable/frontend code, or send it in chat.
- `BSC_RPC_URL` — an HTTPS BNB Smart Chain mainnet RPC endpoint from a provider you trust. Do not use an endpoint that asks for your wallet private key.

Then add the GitHub Actions repository variable under Settings → Secrets and variables → Actions → Variables:

- `PAYOUT_ENABLED` = `true`

A push to `main` will place the signing key and RPC endpoint into Cloudflare Worker encrypted Secrets. The key is read only by the backend Worker; it is never sent to the browser or stored in Turso. With the variable unset or set to anything other than `true`, withdrawals remain in manual review and no automatic transfer is signed.

### Payout safety controls

- The Worker fixes the token contract in backend code to `0x55d398326f99059fF775485246999027B3197955` on BNB Smart Chain chain ID 56 and verifies the contract symbol and 18 decimals before signing.
- Each automatic payout is capped at $10 USDT-equivalent, and automatic payouts are capped at $100 in a UTC day. Requests outside those limits stay in manual review.
- The treasury must have enough token balance and at least twice the estimated BNB transaction fee. Automatic signing is paused when estimated gas exceeds 20 gwei or 150,000 gas.
- The Worker signs the transfer server-side, persists the signed transaction and hash before broadcasting, and reuses that same signed transaction on retries. This is intended to prevent duplicate sends after queue retries or Worker restarts.
- A withdrawal is marked paid only after the receipt succeeds and the expected token Transfer event matches the treasury, recipient and exact amount. Reverts, balance problems, unexpected token metadata, or unverifiable receipts are sent to manual review.
- The queue has one consumer at a time because the treasury uses sequential account nonces. Do not send unrelated transactions from the payout treasury while this automation is active.
- Check the Cloudflare Queue dead-letter queue and Turso `withdrawals` / `payout_events` records when a payout needs manual intervention. Never manually mark a withdrawal paid without verifying the transaction on BscScan.

### Important BNB Chain token identity note

The configured BNB Chain token contract is the widely used BEP-20 token labelled USDT on BNB Chain and has 18 decimals. It is **not the Ethereum 6-decimal USDT contract**. Tether's current supported-protocol page does not list BNB Smart Chain as a native USD₮ network, so confirm that your exchange and recipients accept this specific BNB Chain token representation before enabling payouts. The contract address—not the token name shown in a wallet—is the asset identifier.

Keep a reserve for gas, monitor treasury balances and queue failures, and start with a small test payout to a wallet you control before raising limits. The code change alone does not fund the treasury or activate automatic payouts; activation requires the secrets and variable above.

## One-time Supabase data import

Schema deployment does not automatically import old Supabase records. To preserve existing balances and withdrawal history, add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as temporary Actions secrets, then manually run the Import legacy Supabase data workflow from the Actions tab. It imports player and withdrawal rows. Verify record counts before switching all traffic, then remove the legacy secrets. Do not rerun after Turso becomes the source of truth.

## Local development

Frontend: cd frontend, npm install, npm run dev.
Backend: cd backend, npm install, copy .dev.vars.example to .dev.vars, fill local-only values, then npm run db:migrate and npm run dev.

## Operational and security limits

- Withdrawal requests atomically reserve coins and enter a Cloudflare Queue for manual review. No payout provider or signing key is configured, so this project does not automatically transfer funds or mark them paid.
- AdsGram rewards are credited only after the protected server-to-server Reward URL callback consumes a pending one-time session. AdsGram's documented callback has no signature or unique event ID, so the shared-secret URL is not a cryptographically signed receipt.
- The canvas game is client-rendered. Server-issued one-time sessions, enemy limits and bounded rewards reduce simple replay/overclaiming, but do not prove the client played honestly. Do not pay high-value prizes until authoritative gameplay or stronger anti-cheat is implemented.
- The leaderboard shows up to 50 players who played at least 1 game this season; the top 30 share a $10 prize pool every 48 hours. Displayed prize values are calculations, not automatic payouts.
- 50–60k daily active users is a target, not a verified capacity guarantee. Complete load tests and review Turso plan limits, Worker concurrency, Queue throughput, observability and recovery before public launch.
- Never commit environment files, bot/API tokens, database credentials or service-role keys. Any secret that entered Git history must be rotated; deleting the latest file does not erase historical commits.


## AdsGram server-side reward confirmation

After deploying the Worker, add a strong random `ADSGRAM_REWARD_SECRET` as a Worker Secret in Cloudflare Dashboard → Workers & Pages → `shooting-master-api` → Settings → Variables and Secrets. Do not commit the value or expose it as a Vite/frontend variable.

Configure the AdsGram Reward URL as:

`https://shooting-master-api.hacker99a2z.workers.dev/api/adsgram/reward?userid=[userId]&key=YOUR_SHARED_SECRET`

Replace `YOUR_SHARED_SECRET` with the exact Worker Secret value. The client completion event only leaves a one-time ad session pending; the Worker grants the extra play only after this protected server callback. AdsGram's documented callback identifies the Telegram user but does not provide a signed event ID/signature, so this shared-secret callback is not equivalent to a cryptographically signed receipt. AdsGram does not send the Reward URL callback for debug ads; test with a production ad block.


## Telegram bot /start message

The deployment registers the Worker as the Telegram bot webhook. A private-chat `/start` command sends an English feature summary and an inline keyboard with an **Open App** Web App button. Set the optional repository Actions variables `OFFICIAL_CHANNEL_URL` and `OFFICIAL_GROUP_URL` to valid public Telegram links (for example, `https://t.me/yourchannel` or a `https://t.me/+invitecode` link) to show the 📢 Official Channel and 👥 Official Group buttons. If either variable is blank, that button is omitted. The webhook secret is derived from the bot token and is not stored as a separate plaintext variable.
