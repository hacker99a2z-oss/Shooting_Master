import { describe, expect, it } from "vitest";
import { trustWalletConnectLink } from "@/lib/trust-connect";

describe("Trust Wallet approval link", () => {
  it("opens the Trust Wallet app with the encoded WalletConnect request", () => {
    expect(trustWalletConnectLink("wc:abc@2?relay-protocol=irn&symKey=xyz")).toBe("https://link.trustwallet.com/wc?uri=wc%3Aabc%402%3Frelay-protocol%3Dirn%26symKey%3Dxyz");
  });
});
