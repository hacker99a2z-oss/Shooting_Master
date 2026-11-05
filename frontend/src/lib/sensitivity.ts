// Player control sensitivity (0–100%), saved on this device.
export type Sensitivity = { shoot: number; shield: number };
const KEY = "control-sensitivity";
export const DEFAULT_SENSITIVITY: Sensitivity = { shoot: 50, shield: 50 };

export function loadSensitivity(): Sensitivity {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    const clamp = (n: unknown, d: number) => (typeof n === "number" ? Math.max(0, Math.min(100, n)) : d);
    return { shoot: clamp(v.shoot, 50), shield: clamp(v.shield, 50) };
  } catch {
    return DEFAULT_SENSITIVITY;
  }
}
export function saveSensitivity(s: Sensitivity) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
// 0% -> 0.1x, 50% -> 1x, 100% -> 2x of the original feel.
export const sensFactor = (pct: number) => Math.max(0.1, pct / 50);
