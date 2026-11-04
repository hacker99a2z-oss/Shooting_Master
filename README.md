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

## One-time Supabase data import

Schema deployment does not automatically import old Supabase records. To preserve existing balances and withdrawal history, add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as temporary Actions secrets, then manually run the Import legacy Supabase data workflow from the Actions tab. It imports player and withdrawal rows. Verify record counts before switching all traffic, then remove the legacy secrets. Do not rerun after Turso becomes the source of truth.

## Local development

Frontend: cd frontend, npm install, npm run dev.
Backend: cd backend, npm install, copy .dev.vars.example to .dev.vars, fill local-only values, then npm run db:migrate and npm run dev.

## Operational and security limits

- Withdrawal requests atomically reserve coins and enter a Cloudflare Queue for manual review. No payout provider or signing key is configured, so this project does not automatically transfer funds or mark them paid.
- AdsGram rewards are credited only after the protected server-to-server Reward URL callback consumes a pending one-time session. AdsGram's documented callback has no signature or unique event ID, so the shared-secret URL is not a cryptographically signed receipt.
- The canvas game is client-rendered. Server-issued one-time sessions, enemy limits and bounded rewards reduce simple replay/overclaiming, but do not prove the client played honestly. Do not pay high-value prizes until authoritative gameplay or stronger anti-cheat is implemented.
- The leaderboard shows up to 50 players with at least 500 season coins; the top 30 share a $10 prize pool every 48 hours. Displayed prize values are calculations, not automatic payouts.
- 50–60k daily active users is a target, not a verified capacity guarantee. Complete load tests and review Turso plan limits, Worker concurrency, Queue throughput, observability and recovery before public launch.
- Never commit environment files, bot/API tokens, database credentials or service-role keys. Any secret that entered Git history must be rotated; deleting the latest file does not erase historical commits.


## AdsGram server-side reward confirmation

After deploying the Worker, add a strong random `ADSGRAM_REWARD_SECRET` as a Worker Secret in Cloudflare Dashboard → Workers & Pages → `shooting-master-api` → Settings → Variables and Secrets. Do not commit the value or expose it as a Vite/frontend variable.

Configure the AdsGram Reward URL as:

`https://shooting-master-api.hacker99a2z.workers.dev/api/adsgram/reward?userid=[userId]&key=YOUR_SHARED_SECRET`

Replace `YOUR_SHARED_SECRET` with the exact Worker Secret value. The client completion event only leaves a one-time ad session pending; the Worker grants the extra play only after this protected server callback. AdsGram's documented callback identifies the Telegram user but does not provide a signed event ID/signature, so this shared-secret callback is not equivalent to a cryptographically signed receipt. AdsGram does not send the Reward URL callback for debug ads; test with a production ad block.


## Telegram bot /start message

The deployment registers the Worker as the Telegram bot webhook. A private-chat `/start` command sends an English feature summary and an inline keyboard with an **Open App** Web App button. Set the optional repository Actions variables `OFFICIAL_CHANNEL_URL` and `OFFICIAL_GROUP_URL` to valid public Telegram links (for example, `https://t.me/yourchannel` or a `https://t.me/+invitecode` link) to show the 📢 Official Channel and 👥 Official Group buttons. If either variable is blank, that button is omitted. The webhook secret is derived from the bot token and is not stored as a separate plaintext variable.
