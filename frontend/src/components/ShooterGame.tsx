import arenaBg from "@/assets/arena-bg.jpg";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Crosshair, Shield } from "lucide-react";
import { haptic } from "@/lib/tg";
import { COINS_PER_KILL, wavePlan } from "@/lib/rules";
import { loadSensitivity, sensFactor } from "@/lib/sensitivity";

// Arena shooter: enemies come from the front (top), max 3-4 at once.
// Left joystick moves the hero. Hold SHIELD to raise the shield in front.
// Hold SHOOT to show a laser sight, drag to aim, release to fire.
// One hit kills (both sides). Cars/crates/barrels block bullets.
// Every bullet (ours and theirs) takes 1 second to reach its target point.

const TRAVEL_FRAMES = 28; // ~0.45s at 60fps — faster bullets for both sides

type Bullet = { x: number; y: number; vx: number; vy: number; enemy: boolean; life: number };
type Enemy = { x: number; y: number; tx: number; ty: number; cool: number; warn: number; phase: number; flash: number; dir: number; dead: number; spin: number };
type Part = { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number };
type Float = { x: number; y: number; text: string; life: number; color: string };
type Cover = { x: number; y: number; w: number; h: number; kind: "barrier" | "crate" | "barrel" | "case" };

// Canvas palette matched to the military-base arena art.
const COL = {
  sky1: "#4a8fe0", sky2: "#a8d4ff", bldg: "#7c8aa8", bldg2: "#95a3c0", win: "#6fe3ff", road: "#6a6a70",
  shield: "#4ae3ff", laser: "#ff2b3a", bulletMe: "#6fe8ff", bulletEnemy: "#ff4a2a", gold: "#ffd45a", red: "#ff3a4a",
};

const COVER_SIZES: Record<Cover["kind"], () => { w: number; h: number }> = {
  barrier: () => ({ w: 90 + Math.random() * 30, h: 38 }),
  crate: () => ({ w: 44, h: 42 }),
  barrel: () => ({ w: 30, h: 40 }),
  case: () => ({ w: 58, h: 34 }),
};
const KINDS: Cover["kind"][] = ["barrier", "barrier", "crate", "crate", "barrel", "case"];

// New random obstacle layout every game, spread over the whole field: the arena is split into a grid
// and each cell gets at most one obstacle at a random spot inside it. Obstacles never overlap.
function randomCovers(WW: number, H: number, heroX: number, heroY: number): Cover[] {
  const out: Cover[] = [];
  const top = H * 0.36, bottom = H * 0.92;
  const cols = Math.max(3, Math.round(WW / 170));
  const rows = Math.max(3, Math.round((bottom - top) / 130));
  const cw = WW / cols, ch = (bottom - top) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() < 0.3) continue; // leave some cells empty for open lanes
      for (let tries = 0; tries < 8; tries++) {
        const kind = KINDS[Math.floor(Math.random() * KINDS.length)]!;
        const { w, h } = COVER_SIZES[kind]();
        const x = Math.max(20, Math.min(WW - 20 - w, c * cw + Math.random() * Math.max(1, cw - w)));
        const y = Math.max(top, Math.min(bottom - h, top + r * ch + Math.random() * Math.max(1, ch - h)));
        if (Math.hypot(x + w / 2 - heroX, y + h / 2 - heroY) < 110) continue;
        if (out.some((o) => x < o.x + o.w + 40 && x + w + 40 > o.x && y < o.y + o.h + 40 && y + h + 40 > o.y)) continue;
        out.push({ x, y, w, h, kind });
        break;
      }
    }
  }
  return out;
}

