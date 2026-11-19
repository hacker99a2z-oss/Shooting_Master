/**
 * Picks render quality for the device. Low-memory / low-core phones (1–4 GB RAM) get a lighter
 * renderer: native-ish pixel ratio, no MSAA and a smaller shadow map. Gameplay is unchanged.
 */
export type Quality = { low: boolean; dpr: number | [number, number]; antialias: boolean; shadowMap: number };

export function detectQuality(): Quality {
  if (typeof navigator === "undefined") return { low: false, dpr: [1, 1.5], antialias: true, shadowMap: 1024 };
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const low = mem <= 4 || cores <= 4;
  if (low) return { low: true, dpr: 1, antialias: false, shadowMap: 512 };
  if (mobile) return { low: false, dpr: [1, 1.5], antialias: false, shadowMap: 1024 };
  return { low: false, dpr: [1, 1.75], antialias: true, shadowMap: 1024 };
}

export const QUALITY = detectQuality();
