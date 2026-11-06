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
- Gameplay is the 2D-canvas archery game (ArcheryGame); the server-issued target count is used for each round, and the existing authenticated game-result API handles reward settlement.
- Target timing/motion curves live in lib/rules.ts as pure functions so they stay unit-tested.