export function ShooterGame({ onEnd, enemyTotal }: { onEnd: (score: number, kills: number) => void; enemyTotal: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const input = useRef({ mx: 0, my: 0, shieldA: -Math.PI / 2, shield: false, aiming: false, aimX: 0, aimY: 0, fire: false, aimInit: false });
  const [hud, setHud] = useState({ score: 0, kills: 0, total: 0 });
  const [countdown, setCountdown] = useState(3);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [shieldOn, setShieldOn] = useState(false);
  const [aimOn, setAimOn] = useState(false);
  const joy = useRef<{ id: number; cx: number; cy: number } | null>(null);
  const aimPtr = useRef<{ id: number; lx: number; ly: number } | null>(null);
  const shieldPtr = useRef<{ id: number; cx: number; cy: number } | null>(null);
  const sens = useRef(loadSensitivity());

  useEffect(() => {
    if (countdown <= 0) return;
    haptic("light");
    const t = setTimeout(() => setCountdown((c) => c - 1), 700);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0) return;
    const canvas = canvasRef.current!, wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const bgImg = new Image(); bgImg.src = arenaBg;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;
    const resize = () => {
      W = wrap.clientWidth; H = wrap.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // The arena is 3 screens wide; the camera follows the hero left and right.
    const WW = W * 3;
    const p = { x: WW / 2, y: H * 0.8, walk: 0, dead: 0, shieldT: 0, recoil: 0, gunA: -Math.PI / 2, face: -Math.PI / 2, shieldA: -Math.PI / 2 };
    let camX = WW / 2 - W / 2;
    let enemies: Enemy[] = [], bullets: Bullet[] = [], parts: Part[] = [], floats: Float[] = [];
    let score = 0, kills = 0, shake = 0, spawnCd = 30, done = false, lastHud = 0, raf = 0;
    // This match: random 9–12 enemies, sent in waves 1, 1, 2, 3, 4…; next wave comes once the last is cleared.
    const total = enemyTotal;
    const waves = wavePlan(total);
    let waveIdx = 0, waveQueue = 0;
    const covers = randomCovers(WW, H, p.x, p.y);
    const start = performance.now();
    let last = start;
    const inp = input.current;

    const burst = (x: number, y: number, color: string, n = 14, sp = 4) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = Math.random() * sp + 1;
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, color, size: Math.random() * 4 + 2 });
      }
    };
    const fireBullet = (sx: number, sy: number, tx: number, ty: number, enemy: boolean) => {
      bullets.push({ x: sx, y: sy, vx: (tx - sx) / TRAVEL_FRAMES, vy: (ty - sy) / TRAVEL_FRAMES, enemy, life: TRAVEL_FRAMES * 3 });
    };
    // Enemies appear at the far end of the yard near the hero's view, then hunt him down.
    // tx is unused; ty = how close (px) this enemy likes to get before strafing.
    const spawnEnemy = () => {
      const x = Math.max(40, Math.min(WW - 40, camX + 40 + Math.random() * (W - 80)));
      enemies.push({ x, y: H * 0.3, tx: x, ty: 150 + Math.random() * 90, cool: 60 + Math.random() * 50, warn: 0, phase: Math.random() * 6, flash: 0, dir: Math.random() < 0.5 ? -1 : 1, dead: 0, spin: Math.random() < 0.5 ? -1 : 1 });
    };
    const depth = (y: number) => 0.5 + 0.75 * Math.max(0, Math.min(1, y / H));
    const finish = (delay: number) => {
      if (done) return;
      done = true;
      setTimeout(() => endRef.current(score, kills), delay);
    };

    // Red/black armored soldier facing the viewer. gunA = gun angle in world space.
    const drawSoldier = (walk: number, gunA: number, flash: number, warn: boolean, sc: number, back = false) => {
      ctx.save(); ctx.scale(sc, sc);
      const step = Math.sin(walk) * 3;
      ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.ellipse(0, 30, 22, 6, 0, 0, Math.PI * 2); ctx.fill();
      // legs, knee pads, boots
      ctx.fillStyle = "#1c1d26"; ctx.beginPath(); ctx.roundRect(-12, 6, 10, 22 + step, 4); ctx.roundRect(2, 6, 10, 22 - step, 4); ctx.fill();
      ctx.fillStyle = "#c8202e"; ctx.beginPath(); ctx.roundRect(-12, 14 + step / 2, 10, 6, 2); ctx.roundRect(2, 14 - step / 2, 10, 6, 2); ctx.fill();
      ctx.fillStyle = "#0e0e14"; ctx.beginPath(); ctx.ellipse(-7, 28 + step, 7, 4, 0, 0, Math.PI * 2); ctx.ellipse(7, 28 - step, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      // torso armor
      const g = ctx.createLinearGradient(0, -22, 0, 8); g.addColorStop(0, "#343744"); g.addColorStop(1, "#15161e");
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(-17, -22, 34, 30, 9); ctx.fill();
      ctx.fillStyle = "#d22a35"; ctx.beginPath(); ctx.roundRect(-11, -18, 22, 13, 5); ctx.fill();
      ctx.fillStyle = "#ff6a5a"; ctx.fillRect(-7, -14, 14, 2);
      ctx.fillStyle = "#b81e2a"; ctx.beginPath(); ctx.arc(-17, -17, 7, 0, Math.PI * 2); ctx.arc(17, -17, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0e0e14"; ctx.fillRect(-16, 3, 32, 5);
      // helmet + glowing visor
      ctx.fillStyle = "#22242e"; ctx.beginPath(); ctx.ellipse(0, -38, 16, 15, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c8202e"; ctx.beginPath(); ctx.ellipse(0, -50, 5, 4, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(-2, -53, 4, 10);
      ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.beginPath(); ctx.ellipse(-6, -46, 6, 3, -0.4, 0, Math.PI * 2); ctx.fill();
      if (!back) {
        ctx.save(); ctx.shadowColor = COL.laser; ctx.shadowBlur = warn ? 18 : 8;
        ctx.fillStyle = warn ? "#ffd0d0" : "#ff2b3a"; ctx.beginPath(); ctx.roundRect(-12, -41, 24, 7, 3.5); ctx.fill(); ctx.restore();
      } else {
        // seen from behind: backpack + helmet strap instead of the visor
        ctx.fillStyle = "#15161e"; ctx.fillRect(-10, -44, 20, 4);
        ctx.fillStyle = "#3a3d4c"; ctx.beginPath(); ctx.roundRect(-11, -20, 22, 22, 5); ctx.fill();
        ctx.fillStyle = "#c8202e"; ctx.fillRect(-11, -12, 22, 3);
      }
      // arm + rifle
      ctx.save(); ctx.translate(10, -8); ctx.rotate(gunA);
      ctx.fillStyle = "#2a2c38"; ctx.beginPath(); ctx.roundRect(-4, -5, 18, 10, 5); ctx.fill();
      ctx.fillStyle = "#2a2a32"; ctx.beginPath(); ctx.roundRect(10, -4, 32, 8, 2); ctx.fill();
      ctx.fillStyle = "#e23040"; ctx.fillRect(18, -4, 10, 3); ctx.fillStyle = "#15151a"; ctx.fillRect(16, 3, 6, 8);
      if (flash > 0) { ctx.fillStyle = COL.bulletEnemy; ctx.shadowColor = COL.bulletEnemy; ctx.shadowBlur = 20; ctx.beginPath(); ctx.moveTo(42, -1); ctx.lineTo(42 + 18 * flash, -9); ctx.lineTo(42 + 12 * flash, -1); ctx.lineTo(42 + 20 * flash, 7); ctx.fill(); }
      ctx.restore();
      ctx.restore();
    };

    // Hero seen from behind: brown spiky hair, white/blue armor, energy shield on the left arm.
    const drawHero = (t: number) => {
      ctx.save(); ctx.translate(p.x, p.y);
      if (p.dead > 0) { ctx.rotate(p.dead * 1.4); ctx.globalAlpha = Math.max(0.2, 1 - p.dead * 0.6); }
      // direction ring under the feet: shows where the hero faces (full 360°)
      if (p.dead === 0) {
        ctx.save(); ctx.translate(0, 36); ctx.scale(1, 0.35);
        ctx.strokeStyle = "rgba(111,232,255,0.55)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = COL.shield; ctx.shadowColor = COL.shield; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(Math.cos(p.face) * 46, Math.sin(p.face) * 46);
        ctx.lineTo(Math.cos(p.face + 0.35) * 30, Math.sin(p.face + 0.35) * 30); ctx.lineTo(Math.cos(p.face - 0.35) * 30, Math.sin(p.face - 0.35) * 30); ctx.fill();
        ctx.restore();
      }
      // front view when facing the camera (moving down), back view otherwise; mirrored when facing left
      const front = Math.sin(p.face) > 0.3;
      const flip = Math.cos(p.face) < -0.2 ? -1 : 1;
      ctx.save(); ctx.scale(1.2 * flip, 1.2);
      const step = Math.sin(p.walk) * 3;
      ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.ellipse(0, 30, 24, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1a2440"; ctx.beginPath(); ctx.roundRect(-13, 6, 11, 22 + step, 4); ctx.roundRect(2, 6, 11, 22 - step, 4); ctx.fill();
      ctx.fillStyle = "#2f6fe0"; ctx.beginPath(); ctx.roundRect(-13, 14 + step / 2, 11, 6, 2); ctx.roundRect(2, 14 - step / 2, 11, 6, 2); ctx.fill();
      ctx.fillStyle = "#e8eef8"; ctx.beginPath(); ctx.ellipse(-7, 28 + step, 8, 4, 0, 0, Math.PI * 2); ctx.ellipse(8, 28 - step, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.translate(0, Math.abs(Math.sin(p.walk)) * -2);
      const g = ctx.createLinearGradient(0, -24, 0, 8); g.addColorStop(0, "#eef3fb"); g.addColorStop(1, "#8fa2c0");
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(-19, -24, 38, 32, 10); ctx.fill();
      ctx.fillStyle = "#2f6fe0"; ctx.beginPath(); ctx.arc(-19, -18, 8, 0, Math.PI * 2); ctx.arc(19, -18, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#26314d"; ctx.beginPath(); ctx.roundRect(-11, -18, 22, 20, 5); ctx.fill();
      ctx.save(); ctx.shadowColor = COL.shield; ctx.shadowBlur = 8; ctx.fillStyle = COL.shield;
      ctx.fillRect(-7, -13, 4, 3); ctx.fillRect(3, -13, 4, 3); ctx.fillRect(-6, -4, 12, 2); ctx.restore();
      ctx.fillStyle = "#1a2440"; ctx.fillRect(-18, 3, 36, 5);
      // head from behind: ears + spiky brown hair
      ctx.fillStyle = "#f0b48a"; ctx.beginPath(); ctx.arc(-15, -37, 4, 0, Math.PI * 2); ctx.arc(15, -37, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#6b3f1f"; ctx.beginPath(); ctx.ellipse(0, -40, 16, 16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      for (const [bx, tx2, ty2] of [[-14, -18, -56], [-8, -8, -62], [0, 2, -64], [6, 12, -60], [12, 19, -52]] as const) { ctx.moveTo(bx, -48); ctx.lineTo(tx2, ty2); ctx.lineTo(bx + 8, -50); }
      ctx.fill();
      ctx.fillStyle = "#8a5530"; ctx.beginPath(); ctx.ellipse(-4, -46, 6, 3, -0.4, 0, Math.PI * 2); ctx.fill();
      if (front) {
        // face toward the viewer
        ctx.fillStyle = "#f0b48a"; ctx.beginPath(); ctx.ellipse(0, -36, 12, 11, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#6b3f1f"; ctx.beginPath(); ctx.ellipse(0, -47, 14, 6, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = "#1a2440"; ctx.beginPath(); ctx.arc(-5, -37, 2.2, 0, Math.PI * 2); ctx.arc(5, -37, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#9a4a3a"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, -32, 4, 0.2, Math.PI - 0.2); ctx.stroke();
        ctx.fillStyle = "#6b3f1f"; ctx.fillRect(-8, -42, 6, 1.6); ctx.fillRect(2, -42, 6, 1.6);
      } else {
        ctx.fillStyle = "#2f6fe0"; ctx.fillRect(-16, -30, 32, 4);
      }
      // gun arm
      ctx.save(); ctx.translate(14, -12);
      { const ga = flip < 0 ? Math.PI - p.gunA : p.gunA; ctx.rotate(ga); }
      ctx.fillStyle = "#2f6fe0"; ctx.beginPath(); ctx.roundRect(-4, -5, 18, 10, 5); ctx.fill();
      ctx.fillStyle = "#c8d2e0"; ctx.beginPath(); ctx.roundRect(12, -5, 26, 9, 3); ctx.fill();
      ctx.fillStyle = COL.shield; ctx.fillRect(18, -3, 12, 2); ctx.fillStyle = "#3a4560"; ctx.fillRect(16, 3, 6, 8);
      if (p.recoil > 0) { ctx.fillStyle = COL.bulletMe; ctx.shadowColor = COL.bulletMe; ctx.shadowBlur = 20; ctx.beginPath(); ctx.moveTo(38, -1); ctx.lineTo(38 + 18 * p.recoil, -9); ctx.lineTo(38 + 12 * p.recoil, -1); ctx.lineTo(38 + 20 * p.recoil, 7); ctx.fill(); }
      ctx.restore();
      ctx.restore();
      // energy shield: resting on the left arm, swings to the front when held
      const s = p.shieldT;
      if (p.dead === 0) {
        // rests on the left arm; when raised it sits on a circle around the hero at shieldA (any direction)
        const ox = -30, oy = -14;
        const tx = Math.cos(p.shieldA) * 52, ty = -24 + Math.sin(p.shieldA) * 46;
        const sx = ox + (tx - ox) * s, sy = oy + (ty - oy) * s, sw = 14 + s * 62, sh = 44 - s * 18;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(s * (p.shieldA + Math.PI / 2));
        ctx.shadowColor = COL.shield; ctx.shadowBlur = 12 + s * 22;
        const sg = ctx.createRadialGradient(0, 0, 2, 0, 0, Math.max(sw, sh) / 2);
        sg.addColorStop(0, `rgba(74,227,255,${0.15 + s * 0.2})`); sg.addColorStop(1, `rgba(47,111,224,${0.45 + s * 0.25})`);
        ctx.fillStyle = sg; ctx.strokeStyle = COL.shield; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(0, 0, sw / 2, sh / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = "rgba(220,250,255,0.7)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(0, 0, sw / 2 - 5, sh / 2 - 5, 0, Math.PI * 1.15, Math.PI * 1.6); ctx.stroke();
        if (s > 0.5) { ctx.globalAlpha *= 0.5 + 0.5 * Math.sin(t / 80); ctx.strokeStyle = COL.shield; ctx.beginPath(); ctx.ellipse(0, 0, sw / 2 + 5, sh / 2 + 4, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
        ctx.restore();
      }
      ctx.restore();
    };

    const drawEnemy = (e: Enemy, t: number) => {
      ctx.save(); ctx.translate(e.x, e.y);
      if (e.dead > 0) { const k = Math.min(1, e.dead); ctx.translate(e.spin * k * 20, -Math.sin(k * Math.PI) * 25); ctx.rotate(e.spin * k * 1.6); ctx.globalAlpha = 1 - k; }
      const ang = Math.atan2(p.y - e.y, p.x - e.x);
      drawSoldier(t / 120 + e.phase, ang, e.flash, e.warn > 0, depth(e.y), p.y < e.y - 30);
      ctx.restore();
      if (e.warn > 0 && e.dead === 0) {
        ctx.save(); ctx.globalAlpha = 0.35 * Math.abs(Math.sin(t / 50)); ctx.strokeStyle = COL.bulletEnemy; ctx.setLineDash([4, 6]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(p.x, p.y - 20); ctx.stroke(); ctx.restore();
      }
    };

    const drawCover = (c: Cover) => {
      ctx.save(); ctx.translate(c.x, c.y);
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(c.w / 2, c.h, c.w / 2 + 6, 7, 0, 0, Math.PI * 2); ctx.fill();
      if (c.kind === "barrier") {
        // concrete jersey barrier with yellow/black hazard band
        ctx.fillStyle = "#a9a59a"; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(c.w - 6, 0); ctx.lineTo(c.w, c.h); ctx.lineTo(0, c.h); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#c9c5ba"; ctx.fillRect(6, 0, c.w - 12, 5);
        ctx.save(); ctx.beginPath(); ctx.rect(4, 11, c.w - 8, 14); ctx.clip();
        ctx.fillStyle = "#f2c230"; ctx.fillRect(4, 11, c.w - 8, 14);
        ctx.fillStyle = "#1e1e22"; for (let x = -10; x < c.w + 10; x += 16) { ctx.beginPath(); ctx.moveTo(x, 25); ctx.lineTo(x + 8, 25); ctx.lineTo(x + 16, 11); ctx.lineTo(x + 8, 11); ctx.fill(); }
        ctx.restore();
        ctx.fillStyle = "#8a867c"; ctx.fillRect(0, c.h - 5, c.w, 5);
      } else if (c.kind === "crate") {
        ctx.fillStyle = "#c98a45"; ctx.fillRect(0, 0, c.w, c.h);
        ctx.strokeStyle = "#8a5526"; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, c.w - 3, c.h - 3);
        ctx.lineWidth = 2; for (let y = c.h / 3; y < c.h; y += c.h / 3) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.w, y); ctx.stroke(); }
        ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(3, c.h - 3); ctx.lineTo(c.w - 3, 3); ctx.stroke();
        ctx.fillStyle = "rgba(255,230,180,0.25)"; ctx.fillRect(3, 3, c.w - 6, 4);
      } else if (c.kind === "barrel") {
        const bg = ctx.createLinearGradient(0, 0, c.w, 0); bg.addColorStop(0, "#a82a18"); bg.addColorStop(0.4, "#e8502e"); bg.addColorStop(1, "#8a2010");
        ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(0, 0, c.w, c.h, 5); ctx.fill();
        ctx.fillStyle = "#e8e8e8"; ctx.fillRect(0, 9, c.w, 4); ctx.fillRect(0, c.h - 13, c.w, 4);
        ctx.fillStyle = "#6a1a0c"; ctx.beginPath(); ctx.ellipse(c.w / 2, 2, c.w / 2 - 2, 3, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = "#4f7a3a"; ctx.beginPath(); ctx.roundRect(0, 0, c.w, c.h, 4); ctx.fill();
        ctx.fillStyle = "#6a9a4c"; ctx.fillRect(2, 2, c.w - 4, 5);
        ctx.fillStyle = "#33502a"; ctx.fillRect(0, c.h / 2 - 1, c.w, 3);
        ctx.fillStyle = "#e0b040"; ctx.fillRect(8, c.h / 2 - 4, 6, 8); ctx.fillRect(c.w - 14, c.h / 2 - 4, 6, 8);
      }
      ctx.restore();
    };

    // Background tiles across the wide arena; every other tile is mirrored so the edges join seamlessly.
    const drawBg = () => {
      if (bgImg.complete && bgImg.naturalWidth) {
        const s = Math.max(W / bgImg.naturalWidth, H / bgImg.naturalHeight);
        const iw = bgImg.naturalWidth * s, ih = bgImg.naturalHeight * s, oy = (H - ih) / 2;
        const x0 = WW / 2 - iw / 2;
        const kFrom = Math.floor((camX - x0) / iw), kTo = Math.floor((camX + W - x0) / iw);
        for (let k = kFrom; k <= kTo; k++) {
          const x = x0 + k * iw;
          if (Math.abs(k) % 2 === 1) { ctx.save(); ctx.translate(x + iw, oy); ctx.scale(-1, 1); ctx.drawImage(bgImg, 0, 0, iw, ih); ctx.restore(); }
          else ctx.drawImage(bgImg, x, oy, iw, ih);
        }
        return;
      }
      const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, COL.sky1); sky.addColorStop(0.3, COL.sky2); sky.addColorStop(0.31, COL.road); sky.addColorStop(1, "#55555a");
      ctx.fillStyle = sky; ctx.fillRect(camX - 20, -20, W + 40, H + 40);
    };
    const hitCover = (x: number, y: number) => covers.find((c) => x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h);
    // Feet-only collision: a body is blocked only where its feet would overlap an obstacle's own shape.
    const blocked = (fx: number, fy: number, r = 9) => covers.some((c) => fx + r > c.x && fx - r < c.x + c.w && fy > c.y + c.h * 0.35 && fy < c.y + c.h + 3);
    const HERO_FOOT = 34;
    const footOf = (e: Enemy) => e.y + 28 * depth(e.y);

    const loop = (t: number) => {
      const dt = Math.min(2.5, (t - last) / 16.67);
      last = t;
      const elapsed = (t - start) / 1000;

      // --- player movement (each axis on its own so the hero slides along obstacle edges)
      if (!done) {
        const sp = (inp.shield ? 2.4 : 4.2) * dt;
        const nx = Math.max(28, Math.min(WW - 28, p.x + inp.mx * sp));
        if (!blocked(nx, p.y + HERO_FOOT)) p.x = nx;
        const ny = Math.max(70, Math.min(H - 40, p.y + inp.my * sp));
        if (!blocked(p.x, ny + HERO_FOOT)) p.y = ny;
        if (Math.hypot(inp.mx, inp.my) > 0.1) {
          p.walk += 0.25 * dt;
          // turn smoothly toward the stick direction (shortest way round)
          const want = Math.atan2(inp.my, inp.mx);
          let d = want - p.face; d = Math.atan2(Math.sin(d), Math.cos(d));
          p.face += d * Math.min(1, 0.3 * dt);
        }
      }
      // camera follows the hero left/right
      const camTarget = Math.max(0, Math.min(WW - W, p.x - W / 2));
      camX += (camTarget - camX) * Math.min(1, 0.15 * dt);
      p.shieldT += ((inp.shield ? 1 : 0) - p.shieldT) * 0.3 * dt;
      { let d = inp.shieldA - p.shieldA; d = Math.atan2(Math.sin(d), Math.cos(d)); p.shieldA += d * Math.min(1, 0.4 * sensFactor(sens.current.shield) * dt); }
      if (done && p.dead > 0) p.dead = Math.min(1, p.dead + 0.04 * dt);
      p.recoil = Math.max(0, p.recoil - 0.1 * dt);

      // --- aiming (world coordinates)
      const gunX = p.x + 12, gunY = p.y - 8;
      if (inp.aiming && !inp.aimInit) {
        let best: Enemy | null = null, bd = 1e9;
        for (const e of enemies) { if (e.dead) continue; const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; best = e; } }
        inp.aimX = best ? best.x : p.x; inp.aimY = best ? best.y - 20 : p.y - 250;
        inp.aimInit = true;
      }
      inp.aimX = Math.max(camX, Math.min(camX + W, inp.aimX)); inp.aimY = Math.max(0, Math.min(H, inp.aimY));
      const targetA = inp.aiming ? Math.atan2(inp.aimY - gunY, inp.aimX - gunX) : -Math.PI / 3;
      p.gunA += (targetA - p.gunA) * 0.35 * dt;
      if (inp.fire) {
        inp.fire = false;
        if (!done) {
          const a = Math.atan2(inp.aimY - gunY, inp.aimX - gunX);
          fireBullet(gunX + Math.cos(a) * 40, gunY + Math.sin(a) * 40, inp.aimX, inp.aimY, false);
          p.recoil = 1; shake = Math.max(shake, 3); haptic("medium");
        }
      }

      // --- enemies: 1 → 2 → 3 → 4 at once, they hunt the hero around obstacles
      spawnCd -= dt;
      const alive = enemies.filter((e) => !e.dead);
      if (!done && alive.length === 0 && waveQueue === 0 && waveIdx < waves.length) { waveQueue = waves[waveIdx++] ?? 1; spawnCd = waveIdx === 1 ? 30 : 70; }
      if (!done && waveQueue > 0 && spawnCd <= 0) { spawnEnemy(); waveQueue--; spawnCd = 20; }
      for (const e of enemies) {
        if (e.dead > 0) { e.dead += 0.035 * dt; continue; }
        e.flash = Math.max(0, e.flash - 0.08 * dt);
        const dx = p.x - e.x, dy = p.y - e.y, dist = Math.hypot(dx, dy) || 1;
        const sp = 1.15 * dt;
        let vx: number, vy: number;
        if (dist > e.ty) { vx = (dx / dist) * sp; vy = (dy / dist) * sp; }
        else { vx = e.dir * sp * 0.6; vy = 0; } // close enough: strafe
        let moved = false;
        const nx = Math.max(30, Math.min(WW - 30, e.x + vx));
        if (!blocked(nx, footOf({ ...e, x: nx }))) { e.x = nx; moved = Math.abs(vx) > 0.05; }
        const ny = Math.max(60, Math.min(H - 50, e.y + vy));
        if (!blocked(e.x, ny + 28 * depth(ny))) { e.y = ny; moved = moved || Math.abs(vy) > 0.05; }
        if (!moved) {
          // stuck behind an obstacle: walk sideways around it
          const sx = e.x + e.dir * sp * 1.4;
          if (sx > 30 && sx < WW - 30 && !blocked(sx, footOf(e))) e.x = sx; else e.dir *= -1;
        }
        if (dist <= e.ty && (e.x < camX + 20 || e.x > camX + W - 20)) e.dir = e.x < p.x ? 1 : -1;
        // keep a little gap from each other
        for (const o of alive) if (o !== e) { const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy); if (od > 0 && od < 40) { e.x += (ox / od) * 0.6 * dt; } }
        if (done || dist > 640) continue;
        e.cool -= dt;
        if (e.cool <= 18 && e.warn === 0 && e.cool > 0) e.warn = 1;
        if (e.cool <= 0) {
          e.warn = 0; e.flash = 1; e.cool = Math.max(40, 95 - elapsed * 1.2) + Math.random() * 45;
          const a = Math.atan2(p.y - 10 - e.y, p.x - e.x);
          fireBullet(e.x + 9 + Math.cos(a) * 32, e.y - 5 + Math.sin(a) * 32, p.x, p.y - 20, true);
        }
      }

      // --- bullets
      bullets = bullets.filter((b) => {
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
        if (b.life <= 0 || b.x < -30 || b.x > WW + 30 || b.y < -30 || b.y > H + 30) return false;
        const cv = hitCover(b.x, b.y);
        if (cv) { burst(b.x, b.y, "#d9c39a", 8, 2.5); return false; }
        if (b.enemy) {
          if (p.shieldT > 0.6 && !done) {
            const sx = p.x + Math.cos(p.shieldA) * 62, sy = p.y - 29 + Math.sin(p.shieldA) * 55;
            if (Math.hypot(b.x - sx, b.y - sy) < 40) {
              burst(b.x, b.y, COL.shield, 12, 3); haptic("light");
              floats.push({ x: sx, y: sy - 20, text: "BLOCK!", life: 1, color: COL.shield });
              score += 2; return false;
            }
          }
          if (!done && Math.hypot(b.x - p.x, b.y - (p.y - 20)) < 24) {
            p.dead = 0.01; shake = 18; haptic("error");
            burst(b.x, b.y, COL.red, 30, 6);
            floats.push({ x: p.x, y: p.y - 80, text: "K.O.!", life: 1.4, color: COL.red });
            finish(1400);
            return false;
          }
        } else {
          for (const e of enemies) {
            const sc = depth(e.y);
            if (!e.dead && Math.hypot(b.x - e.x, b.y - (e.y - 22 * sc)) < 24 * sc + 4) {
              e.dead = 0.01; e.spin = b.vx >= 0 ? 1 : -1;
              kills++; score += 10; shake = Math.max(shake, 8);
              burst(e.x, e.y - 20, COL.red, 24, 6); burst(e.x, e.y - 20, COL.gold, 16, 5);
              floats.push({ x: e.x, y: e.y - 60, text: `+${COINS_PER_KILL}`, life: 1, color: COL.gold });
              haptic("success");
              return false;
            }
          }
        }
        return true;
      });
      enemies = enemies.filter((e) => e.dead < 1);

      // --- draw (world space, shifted by the camera)
      ctx.save();
      if (shake > 0) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.88; if (shake < 0.3) shake = 0; }
      ctx.translate(-camX, 0);
      drawBg();
      // depth-sorted: things lower on screen are drawn in front
      const layers: { y: number; draw: () => void }[] = [];
      for (const c of covers) if (c.x + c.w > camX - 40 && c.x < camX + W + 40) layers.push({ y: c.y + c.h, draw: () => drawCover(c) });
      for (const e of enemies) layers.push({ y: footOf(e), draw: () => drawEnemy(e, t) });
      layers.push({ y: p.y + HERO_FOOT, draw: () => drawHero(t) });
      layers.sort((a, b) => a.y - b.y);
      for (const l of layers) l.draw();

      // laser sight + crosshair (white ring, red ticks)
      if (inp.aiming && !done) {
        ctx.save();
        ctx.strokeStyle = COL.laser; ctx.shadowColor = COL.laser; ctx.shadowBlur = 12; ctx.lineWidth = 2;
        ctx.globalAlpha = 0.7 + 0.2 * Math.sin(t / 60);
        ctx.beginPath(); ctx.moveTo(gunX, gunY); ctx.lineTo(inp.aimX, inp.aimY); ctx.stroke();
        ctx.globalAlpha = 1; ctx.shadowBlur = 6;
        const r = 16 + Math.sin(t / 120) * 1.5;
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(inp.aimX, inp.aimY, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = COL.laser; ctx.lineWidth = 3;
        for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; ctx.beginPath(); ctx.moveTo(inp.aimX + Math.cos(a) * (r - 6), inp.aimY + Math.sin(a) * (r - 6)); ctx.lineTo(inp.aimX + Math.cos(a) * (r + 8), inp.aimY + Math.sin(a) * (r + 8)); ctx.stroke(); }
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(inp.aimX, inp.aimY, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      for (const b of bullets) {
        ctx.save(); const c = b.enemy ? COL.bulletEnemy : COL.bulletMe;
        ctx.shadowColor = c; ctx.shadowBlur = 16; ctx.strokeStyle = c; ctx.lineWidth = 5; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(b.x - b.vx * 3, b.y - b.vy * 3); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        if (Math.random() < 0.4) parts.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.5, color: c, size: 2 });
      }
      parts = parts.filter((q) => {
        q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.95; q.vy *= 0.95; q.life -= 0.03 * dt;
        ctx.globalAlpha = Math.max(0, q.life); ctx.fillStyle = q.color;
        ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0, q.size * q.life), 0, Math.PI * 2); ctx.fill();
        return q.life > 0;
      });
      floats = floats.filter((f) => {
        f.y -= 1 * dt; f.life -= 0.022 * dt;
        ctx.globalAlpha = Math.max(0, f.life); ctx.fillStyle = f.color;
        ctx.font = "22px 'Lilita One', system-ui"; ctx.textAlign = "center"; ctx.fillText(f.text, f.x, f.y);
        return f.life > 0;
      });
      ctx.globalAlpha = 1;
      ctx.restore();

      // screen-space: arrows pointing at enemies that are off screen
      for (const e of enemies) {
        if (e.dead) continue;
        const sx = e.x - camX;
        if (sx >= 0 && sx <= W) continue;
        const left = sx < 0, ax = left ? 14 : W - 14, ay = Math.max(40, Math.min(H - 40, e.y - 20));
        ctx.save(); ctx.fillStyle = COL.red; ctx.shadowColor = COL.red; ctx.shadowBlur = 10; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t / 120);
        ctx.beginPath(); ctx.moveTo(left ? ax - 8 : ax + 8, ay); ctx.lineTo(left ? ax + 6 : ax - 6, ay - 10); ctx.lineTo(left ? ax + 6 : ax - 6, ay + 10); ctx.fill(); ctx.restore();
      }
      if (p.dead > 0) { ctx.fillStyle = `rgba(255,40,60,${0.35 * (1 - p.dead)})`; ctx.fillRect(0, 0, W, H); }

      if (t - lastHud > 100 || done) { lastHud = t; setHud({ score, kills, total }); }
      if (kills >= total && !done) { haptic("success"); floats.push({ x: p.x, y: H / 2, text: "ALL CLEAR!", life: 1.5, color: COL.gold }); finish(1200); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [countdown]);

  // ---- controls
  const joyDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    joy.current = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    joyMove(e);
  };
  const joyMove = (e: React.PointerEvent) => {
    const j = joy.current; if (!j || j.id !== e.pointerId) return;
    let dx = e.clientX - j.cx, dy = e.clientY - j.cy;
    const d = Math.hypot(dx, dy), max = 45;
    if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
    setKnob({ x: dx, y: dy });
    input.current.mx = dx / max; input.current.my = dy / max;
  };
  const joyUp = () => { joy.current = null; setKnob({ x: 0, y: 0 }); input.current.mx = 0; input.current.my = 0; };

  const shootDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    aimPtr.current = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
    input.current.aiming = true; input.current.aimInit = false; setAimOn(true); haptic("light");
  };
  const shootMove = (e: React.PointerEvent) => {
    const a = aimPtr.current; if (!a || a.id !== e.pointerId) return;
    const k = 2.2 * sensFactor(sens.current.shoot);
    input.current.aimX += (e.clientX - a.lx) * k; input.current.aimY += (e.clientY - a.ly) * k;
    a.lx = e.clientX; a.ly = e.clientY;
  };
  const shootUp = () => {
    if (!aimPtr.current) return;
    aimPtr.current = null; input.current.aiming = false; input.current.fire = true; setAimOn(false);
  };
  // Hold shield and drag: the shield swings to that side (up/down/left/right or anywhere between).
  const shieldDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    shieldPtr.current = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    shieldSet(true);
  };
  const shieldMove = (e: React.PointerEvent) => {
    const s = shieldPtr.current; if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.cx, dy = e.clientY - s.cy;
    if (Math.hypot(dx, dy) > 12 / sensFactor(sens.current.shield)) input.current.shieldA = Math.atan2(dy, dx);
  };
  const shieldUp = () => { shieldPtr.current = null; shieldSet(false); };
  const shieldSet = (v: boolean) => { input.current.shield = v; setShieldOn(v); if (v) haptic("light"); };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background select-none">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <div className="font-display text-3xl text-gold-gradient">+{hud.kills * COINS_PER_KILL}</div>
        <div className="text-sm text-muted-foreground">Score {hud.score}</div>
        <div className="font-display text-xl tabular-nums">💀 {hud.kills}/{hud.total || "…"}</div>
      </div>
      <div className="mx-4 mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-gold transition-[width] duration-200" style={{ width: `${hud.total ? (hud.kills / hud.total) * 100 : 0}%` }} />
      </div>
      <div ref={wrapRef} className="relative mt-3 flex-1 touch-none">
        <canvas ref={canvasRef} className="absolute inset-0" />
        {countdown > 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/50">
            <div key={countdown} className="font-display text-8xl text-gold-gradient animate-in zoom-in-50 fade-in duration-500">{countdown}</div>
            <p className="px-6 text-center text-foreground">Move with the left stick — walk left or right to explore. Hold 🛡️ and drag to point the shield any way. Hold 🎯, drag to aim, release to shoot!</p>
            <p className="px-6 text-center font-display text-lg text-primary">Take down 9–12 enemies · +10 coins each</p>
          </div>
        )}
        {/* joystick */}
        <div
          onPointerDown={joyDown} onPointerMove={joyMove} onPointerUp={joyUp} onPointerCancel={joyUp}
          className="absolute bottom-6 left-5 flex h-32 w-32 touch-none items-center justify-center rounded-full border-2 border-foreground/70 bg-background/30 backdrop-blur-sm"
        >
          <ChevronUp className="absolute top-1 h-4 w-4 text-foreground/80" />
          <ChevronDown className="absolute bottom-1 h-4 w-4 text-foreground/80" />
          <ChevronLeft className="absolute left-1 h-4 w-4 text-foreground/80" />
          <ChevronRight className="absolute right-1 h-4 w-4 text-foreground/80" />
          <div className="h-14 w-14 rounded-full border-2 border-foreground/80 bg-hud-blue glow-blue" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
        </div>
        {/* shield + shoot */}
        <button
          onPointerDown={shieldDown} onPointerMove={shieldMove}
          onPointerUp={shieldUp} onPointerCancel={shieldUp}
          className={`absolute bottom-36 right-5 flex h-[88px] w-[88px] touch-none items-center justify-center rounded-full border-4 border-hud-blue glow-blue transition-transform duration-100 ${shieldOn ? "scale-90 bg-hud-blue/70" : "bg-background/50"}`}
          aria-label="Shield"
        >
          <Shield className="h-11 w-11 fill-hud-blue/60 text-foreground" />
        </button>
        <button
          onPointerDown={shootDown} onPointerMove={shootMove} onPointerUp={shootUp} onPointerCancel={shootUp}
          className={`absolute bottom-6 right-5 flex h-24 w-24 touch-none items-center justify-center rounded-full border-4 border-hud-orange glow-orange transition-transform duration-100 ${aimOn ? "scale-90 bg-hud-orange/60" : "bg-background/60"}`}
          aria-label="Shoot"
        >
          <Crosshair className="h-11 w-11 text-foreground" />
        </button>
      </div>
    </div>
  );
}
