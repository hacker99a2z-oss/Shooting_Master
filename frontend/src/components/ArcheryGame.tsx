import rangeBg from "@/assets/archery-range.jpg";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { Target } from "lucide-react";
import { haptic } from "@/lib/tg";
import { COINS_PER_KILL, targetLifetimeMs, targetSpeed, targetZigzags } from "@/lib/rules";
import { loadSensitivity, sensFactor } from "@/lib/sensitivity";

// Archery range: one target at a time (the server decides 9–12 in total).
// Drag anywhere on the field (or on the bow button) to move the sight, hold to draw the bow,
// release to shoot. A half-drawn bow drops the arrow short of the sight; a full draw lands on it.
// Each target hit pays 10 coins. Targets get shorter-lived (4 s → 1 s) and start moving later on.

const DRAW_FULL_MS = 550; // time to fully draw the bow
const FLIGHT_MS = 380; // arrow travel time
const RELOAD_MS = 300;
const BG_ASPECT = 720 / 1280; // archery-range.jpg
const BG_HORIZON = 0.31; // grass starts at this share of the picture height

type Tgt = { index: number; x: number; y: number; scale: number; born: number; life: number; vx: number; vy: number; zig: boolean; turnAt: number; state: "live" | "hit" | "gone"; endAt: number; hitDx: number; hitDy: number };
type Arrow = { sx: number; sy: number; ex: number; ey: number; t0: number };
type Stuck = { x: number; y: number; a: number; born: number };
type Part = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };
type Float = { x: number; y: number; text: string; life: number; color: string; size: number };

// Canvas palette matched to the cartoon range art.
const COL = {
  wood: "#8a5a2b", woodDark: "#5e3a17", woodLight: "#c58a4a", string: "#f6efe0", straw: "#e8c768",
  rings: ["#ffffff", "#2b2b33", "#3aa6f0", "#ef3d4a", "#ffd23f"], gold: "#ffd45a", red: "#ff4a55", green: "#46e08a",
  sight: "#ffffff", sightTick: "#ff3a4a", fletch: "#ef3d4a", steel: "#d8dde6",
};

