import { describe, expect, it } from "vitest";
import { destinationInput, isBep20Destination } from "../../../backend/wallet-destination";

describe("saved payout destination rules", () => {
  it("stores only USDT on BEP20 chain 56", () => expect(destinationInput({address:"0x"+"a".repeat(40),asset:"USDT",network:"BEP20"})).toEqual({address:"0x"+"a".repeat(40),asset:"USDT",network:"BEP20",chainId:56}));
  it("rejects another asset", () => expect(()=>destinationInput({address:"0x"+"a".repeat(40),asset:"BNB",network:"BEP20"})).toThrow());
  it("rejects another network", () => expect(()=>destinationInput({address:"0x"+"a".repeat(40),asset:"USDT",network:"TRC20"})).toThrow());
  it("rejects the burn address", () => expect(isBep20Destination("0x"+"0".repeat(40))).toBe(false));
});