import test from "node:test";
import assert from "node:assert/strict";
import { destinationInput } from "../wallet-destination.ts";

test("preserves the exact letter casing supplied by the wallet provider", () => {
  const address = "0x52908400098527886E0F7030069857D2E4169EE7";
  const destination = destinationInput({ address, asset: "USDT", network: "BEP20" });
  assert.equal(destination.address, address);
  assert.equal(destination.chainId, 56);
});

test("preserves a lowercase address instead of reformatting it", () => {
  const address = "0x" + "a".repeat(40);
  const destination = destinationInput({ address, asset: "USDT", network: "BEP20" });
  assert.equal(destination.address, address);
});

test("rejects invalid wallet destinations", () => {
  assert.throws(
    () => destinationInput({ address: "not-an-address", asset: "USDT", network: "BEP20" }),
    /valid USDT BEP-20 destination/,
  );
});
