import test from "node:test";
import assert from "node:assert/strict";
import { checksumBep20Address, destinationInput } from "../wallet-destination.ts";

test("returns EIP-55 checksum casing for lowercase BEP-20 addresses", () => {
  const input = "0x52908400098527886e0f7030069857d2e4169ee7";
  assert.equal(
    checksumBep20Address(input),
    "0x52908400098527886E0F7030069857D2E4169EE7",
  );
});

test("wallet destination saves the checksummed address without changing the chain", () => {
  const destination = destinationInput({
    address: "0x52908400098527886e0f7030069857d2e4169ee7",
    asset: "USDT",
    network: "BEP20",
  });
  assert.deepEqual(destination, {
    address: "0x52908400098527886E0F7030069857D2E4169EE7",
    asset: "USDT",
    network: "BEP20",
    chainId: 56,
  });
});

test("rejects invalid wallet destinations before checksumming", () => {
  assert.throws(
    () => destinationInput({ address: "not-an-address", asset: "USDT", network: "BEP20" }),
    /valid USDT BEP-20 destination/,
  );
});
