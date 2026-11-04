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

Optional GitHub Actions variables: VITE_TELEGRAM_BOT_USERNAME, VITE_ADSGRAM_BLOCK_ID, VITE_SUPPORT_URL, VITE_PROOF_URL.

The workflow uses Pages project shooting-master and API CORS origin https://shooting-master.pages.dev.

## One-time Supabase data import

Schema deployment does not automatically import old Supabase records. To preserve existing balances and withdrawal history, add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as temporary Actions secrets, then manually run the Import legacy Supabase data workflow from the Actions tab. It imports player and withdrawal rows. Verify record counts before switching all traffic, then remove the legacy secrets. Do not rerun after Turso becomes the source of truth.

## Local development

Frontend: cd frontend, npm install, npm run dev.
Backend: cd backend, npm install, copy .dev.vars.example to .dev.vars, fill local-only values, then npm run db:migrate and npm run dev.

## Operational and security limits

- Withdrawal requests atomically reserve coins and enter a Cloudflare Queue for manual review. No payout provider or signing key is configured, so this project does not automatically transfer funds or mark them paid.
- AdsGram rewards currently rely on the browser SDK completion callback plus a one-time API session. This is not a signed server-to-server ad receipt and is not fully fraud-proof.
- The canvas game is client-rendered. Server-issued one-time sessions, enemy limits and bounded rewards reduce simple replay/overclaiming, but do not prove the client played honestly. Do not pay high-value prizes until authoritative gameplay or stronger anti-cheat is implemented.
- The leaderboard shows up to 50 players with at least 500 season coins; the top 30 share a $10 prize pool every 48 hours. Displayed prize values are calculations, not automatic payouts.
- 50–60k daily active users is a target, not a verified capacity guarantee. Complete load tests and review Turso plan limits, Worker concurrency, Queue throughput, observability and recovery before public launch.
- Never commit environment files, bot/API tokens, database credentials or service-role keys. Any secret that entered Git history must be rotated; deleting the latest file does not erase historical commits.


## AdsGram server-side reward confirmation

After deploying the Worker, add a strong random `ADSGRAM_REWARD_SECRET` as a Worker Secret in Cloudflare Dashboard → Workers & Pages → `shooting-master-api` → Settings → Variables and Secrets. Do not commit the value or expose it as a Vite/frontend variable.

Configure the AdsGram Reward URL as:

`https://shooting-master-api.hacker99a2z.workers.dev/api/adsgram/reward?userid=[userId]&key=YOUR_SHARED_SECRET`

Replace `YOUR_SHARED_SECRET` with the exact Worker Secret value. The client completion event only leaves a one-time ad session pending; the Worker grants the extra play only after this protected server callback. AdsGram's documented callback identifies the Telegram user but does not provide a signed event ID/signature, so this shared-secret callback is not equivalent to a cryptographically signed receipt. AdsGram does not send the Reward URL callback for debug ads; test with a production ad block.
