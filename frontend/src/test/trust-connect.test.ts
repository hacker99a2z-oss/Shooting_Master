import { describe, expect, it } from "vitest";
import { TRUST_APP_STORE_URL, TRUST_PLAY_STORE_URL, trustAppConnectLink, trustStoreUrl } from "@/lib/trust-connect";

describe("Trust Wallet approval link", () => {
  it("opens the Trust Wallet app directly with the encoded WalletConnect request", () => {
    expect(trustAppConnectLink("wc:abc@2?relay-protocol=irn&symKey=xyz")).toBe("trust://wc?uri=wc%3Aabc%402%3Frelay-protocol%3Dirn%26symKey%3Dxyz");
  });
});

describe("Trust Wallet not installed on a phone", () => {
  it("Android phones go to the Play Store", () => {
    expect(trustStoreUrl("android", "")).toBe(TRUST_PLAY_STORE_URL);
    expect(TRUST_PLAY_STORE_URL).toBe("https://play.google.com/store/apps/details?id=com.wallet.crypto.trustapp");
  });
  it("iPhones go to the App Store", () => {
    expect(trustStoreUrl("ios", "")).toBe(TRUST_APP_STORE_URL);
    expect(trustStoreUrl(undefined, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe(TRUST_APP_STORE_URL);
  });
});
