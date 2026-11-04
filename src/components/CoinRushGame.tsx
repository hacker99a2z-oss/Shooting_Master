import { useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/tg";

// Side-scrolling runner: a cute animated fox runs, tap to jump (double jump),
// collect coins & gems, avoid spikes, rocks and bats.
type Kind = "coin" | "gem" | "spike" | "rock" | "bat" | "heart" | "star";
type Obj = { x: number; y: number; r: number; kind: Kind; t: number; dead?: boolean };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };
type Floater = { x: number; y: number; text: string; life: number; color: string };

const C = {
  sky1: "#1b1440", sky2: "#3a2a7a", hill1: "#2c2363", hill2: "#40308a",
  ground: "#5b3fa8", groundTop: "#8ef0a2",
  gold: "#ffd45a", goldDeep: "#e89a1c", gem: "#5ef2d6",
  fox: "#ff8a3d", foxDeep: "#d9542b", belly: "#fff3e0", eye: "#1c1530",
  spike: "#c9cfe0", rock: "#6b6280", bat: "#2a1f45", heart: "#ff5d7a", star: "#fff27a",
};

const DURATION = 45;

export function CoinRushGame({ onEnd }: { onEnd: (score: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState({ score: 0, lives: 3, time: DURATION, combo: 1, star: false });
  const [countdown, setCountdown] = useState(3);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    if (countdown <= 0) return;
    haptic("light");
    const t = setTimeout(() => setCountdown((c) => c - 1), 700);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0) return;
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, GY = 0;
    const resize = () => {
      W = wrap.clientWidth; H = wrap.clientHeight; GY = H - 90;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const fx = () => Math.min(110, W * 0.25);
    let fy = 0, vy = 0, jumps = 0, squash = 0, hurt = 0;
    let objs: Obj[] = [];
    let parts: Particle[] = [];
    let floats: Floater[] = [];
    let score = 0, lives = 3, combo = 1, streak = 0, shake = 0, starUntil = 0;
    let dist = 0, nextSpawn = 0;
    const start = performance.now();
    let last = start, raf = 0, done = false, lastHud = 0;

    const jump = () => {
      if (done) return;
      if (jumps < 2) {
        vy = jumps === 0 ? -13.5 : -11.5; jumps++; squash = 1; haptic("light");
        for (let i = 0; i < 6; i++) parts.push({ x: fx(), y: GY, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 2, life: 0.7, color: "rgba(255,255,255,0.6)", size: 3 });
      }
    };
    const onDown = (e: Event) => { e.preventDefault(); jump(); };
    const onKey = (e: KeyboardEvent) => { if (e.code === "Space" || e.code === "ArrowUp") jump(); };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);

    const burst = (x: number, y: number, color: string, n = 14) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = Math.random() * 4 + 1.5;
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: 1, color, size: Math.random() * 4 + 2 });
      }
    };

    const spawn = (elapsed: number) => {
      const x = W + 40;
      const r = Math.random();
      const danger = Math.min(0.55, 0.35 + elapsed * 0.005);
      if (r < danger) {
        const k = Math.random();
        if (k < 0.4) objs.push({ x, y: GY, r: 16, kind: "spike", t: 0 });
        else if (k < 0.7) objs.push({ x, y: GY - 18, r: 18, kind: "rock", t: 0 });
        else objs.push({ x, y: GY - 95 - Math.random() * 30, r: 16, kind: "bat", t: Math.random() * 6 });
        // reward coins over the obstacle
        for (let i = -1; i <= 1; i++) objs.push({ x: x + i * 34, y: GY - 150 - Math.abs(i) * -15, r: 12, kind: "coin", t: i });
      } else {
        const special = Math.random();
        if (special < 0.06) objs.push({ x, y: GY - 130, r: 16, kind: "star", t: 0 });
        else if (special < 0.1 && lives < 3) objs.push({ x, y: GY - 110, r: 15, kind: "heart", t: 0 });
        else if (special < 0.3) objs.push({ x, y: GY - 170, r: 13, kind: "gem", t: 0 });
        else {
          const arc = Math.random() < 0.5;
          for (let i = 0; i < 5; i++) objs.push({ x: x + i * 32, y: arc ? GY - 40 - Math.sin((i / 4) * Math.PI) * 110 : GY - 40, r: 12, kind: "coin", t: i });
        }
      }
    };

    const drawFox = (t: number, x: number, y: number) => {
      const run = t / 70;
      const air = y < GY - 1;
      const sq = squash * 0.25;
      ctx.save(); ctx.translate(x, y);
      if (hurt > 0 && Math.floor(t / 80) % 2 === 0) ctx.globalAlpha = 0.4;
      if (now() < starUntil) { ctx.shadowColor = C.star; ctx.shadowBlur = 30; }
      ctx.scale(1 - sq * 0.5, 1 + sq);
      // tail
      ctx.fillStyle = C.fox;
      ctx.save(); ctx.translate(-22, -30); ctx.rotate(Math.sin(run) * 0.4 - 0.5);
      ctx.beginPath(); ctx.ellipse(-12, 0, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.belly; ctx.beginPath(); ctx.ellipse(-24, 0, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // legs
      ctx.strokeStyle = C.foxDeep; ctx.lineWidth = 6; ctx.lineCap = "round";
      const l1 = air ? 0.6 : Math.sin(run) * 0.8, l2 = air ? -0.4 : -Math.sin(run) * 0.8;
      for (const [lx, a] of [[-8, l1], [10, l2]] as const) {
        ctx.beginPath(); ctx.moveTo(lx, -14); ctx.lineTo(lx + Math.sin(a) * 12, -14 + Math.cos(a) * 13); ctx.stroke();
      }
      // body
      ctx.fillStyle = C.fox;
      ctx.beginPath(); ctx.ellipse(0, -28, 24, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = C.belly; ctx.beginPath(); ctx.ellipse(6, -22, 13, 10, 0, 0, Math.PI * 2); ctx.fill();
      // head
      const bob = air ? 0 : Math.sin(run * 2) * 1.5;
      ctx.translate(18, -48 + bob);
      ctx.fillStyle = C.fox;
      ctx.beginPath(); ctx.moveTo(-10, -8); ctx.lineTo(-6, -26); ctx.lineTo(2, -10); ctx.fill();
      ctx.beginPath(); ctx.moveTo(4, -10); ctx.lineTo(12, -25); ctx.lineTo(14, -6); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.belly; ctx.beginPath(); ctx.ellipse(10, 5, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.eye; ctx.beginPath(); ctx.arc(19, 3, 3, 0, Math.PI * 2); ctx.fill();
      const blink = Math.sin(t / 400) > 0.97;
      if (hurt > 0) { ctx.strokeStyle = C.eye; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(2, -6); ctx.lineTo(8, 0); ctx.moveTo(8, -6); ctx.lineTo(2, 0); ctx.stroke(); }
      else if (blink) { ctx.fillRect(2, -3, 7, 2); }
      else { ctx.beginPath(); ctx.arc(5, -3, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(6, -4, 1.3, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "rgba(255,93,122,0.5)"; ctx.beginPath(); ctx.arc(4, 6, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };

    const drawObj = (o: Obj, t: number) => {
      ctx.save(); ctx.translate(o.x, o.y);
      if (o.kind === "coin") {
        const sx = Math.abs(Math.cos(t / 200 + o.t));
        ctx.shadowColor = C.gold; ctx.shadowBlur = 12; ctx.fillStyle = C.goldDeep;
        ctx.beginPath(); ctx.ellipse(0, 0, o.r * Math.max(sx, 0.15), o.r, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.gold; ctx.beginPath(); ctx.ellipse(0, 0, o.r * 0.75 * Math.max(sx, 0.12), o.r * 0.75, 0, 0, Math.PI * 2); ctx.fill();
      } else if (o.kind === "gem") {
        ctx.translate(0, Math.sin(t / 200) * 4);
        ctx.shadowColor = C.gem; ctx.shadowBlur = 20; ctx.fillStyle = C.gem;
        ctx.beginPath(); ctx.moveTo(0, -o.r); ctx.lineTo(o.r, -o.r * 0.2); ctx.lineTo(0, o.r); ctx.lineTo(-o.r, -o.r * 0.2); ctx.closePath(); ctx.fill();
      } else if (o.kind === "spike") {
        ctx.fillStyle = C.spike;
        for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 12 - 8, 0); ctx.lineTo(i * 12, -26); ctx.lineTo(i * 12 + 8, 0); ctx.fill(); }
      } else if (o.kind === "rock") {
        ctx.rotate(-t / 150);
        ctx.fillStyle = C.rock; ctx.beginPath(); ctx.arc(0, 0, o.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.arc(5, 4, 5, 0, Math.PI * 2); ctx.arc(-6, -5, 3, 0, Math.PI * 2); ctx.fill();
      } else if (o.kind === "bat") {
        const flap = Math.sin(t / 60 + o.t);
        ctx.translate(0, Math.sin(t / 250 + o.t) * 10);
        ctx.fillStyle = C.bat;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-18, -14 * flap, -30, 4 * flap); ctx.quadraticCurveTo(-16, 4, 0, 6); ctx.fill();
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(18, -14 * flap, 30, 4 * flap); ctx.quadraticCurveTo(16, 4, 0, 6); ctx.fill();
        ctx.beginPath(); ctx.arc(0, 2, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ff4a6a"; ctx.fillRect(-5, 0, 3, 3); ctx.fillRect(2, 0, 3, 3);
      } else {
        ctx.translate(0, Math.sin(t / 200) * 5);
        ctx.shadowColor = o.kind === "star" ? C.star : C.heart; ctx.shadowBlur = 20;
        ctx.font = `${o.r * 2}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(o.kind === "star" ? "⭐" : "❤️", 0, 0);
      }
      ctx.restore();
    };

    const now = () => performance.now();
    const finish = () => {
      if (done) return;
      done = true; haptic("success");
      setTimeout(() => endRef.current(score), 700);
    };

    const loop = (t: number) => {
      const dt = Math.min(2.5, (t - last) / 16.67);
      last = t;
      const elapsed = (t - start) / 1000;
      const timeLeft = Math.max(0, DURATION - elapsed);
      const star = t < starUntil;
      const speed = done ? 0 : (5 + elapsed * 0.12) * (star ? 1.4 : 1);
      dist += speed * dt;

      // physics
      vy += 0.7 * dt; fy += vy * dt;
      if (fy >= 0) { if (vy > 4) squash = 0.6; fy = 0; vy = 0; jumps = 0; }
      squash = Math.max(0, squash - 0.08 * dt);
      hurt = Math.max(0, hurt - dt / 60);
      const X = fx(), Y = GY + fy;

      if (!done && dist >= nextSpawn) { spawn(elapsed); nextSpawn = dist + 200 + Math.random() * 180 - Math.min(80, elapsed * 1.5); }

      ctx.save();
      if (shake > 0) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.9; if (shake < 0.3) shake = 0; }
      // sky
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, C.sky1); g.addColorStop(1, C.sky2);
      ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (let i = 0; i < 30; i++) {
        const sx = ((i * 97 - dist * 0.05) % (W + 20) + W + 20) % (W + 20), sy = (i * 53) % (GY - 120);
        ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(t / 700 + i)); ctx.fillRect(sx, sy, 2, 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff6c8"; ctx.beginPath(); ctx.arc(W - 60, 70, 26, 0, Math.PI * 2); ctx.fill();
      // hills (parallax)
      for (const [col, amp, par, base] of [[C.hill1, 50, 0.2, 60], [C.hill2, 35, 0.45, 20]] as const) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, GY);
        for (let x = 0; x <= W; x += 10) ctx.lineTo(x, GY - base - Math.sin((x + dist * par) / 90) * amp - amp);
        ctx.lineTo(W, GY); ctx.fill();
      }
      // ground
      ctx.fillStyle = C.ground; ctx.fillRect(0, GY, W, H - GY);
      ctx.fillStyle = C.groundTop; ctx.fillRect(0, GY, W, 8);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      for (let x = -((dist) % 40); x < W; x += 40) ctx.fillRect(x, GY + 20, 20, 6);

      // objects
      objs = objs.filter((o) => {
        o.x -= speed * dt;
        if (o.kind === "rock") o.x -= 1.5 * dt;
        if (star && (o.kind === "coin" || o.kind === "gem")) {
          const dx = X - o.x, dy = Y - 30 - o.y, d = Math.hypot(dx, dy);
          if (d < 200) { o.x += (dx / d) * 8 * dt; o.y += (dy / d) * 8 * dt; }
        }
        const dx = o.x - (X + 4), dy = o.y - (Y - 32);
        const hit = !done && Math.abs(dx) < 22 + o.r * 0.6 && Math.abs(dy) < 30 + o.r * 0.6;
        if (hit) {
          if (o.kind === "spike" || o.kind === "rock" || o.kind === "bat") {
            if (star) { burst(o.x, o.y, C.star, 20); score += 3; floats.push({ x: o.x, y: o.y - 20, text: "SMASH +3", life: 1, color: C.star }); return false; }
            if (hurt > 0) return true;
            lives -= 1; combo = 1; streak = 0; shake = 14; hurt = 1.2; haptic("error");
            burst(o.x, o.y, C.heart, 22);
            floats.push({ x: X, y: Y - 80, text: "OUCH!", life: 1, color: C.heart });
            if (lives <= 0) finish();
            return false;
          }
          if (o.kind === "heart") { lives = Math.min(3, lives + 1); haptic("medium"); burst(o.x, o.y, C.heart, 16); floats.push({ x: o.x, y: o.y - 20, text: "+1 ❤", life: 1, color: C.heart }); return false; }
          if (o.kind === "star") { starUntil = t + 5000; haptic("medium"); burst(o.x, o.y, C.star, 24); floats.push({ x: o.x, y: o.y - 20, text: "SUPER FOX!", life: 1, color: C.star }); return false; }
          streak += 1; combo = Math.min(5, 1 + Math.floor(streak / 8));
          const pts = (o.kind === "gem" ? 5 : 1) * combo;
          score += pts; haptic("light");
          burst(o.x, o.y, o.kind === "gem" ? C.gem : C.gold, 8);
          floats.push({ x: o.x, y: o.y - 14, text: `+${pts}`, life: 1, color: o.kind === "gem" ? C.gem : C.gold });
          return false;
        }
        if (o.x < -50) { if (o.kind === "coin" || o.kind === "gem") { streak = 0; combo = 1; } return false; }
        drawObj(o, t);
        return true;
      });

      // shadow + fox
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(X, GY + 4, Math.max(8, 26 + fy * 0.1), 5, 0, 0, Math.PI * 2); ctx.fill();
      drawFox(t, X, Y);

      parts = parts.filter((p) => {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.15 * dt; p.life -= 0.025 * dt;
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0, p.size * p.life), 0, Math.PI * 2); ctx.fill();
        return p.life > 0;
      });
      floats = floats.filter((f) => {
        f.y -= 1.1 * dt; f.life -= 0.022 * dt;
        ctx.globalAlpha = Math.max(0, f.life); ctx.fillStyle = f.color;
        ctx.font = "22px 'Lilita One', system-ui"; ctx.textAlign = "center";
        ctx.fillText(f.text, f.x, f.y);
        return f.life > 0;
      });
      ctx.globalAlpha = 1;
      if (!done && elapsed < 3) {
        ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = "18px 'Lilita One', system-ui"; ctx.textAlign = "center";
        ctx.fillText("Tap to jump · tap twice for double jump", W / 2, 60);
      }
      ctx.restore();

      if (t - lastHud > 80 || done) { lastHud = t; setHud({ score, lives, time: timeLeft, combo, star }); }
      if (timeLeft <= 0) finish();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("pointerdown", onDown);
    };
  }, [countdown]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <div className="font-display text-3xl text-gold-gradient">{hud.score}</div>
        <div className="flex gap-1 text-xl">
          {[0, 1, 2].map((i) => (
            <span key={i} className={i < hud.lives ? "" : "opacity-20 grayscale"}>❤️</span>
          ))}
        </div>
        <div className={`rounded-full px-3 py-1 font-display text-lg ${hud.combo > 1 ? "bg-coral text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
          x{hud.combo}
        </div>
      </div>
      <div className="mx-4 mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-gold transition-[width] duration-200" style={{ width: `${(hud.time / DURATION) * 100}%` }} />
      </div>
      <div ref={wrapRef} className="relative mt-3 flex-1 touch-none select-none">
        <canvas ref={canvasRef} className="absolute inset-0" />
        {countdown > 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/40">
            <div key={countdown} className="font-display text-8xl text-gold-gradient animate-in zoom-in-50 fade-in duration-500">
              {countdown}
            </div>
            <p className="px-6 text-center text-foreground">🦊 Tap to jump over spikes, rocks & bats. Grab ⭐ to become Super Fox!</p>
          </div>
        )}
        {hud.star && countdown === 0 && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-secondary px-3 py-1 text-sm">⭐ Super Fox!</div>
        )}
      </div>
    </div>
  );
}