export function ArcheryGame({ onEnd, targetTotal }: { onEnd: (score: number, hits: number) => void; targetTotal: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const powerRef = useRef<SVGCircleElement>(null);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const input = useRef({ aimX: 0, aimY: 0, aimInit: false, drawing: false, drawStart: 0, fire: false, firePower: 0 });
  const ptr = useRef<{ id: number; lx: number; ly: number } | null>(null);
  const sens = useRef(50);
  useEffect(() => { sens.current = loadSensitivity().aim; }, []);
  const [hud, setHud] = useState({ score: 0, hits: 0, shown: 0, total: targetTotal, timeLeft: 0 });
  const [countdown, setCountdown] = useState(3);
  const [drawOn, setDrawOn] = useState(false);
  const readyRef = useRef(false);

  useEffect(() => {
    if (countdown <= 0) return;
    haptic("light");
    const t = setTimeout(() => setCountdown((c) => c - 1), 700);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0) return;
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bgImg = new Image(); bgImg.src = rangeBg;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, bgX = 0, bgY = 0, bgW = 0, bgH = 0, fieldTop = 0, fieldBottom = 0, baseR = 30;
    const inp = input.current;
    const resize = () => {
      W = wrap.clientWidth; H = wrap.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // background "cover" fit, then the target band sits on the grass in front of the horizon
      const s = Math.max(W / (H * BG_ASPECT), 1);
      bgH = H * s; bgW = bgH * BG_ASPECT; bgX = (W - bgW) / 2; bgY = (H - bgH) / 2;
      const horizon = bgY + bgH * BG_HORIZON;
      fieldTop = horizon + (H - horizon) * 0.14;
      fieldBottom = horizon + (H - horizon) * 0.5;
      baseR = Math.max(24, Math.min(W, 480) * 0.095);
      if (!inp.aimInit) { inp.aimX = W / 2; inp.aimY = (fieldTop + fieldBottom) / 2; inp.aimInit = true; }
    };
    resize();
    window.addEventListener("resize", resize);

    const total = Math.max(1, targetTotal);
    let cur: Tgt | null = null, nextIdx = 0, nextAt = performance.now() + 400;
    let arrows: Arrow[] = [], stuck: Stuck[] = [], parts: Part[] = [], floats: Float[] = [];
    let score = 0, hits = 0, shake = 0, done = false, lastHud = 0, raf = 0, lastShot = -1e9;
    const finishTimers: ReturnType<typeof setTimeout>[] = [];
    let last = performance.now();

    const bowX = () => W / 2, bowY = () => H - 64;
    const depth = (y: number) => 0.72 + 0.5 * Math.max(0, Math.min(1, (y - fieldTop) / Math.max(1, fieldBottom - fieldTop)));
    const radius = (g: Tgt) => baseR * depth(g.y) * g.scale;
    const burst = (x: number, y: number, color: string, n = 14, sp = 4) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = Math.random() * sp + 1;
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, color, size: Math.random() * 4 + 2 });
      }
    };
    const finish = (delay: number) => {
      if (done) return;
      done = true;
      finishTimers.push(setTimeout(() => endRef.current(score, hits), delay));
    };
    const spawn = (now: number) => {
      const index = nextIdx++;
      const speed = targetSpeed(index, total) * W;
      const zig = targetZigzags(index, total);
      const scale = 1 - 0.25 * (index / Math.max(1, total - 1));
      const x = W * (0.22 + Math.random() * 0.56);
      const y = fieldTop + Math.random() * (fieldBottom - fieldTop);
      const dir = Math.random() < 0.5 ? -1 : 1;
      cur = { index, x, y, scale, born: now, life: targetLifetimeMs(index, total), vx: dir * speed, vy: zig ? (Math.random() < 0.5 ? -1 : 1) * speed * 0.35 : 0, zig, turnAt: now + 350 + Math.random() * 350, state: "live", endAt: 0, hitDx: 0, hitDy: 0 };
      haptic("light");
    };
    // Where an arrow released with this much draw would land (weak draws fall short).
    const landing = (power: number) => {
      const drop = Math.pow(1 - Math.max(0, Math.min(1, power)), 1.5) * H * 0.2;
      return { x: inp.aimX, y: Math.min(H - 10, inp.aimY + drop) };
    };
    const arrowAt = (a: Arrow, p: number) => {
      const dist = Math.hypot(a.ex - a.sx, a.ey - a.sy);
      return { x: a.sx + (a.ex - a.sx) * p, y: a.sy + (a.ey - a.sy) * p - Math.sin(Math.PI * p) * dist * 0.14 };
    };

    // ---- drawing helpers
    const drawBg = () => {
      if (bgImg.complete && bgImg.naturalWidth) { ctx.drawImage(bgImg, bgX, bgY, bgW, bgH); return; }
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#4aa3f0"); g.addColorStop(0.3, "#bfe6ff"); g.addColorStop(0.31, "#7ccf3c"); g.addColorStop(1, "#4f9e22");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    };
    // Arrow pointing "up" in local space (tip at negative y), drawn at (x, y) rotated by angle+90°.
    const drawArrowShape = (x: number, y: number, angle: number, s: number, stuckIn = false) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle + Math.PI / 2); ctx.scale(s, s);
      const len = stuckIn ? 46 : 78;
      ctx.strokeStyle = COL.woodLight; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, stuckIn ? 0 : -len / 2); ctx.lineTo(0, stuckIn ? len : len / 2); ctx.stroke();
      if (!stuckIn) { ctx.fillStyle = COL.steel; ctx.beginPath(); ctx.moveTo(0, -len / 2 - 12); ctx.lineTo(-6, -len / 2 + 2); ctx.lineTo(6, -len / 2 + 2); ctx.closePath(); ctx.fill(); }
      const fy = stuckIn ? len : len / 2;
      ctx.fillStyle = COL.fletch;
      ctx.beginPath(); ctx.moveTo(0, fy - 16); ctx.lineTo(-8, fy - 4); ctx.lineTo(-8, fy + 4); ctx.lineTo(0, fy - 6); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, fy - 16); ctx.lineTo(8, fy - 4); ctx.lineTo(8, fy + 4); ctx.lineTo(0, fy - 6); ctx.fill();
      ctx.restore();
    };
    const drawTarget = (g: Tgt, now: number) => {
      const r = radius(g);
      let tilt = 1, alpha = 1, sink = 0;
      if (g.state === "hit") { const k = Math.min(1, (now - g.endAt) / 550); tilt = Math.max(0.05, 1 - k); alpha = 1 - k * 0.6; }
      if (g.state === "gone") { const k = Math.min(1, (now - g.endAt) / 320); sink = k * r * 2.4; alpha = 1 - k; }
      ctx.save(); ctx.globalAlpha = alpha;
      // shadow + legs
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(g.x, g.y + r * 1.75, r * 0.9, r * 0.18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.rect(g.x - r * 1.4, -10, r * 2.8, g.y + r * 1.8 + 10); ctx.clip();
      ctx.translate(0, sink);
      ctx.strokeStyle = COL.woodDark; ctx.lineWidth = Math.max(3, r * 0.12); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(g.x - r * 0.35, g.y); ctx.lineTo(g.x - r * 0.75, g.y + r * 1.75); ctx.moveTo(g.x + r * 0.35, g.y); ctx.lineTo(g.x + r * 0.75, g.y + r * 1.75); ctx.moveTo(g.x, g.y); ctx.lineTo(g.x, g.y + r * 1.7); ctx.stroke();
      // face (squashes vertically when knocked back)
      ctx.save(); ctx.translate(g.x, g.y); ctx.scale(1, tilt);
      ctx.fillStyle = COL.straw; ctx.beginPath(); ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = COL.wood; ctx.lineWidth = 2; ctx.stroke();
      COL.rings.forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, r * (1 - i * 0.2), 0, Math.PI * 2); ctx.fill(); });
      ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(0, 0, r * (1 - i * 0.2), 0, Math.PI * 2); ctx.stroke(); }
      if (g.state === "hit") drawArrowShape(g.hitDx, g.hitDy, -Math.PI / 2 + 0.25, Math.max(0.45, r / 70), true);
      ctx.restore();
      ctx.restore();
      // time-left ring
      if (g.state === "live") {
        const left = Math.max(0, 1 - (now - g.born) / g.life);
        const c = left > 0.5 ? COL.green : left > 0.25 ? COL.gold : COL.red;
        ctx.save(); ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(g.x, g.y, r * 1.1 + 7, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 10; ctx.lineWidth = 4; ctx.lineCap = "round";
        ctx.beginPath(); ctx.arc(g.x, g.y, r * 1.1 + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke(); ctx.restore();
      }
    };
    const drawBow = (now: number, power: number) => {
      const bx = bowX(), by = bowY();
      const angle = Math.atan2(inp.aimY - by, inp.aimX - bx);
      const pull = power * 38;
      const loaded = now - lastShot > RELOAD_MS;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(angle + Math.PI / 2);
      // string
      ctx.strokeStyle = COL.string; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-62, 10); ctx.lineTo(0, 10 + pull); ctx.lineTo(62, 10); ctx.stroke();
      // limbs
      ctx.strokeStyle = COL.woodDark; ctx.lineWidth = 10; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-62, 10); ctx.quadraticCurveTo(-30, -40 + pull * 0.25, 0, -30); ctx.quadraticCurveTo(30, -40 + pull * 0.25, 62, 10); ctx.stroke();
      ctx.strokeStyle = COL.wood; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(-62, 10); ctx.quadraticCurveTo(-30, -40 + pull * 0.25, 0, -30); ctx.quadraticCurveTo(30, -40 + pull * 0.25, 62, 10); ctx.stroke();
      ctx.fillStyle = COL.gold; ctx.fillRect(-7, -36, 14, 14);
      ctx.restore();
      if (loaded && !done) drawArrowShape(bx + Math.cos(angle) * (-pull + 4), by + Math.sin(angle) * (-pull + 4), angle, 1);
    };
    const drawSight = (now: number, power: number) => {
      const r = 15 + Math.sin(now / 140) * 1.2;
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 4;
      ctx.globalAlpha = inp.drawing ? 1 : 0.75;
      ctx.strokeStyle = COL.sight; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(inp.aimX, inp.aimY, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = COL.sightTick;
      for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; ctx.beginPath(); ctx.moveTo(inp.aimX + Math.cos(a) * (r - 6), inp.aimY + Math.sin(a) * (r - 6)); ctx.lineTo(inp.aimX + Math.cos(a) * (r + 8), inp.aimY + Math.sin(a) * (r + 8)); ctx.stroke(); }
      ctx.fillStyle = COL.sight; ctx.beginPath(); ctx.arc(inp.aimX, inp.aimY, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // predicted flight while drawing
      if (inp.drawing && !done) {
        const end = landing(power), a: Arrow = { sx: bowX(), sy: bowY() - 30, ex: end.x, ey: end.y, t0: 0 };
        ctx.save(); ctx.fillStyle = power >= 0.98 ? COL.gold : COL.sight; ctx.globalAlpha = 0.85;
        for (let i = 1; i <= 12; i++) { const q = arrowAt(a, i / 12); ctx.beginPath(); ctx.arc(q.x, q.y, 2.6 - i * 0.12, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
    };

    const loop = (now: number) => {
      const dt = Math.min(50, now - last) / 1000;
      last = now;
      const power = inp.drawing ? Math.min(1, (now - inp.drawStart) / DRAW_FULL_MS) : 0;

      // ---- target lifecycle
      if (!done && !cur && nextIdx < total && now >= nextAt) spawn(now);
      const g = cur as Tgt | null;
      if (g && g.state === "live") {
        const r = radius(g);
        g.x += g.vx * dt;
        if (g.x < r + 12) { g.x = r + 12; g.vx = Math.abs(g.vx); }
        if (g.x > W - r - 12) { g.x = W - r - 12; g.vx = -Math.abs(g.vx); }
        if (g.zig) {
          g.y += g.vy * dt;
          if (g.y < fieldTop) { g.y = fieldTop; g.vy = Math.abs(g.vy); }
          if (g.y > fieldBottom) { g.y = fieldBottom; g.vy = -Math.abs(g.vy); }
          if (now >= g.turnAt) { if (Math.random() < 0.6) g.vx = -g.vx; g.vy = (Math.random() < 0.5 ? -1 : 1) * Math.abs(g.vx) * (0.2 + Math.random() * 0.4); g.turnAt = now + 300 + Math.random() * 400; }
        }
        if (now - g.born >= g.life) {
          g.state = "gone"; g.endAt = now; nextAt = now + 450;
          floats.push({ x: g.x, y: g.y - r - 18, text: "MISS", life: 1, color: COL.red, size: 24 });
          haptic("light");
        }
      }
      if (g && g.state !== "live" && now - g.endAt > (g.state === "hit" ? 600 : 340)) cur = null;

      // ---- shooting
      if (inp.fire) {
        inp.fire = false;
        if (!done && now - lastShot > RELOAD_MS) {
          const end = landing(inp.firePower);
          arrows.push({ sx: bowX(), sy: bowY() - 30, ex: end.x, ey: end.y, t0: now });
          lastShot = now; haptic("medium");
        }
      }
      arrows = arrows.filter((a) => {
        if ((now - a.t0) / FLIGHT_MS < 1) return true;
        const t = cur as Tgt | null;
        if (t && t.state === "live") {
          const r = radius(t), d = Math.hypot(a.ex - t.x, a.ey - t.y);
          if (d <= r) {
            const ring = d / r;
            const bonus = ring < 0.2 ? 10 : ring < 0.4 ? 5 : ring < 0.6 ? 2 : 0;
            hits++; score += COINS_PER_KILL + bonus; shake = ring < 0.2 ? 10 : 6;
            t.state = "hit"; t.endAt = now; t.hitDx = a.ex - t.x; t.hitDy = a.ey - t.y; nextAt = now + 650;
            burst(a.ex, a.ey, COL.straw, 16, 4); burst(a.ex, a.ey, COL.gold, 14, 5);
            floats.push({ x: t.x, y: t.y - r - 20, text: `+${COINS_PER_KILL}`, life: 1, color: COL.gold, size: 28 });
            if (ring < 0.2) floats.push({ x: t.x, y: t.y - r - 50, text: "BULLSEYE!", life: 1.2, color: COL.sight, size: 22 });
            haptic("success");
            return false;
          }
        }
        stuck.push({ x: a.ex, y: a.ey, a: Math.atan2(a.ey - a.sy, a.ex - a.sx), born: now });
        burst(a.ex, a.ey, "#9bd35a", 6, 2);
        return false;
      });
      stuck = stuck.filter((s) => now - s.born < 900);

      // ---- end of match: all targets shown and resolved
      if (!done && nextIdx >= total && !cur && arrows.length === 0) {
        floats.push({ x: W / 2, y: H * 0.42, text: hits === total ? "PERFECT!" : `${hits}/${total} HIT`, life: 1.6, color: COL.gold, size: 34 });
        haptic(hits > 0 ? "success" : "error");
        finish(1100);
      }

      // ---- draw
      ctx.save();
      if (shake > 0) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.85; if (shake < 0.3) shake = 0; }
      drawBg();
      const t = cur as Tgt | null;
      if (t) drawTarget(t, now);
      for (const s of stuck) { ctx.save(); ctx.globalAlpha = 1 - (now - s.born) / 900; drawArrowShape(s.x, s.y, -Math.PI / 2 + 0.3, 0.45, true); ctx.restore(); }
      for (const a of arrows) {
        const p = Math.min(1, (now - a.t0) / FLIGHT_MS), q = arrowAt(a, p), q2 = arrowAt(a, Math.min(1, p + 0.03));
        drawArrowShape(q.x, q.y, Math.atan2(q2.y - q.y, q2.x - q.x), 1 - 0.6 * p);
      }
      drawSight(now, power);
      drawBow(now, power);
      parts = parts.filter((q) => {
        q.x += q.vx; q.y += q.vy; q.vx *= 0.94; q.vy = q.vy * 0.94 + 0.15; q.life -= 0.03;
        ctx.globalAlpha = Math.max(0, q.life); ctx.fillStyle = q.color;
        ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0, q.size * q.life), 0, Math.PI * 2); ctx.fill();
        return q.life > 0;
      });
      floats = floats.filter((f) => {
        f.y -= 0.9; f.life -= 0.02;
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life)); ctx.fillStyle = f.color; ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 4;
        ctx.font = `${f.size}px 'Lilita One', system-ui`; ctx.textAlign = "center"; ctx.strokeText(f.text, f.x, f.y); ctx.fillText(f.text, f.x, f.y);
        return f.life > 0;
      });
      ctx.globalAlpha = 1;
      ctx.restore();

      if (powerRef.current) powerRef.current.style.strokeDashoffset = String(100 - power * 100);
      if (now - lastHud > 100 || done) {
        lastHud = now;
        const tl = t && t.state === "live" ? Math.max(0, 1 - (now - t.born) / t.life) : 0;
        setHud({ score, hits, shown: nextIdx, total, timeLeft: tl });
      }
      if (!readyRef.current && bgImg.complete && bgImg.naturalWidth) { wrap.dataset["sceneReady"] = "true"; readyRef.current = true; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); finishTimers.forEach(clearTimeout); window.removeEventListener("resize", resize); readyRef.current = false; };
  }, [countdown, targetTotal]);

  // ---- controls: press = start drawing, drag = move the sight, release = shoot
  const down = (e: React.PointerEvent<HTMLElement>) => {
    if (countdown > 0 || ptr.current) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    ptr.current = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
    input.current.drawing = true; input.current.drawStart = performance.now(); setDrawOn(true); haptic("light");
  };
  const move = (e: React.PointerEvent) => {
    const p = ptr.current; if (!p || p.id !== e.pointerId) return;
    const k = 1.6 * sensFactor(sens.current), wrap = wrapRef.current;
    const i = input.current;
    i.aimX += (e.clientX - p.lx) * k; i.aimY += (e.clientY - p.ly) * k;
    if (wrap) { i.aimX = Math.max(10, Math.min(wrap.clientWidth - 10, i.aimX)); i.aimY = Math.max(10, Math.min(wrap.clientHeight * 0.82, i.aimY)); }
    p.lx = e.clientX; p.ly = e.clientY;
  };
  const up = (e: React.PointerEvent, cancelled = false) => {
    const p = ptr.current; if (!p || p.id !== e.pointerId) return;
    const i = input.current;
    ptr.current = null;
    if (!cancelled) { i.fire = true; i.firePower = Math.min(1, (performance.now() - i.drawStart) / DRAW_FULL_MS); }
    i.drawing = false; setDrawOn(false);
  };
  const handlers = { onPointerDown: down, onPointerMove: move, onPointerUp: (e: React.PointerEvent) => up(e), onPointerCancel: (e: React.PointerEvent) => up(e, true) };

  return (
    <div className="game-backdrop fixed inset-0 z-50 flex justify-center select-none">
      <div className="app-column relative flex h-full w-full max-w-md flex-col bg-background">
        <div className="flex items-center justify-between gap-3 px-4 pt-4">
          <div className="font-display text-3xl text-gold-gradient">+{hud.hits * COINS_PER_KILL}</div>
          <div className="text-sm text-muted-foreground">Score {hud.score}</div>
          <div className="font-display text-xl tabular-nums">🎯 {hud.hits}/{hud.total}</div>
        </div>
        <div className="mx-4 mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-gold transition-[width] duration-100" style={{ width: `${hud.timeLeft * 100}%` }} />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">Target {Math.max(1, hud.shown)}/{hud.total}</span>
        </div>
        <div ref={wrapRef} {...handlers} className="relative mt-3 flex-1 touch-none" aria-label="Archery range — drag to aim, release to shoot" role="application">
          <canvas ref={canvasRef} className="absolute inset-0" />
          {countdown > 0 && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/50">
              <div key={countdown} className="font-display text-8xl text-gold-gradient animate-in zoom-in-50 fade-in duration-500">{countdown}</div>
              <p className="px-6 text-center font-display text-lg text-primary">Hit {hud.total} targets · +{COINS_PER_KILL} coins each</p>
              <p className="px-8 text-center text-sm text-foreground/85">Drag to aim, hold to draw the bow, let go to shoot. Targets get faster!</p>
            </div>
          )}
          <p className="pointer-events-none absolute bottom-5 left-4 max-w-[45%] text-xs font-medium text-foreground/90 drop-shadow">Drag to aim · Hold to draw · Release to shoot</p>
          <Button variant="ghost" {...handlers}
            className={`absolute bottom-5 right-5 flex h-24 w-24 touch-none items-center justify-center rounded-full border-4 border-hud-orange glow-orange transition-transform duration-100 ${drawOn ? "scale-90 bg-hud-orange/60" : "bg-background/60"}`}
            aria-label="Draw bow and shoot"
          >
            <svg className="pointer-events-none absolute inset-0 h-full w-full -rotate-90 text-gold" viewBox="0 0 36 36" aria-hidden="true">
              <circle ref={powerRef} cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="2.6" pathLength={100} strokeDasharray="100" strokeDashoffset="100" strokeLinecap="round" />
            </svg>
            <Target className="!h-11 !w-11 text-foreground" />
          </Button>
        </div>
      </div>
    </div>
  );
}
