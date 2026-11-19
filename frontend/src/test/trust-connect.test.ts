import { describe, expect, it } from "vitest";
import { trustAppConnectLink, isPhoneDevice } from "@/lib/trust-connect";

describe("Trust Wallet WalletConnect universal link", () => {
  it("uses the official HTTPS universal link with an encoded WalletConnect URI", () => {
    expect(trustAppConnectLink("wc:abc@2?relay-protocol=irn&symKey=xyz")).toBe(
      "https://link.trustwallet.com/wc?uri=wc%3Aabc%402%3Frelay-protocol%3Dirn%26symKey%3Dxyz",
    );
  });

  it("uses HTTPS so Telegram never tries to load a custom trust:// scheme as a page", () => {
    expect(trustAppConnectLink("wc:sample@2")).toMatch(/^https:\/\/link\.trustwallet\.com\/wc\?uri=/);
  });
});

describe("phone detection", () => {
  it("recognizes Telegram mobile platforms", () => {
    expect(isPhoneDevice("android", "")).toBe(true);
    expect(isPhoneDevice("ios", "")).toBe(true);
  });

  it("does not treat Telegram desktop platforms as phones", () => {
    expect(isPhoneDevice("tdesktop", "Mozilla/5.0 (Android)")).toBe(false);
  });

  it("falls back to the user agent for mobile browsers", () => {
    expect(isPhoneDevice(undefined, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe(true);
  });
});
