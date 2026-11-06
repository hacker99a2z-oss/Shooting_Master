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
- Use Three.js only for rendering the existing Canvas simulation, with a 2D fallback when WebGL is unavailable.
- WalletConnect is initialized only with a configured public Reown project ID; never treat a saved address as a connected wallet.
