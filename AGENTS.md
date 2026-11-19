<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Retain Telegram-authenticated API and payout rules; saved destinations are user-scoped and separate from active wallet sessions.
- WalletConnect is initialized only with a configured public Reown project ID; never treat a saved address as a connected wallet.
- Every Battle Arena match is a server game session: /api/game/start issues the match's random 9–12 enemy total, /api/game/finish credits kills × coins-per-kill to the profile (the same balance withdrawals spend), and leaving mid-round cancels it without coins; shared reward/payout numbers live in lib/rules.ts so they stay unit-tested.
- Homepage shows the profile card, a Battle Arena preview card (a real frame from the game) and the Games card beside a stack of Daily Games goal cards; the goals (target + claim reward) and coins-per-enemy live in lib/home-rules.ts so they stay unit-tested. The homepage preloads every Battle Arena model (components/battle/preload.ts) so Play opens the finished map at once; the game and the preload share the URL lists in models.ts so they hit the same loader cache.
- Wallet page keeps balance, Trust Wallet connect and withdraw in one card; phones connect through the Trust Wallet app, PCs through the Trust Wallet extension, and the wallet address is never displayed.
- Each paid automatic payout is announced once to the payout channel (PAYOUT_CHANNEL_ID, else the public OFFICIAL_CHANNEL_URL) and the history "View" button opens that post.
- Battle Arena (/play, opened by the homepage Play button) is a top-down MOBA-style 3D map in react-three-fiber (components/battle): all gameplay (hero moving, bow aim-and-release with unlimited arrows, the hold-to-raise shield, one-hit kills, enemy waves of growing size up to the match total, win/lose, enemy AI/throws, random props per match) lives in lib/battle-rules.ts and the camera framing in lib/battle-camera.ts as pure functions so they stay unit-tested; the views only draw that state. Models are CC0 GLBs in public/models (credits in public/models/CREDITS.md), trimmed and meshopt-compressed.
- The post-match coin count-up on the home profile reads a one-shot gain the finished match leaves in the query cache (lib/coin-gain.ts holds the pure timing so it stays unit-tested).
