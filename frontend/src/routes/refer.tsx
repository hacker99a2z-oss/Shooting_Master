import { createFileRoute } from "@tanstack/react-router";
import { Copy, Send, Gift, UserPlus, Gamepad2, Coins } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { usePlayer } from "@/hooks/use-player";
import { BOT_USERNAME, openLink, haptic } from "@/lib/tg";
import { REFERRAL_REWARD, REFERRAL_GAMES_NEEDED } from "@/lib/rules";

export const Route = createFileRoute("/refer")({
  head: () => ({
    meta: [
      { title: "Invite Friends — Coin Rush" },
      { name: "description", content: "Invite friends to Coin Rush and earn bonus coins when they play 10 games." },
      { property: "og:title", content: "Invite Friends — Coin Rush" },
      { property: "og:description", content: "Invite friends and earn bonus coins." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Refer,
});

function Refer() {
  const { data: me } = usePlayer();
  const link = me ? `https://t.me/${BOT_USERNAME}?startapp=ref_${me.tgId}` : "";

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    haptic("success");
    toast.success("Link copied!");
  };
  const share = () => {
    const text = `🎮 Play Coin Rush with me and earn coins every day!`;
    openLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  };

  const steps = [
    { icon: UserPlus, title: "Share your link", text: "Send it to friends on Telegram" },
    { icon: Gamepad2, title: `They play ${REFERRAL_GAMES_NEEDED} games`, text: "Any game counts" },
    { icon: Coins, title: `You get +${REFERRAL_REWARD}`, text: "Coins land in your wallet" },
  ];

  return (
    <AppShell title="Invite Friends">
      <section className="rounded-3xl border border-primary/40 bg-card p-4 shadow-glow">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-coral"><Gift className="h-6 w-6 text-accent-foreground" /></span>
          <div>
            <p className="text-xs text-muted-foreground">Your invite link</p>
            <p className="font-display text-lg leading-tight"><span className="text-gold-gradient">+{REFERRAL_REWARD} coins</span> per friend</p>
          </div>
        </div>
        <div className="truncate rounded-xl border border-dashed border-primary/40 bg-muted px-3 py-3 font-mono text-xs">{link || "…"}</div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button onClick={copy} disabled={!me} className="flex items-center justify-center gap-2 rounded-2xl border bg-secondary py-3 font-medium active:scale-95 transition-transform">
            <Copy className="h-4 w-4" /> Copy
          </button>
          <button onClick={share} disabled={!me} className="flex items-center justify-center gap-2 rounded-2xl bg-gold py-3 font-display text-lg text-primary-foreground shadow-glow active:scale-95 transition-transform">
            <Send className="h-4 w-4" /> Share
          </button>
        </div>
      </section>
      <section className="mt-4 rounded-3xl border bg-card p-4 shadow-card">
        <h3 className="mb-3 text-lg">How it works</h3>
        <ol className="space-y-3">
          {steps.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="flex items-center gap-3">
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                <Icon className="h-5 w-5" />
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gold font-display text-xs text-primary-foreground">{i + 1}</span>
              </span>
              <div>
                <p className="font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-4 rounded-3xl border bg-card p-4 shadow-card">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-muted p-3">
            <p className="font-display text-3xl">{me?.referralCount ?? 0}</p>
            <p className="text-xs text-muted-foreground">Friends joined</p>
          </div>
          <div className="rounded-2xl bg-muted p-3">
            <p className="font-display text-3xl text-gold-gradient">{((me?.referralCount ?? 0) * REFERRAL_REWARD).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Coins earned</p>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
