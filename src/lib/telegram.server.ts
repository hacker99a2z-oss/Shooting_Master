export type TgUser = { id: number; first_name: string; username?: string; photo_url?: string };

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Verifies Telegram WebApp initData. When TELEGRAM_BOT_TOKEN is not set yet,
 * falls back to trusting the payload (preview/testing only) and allows a guest user.
 */
export async function verifyInitData(initData: string, guestId?: number): Promise<TgUser> {
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  const params = new URLSearchParams(initData);
  const userRaw = params.get("user");

  if (token) {
    const hash = params.get("hash");
    if (!hash || !userRaw) throw new Error("Open this app inside Telegram");
    params.delete("hash");
    const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
    const secret = await hmac(enc.encode("WebAppData"), token);
    const sig = toHex(await hmac(secret, check));
    if (sig !== hash) throw new Error("Invalid Telegram session");
    const authDate = Number(params.get("auth_date") ?? 0);
    if (Date.now() / 1000 - authDate > 86400) throw new Error("Session expired, reopen the app");
    return JSON.parse(userRaw);
  }

  if (userRaw) return JSON.parse(userRaw);
  if (guestId && guestId > 0) return { id: guestId, first_name: "Guest" };
  throw new Error("Open this app inside Telegram");
}
