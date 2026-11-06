// Tolerant matching for the AdsGram Reward URL shared secret.
// Real-world mismatches usually come from copy/paste or URL encoding, not a wrong code:
// - a space, tab or newline pasted around the value in Render or AdsGram,
// - quotes around the value ("abc" or 'abc'),
// - characters like + / = & # % being encoded or decoded differently
//   (URLSearchParams turns "+" into a space, AdsGram may send %2B, etc).
// We compare every reasonable form of both sides with a constant-time check.

const INVISIBLE = /[\u200B-\u200D\uFEFF\u00A0]/g;

export function normalizeSecret(value: string | null | undefined): string {
  let s = String(value ?? "").replace(INVISIBLE, "").trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function safeDecode(value: string): string | null {
  try { return decodeURIComponent(value); } catch { return null; }
}

function variants(value: string): string[] {
  const out = new Set<string>();
  const add = (v: string | null) => { if (v != null) { const n = normalizeSecret(v); if (n) out.add(n); } };
  add(value);
  add(safeDecode(value));
  add(safeDecode(value.replace(/\+/g, " ")));
  add(safeDecode(value.replace(/\+/g, "%2B")));
  add(value.replace(/ /g, "+"));
  const once = safeDecode(value);
  if (once) add(safeDecode(once));
  return [...out];
}

/** Raw (undecoded) values for a query parameter, read straight from the URL. */
export function rawQueryValues(search: string, name: string): string[] {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const values: string[] = [];
  for (const part of query.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = eq === -1 ? part : part.slice(0, eq);
    const decodedKey = safeDecode(key.replace(/\+/g, " ")) ?? key;
    if (decodedKey.trim().toLowerCase() === name.toLowerCase()) values.push(eq === -1 ? "" : part.slice(eq + 1));
  }
  return values;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function secretMatches(suppliedRaw: string[], expected: string | null | undefined): boolean {
  const expectedForms = variants(String(expected ?? ""));
  if (!expectedForms.length) return false;
  let ok = false;
  for (const raw of suppliedRaw) {
    for (const s of variants(raw)) {
      for (const e of expectedForms) if (constantTimeEqual(s, e)) ok = true;
    }
  }
  return ok;
}

/** Short, non-reversible fingerprint so logs can show whether both sides hold the same code. */
export async function secretFingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeSecret(value)));
  return [...new Uint8Array(digest)].slice(0, 4).map((x) => x.toString(16).padStart(2, "0")).join("");
}
