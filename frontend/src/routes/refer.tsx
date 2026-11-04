import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Send, Gift, UserPlus, Gamepad2, Coins } from "lucide-react";
import { useState } from "react";
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

function fallbackCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.left = "-9999px";
  field.style.top = "0";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.focus();
  field.select();
  field.setSelectionRange(0, field.value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    field.remove();
  }
  return copied;
}

function Refer() {
  const { data: me } = usePlayer();
  const [copied, setCopied] = useState(false);
  const link = me ? `https://t.me/${BOT_USERNAME}?startapp=ref_${me.tgId}` : "";

  const copy = async () => {
    if (!link) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else if (!fallbackCopy(link)) {
        throw new Error("Clipboard is unavailable");
      }
    } catch {
      // Telegram and older Android WebViews may reject Clipboard API access.
      if (!fallbackCopy(link)) {
        toast.error("Copy failed", { description: "Please tap and hold the referral link to copy it." });
        return;
      }
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    haptic("success");
    toast.success("Copied!", { description: "Your referral link is ready to share." });
  };

  const share = () => {
    const text = `🎮 Play Coin Rush with me and earn coins every day!`;
    if (link) openLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
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
        <button
          type="button"
          onClick={copy}
          disabled={!me}
          aria-label="Copy referral link"
          className="block w-full truncate rounded-xl border border-dashed border-primary/40 bg-muted px-3 py-3 text-left font-mono text-xs transition-colors hover:border-primary active:scale-[0.99] disabled:opacity-60"
          title="Tap to copy referral link"
        >
          {link || "…"}
        </button>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button onClick={copy} disabled={!me} className="flex items-center justify-center gap-2 rounded-2xl border bg-secondary py-3 font-medium active:scale-95 transition-transform">
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied!" : "Copy"}
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
            <p className="font-display text-3xl text-gold-gradient">{((me?.referralPaidCount ?? 0) * REFERRAL_REWARD).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Coins earned</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Friends count as soon as they join using your link. Your +${REFERRAL_REWARD} coin reward unlocks after each friend completes ${REFERRAL_GAMES_NEEDED} games.</p>
      </section>
    </AppShell>
  );
}
