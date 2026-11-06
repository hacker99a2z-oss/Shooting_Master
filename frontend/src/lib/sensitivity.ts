// Archery aim sensitivity (0–100%), saved on this device.
export type Sensitivity = { aim: number };
const KEY = "archery-sensitivity";
const LEGACY_KEY = "control-sensitivity"; // old shooter setting: reuse its "shoot" value once
export const DEFAULT_SENSITIVITY: Sensitivity = { aim: 50 };

const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null);

export function loadSensitivity(): Sensitivity {
  try {
    const saved = clamp(JSON.parse(localStorage.getItem(KEY) || "{}").aim);
    if (saved != null) return { aim: saved };
    const legacy = clamp(JSON.parse(localStorage.getItem(LEGACY_KEY) || "{}").shoot);
    return { aim: legacy ?? DEFAULT_SENSITIVITY.aim };
  } catch {
    return DEFAULT_SENSITIVITY;
  }
}
export function saveSensitivity(s: Sensitivity) {
  try { localStorage.setItem(KEY, JSON.stringify({ aim: clamp(s.aim) ?? DEFAULT_SENSITIVITY.aim })); } catch { /* ignore */ }
}
// 0% -> 0.1x, 50% -> 1x, 100% -> 2x of the original feel.
export const sensFactor = (pct: number) => Math.max(0.1, pct / 50);
