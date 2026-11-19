import test from "node:test";
import assert from "node:assert/strict";
import { assessBep20PayoutBalances } from "../payout-preflight.ts";

const defaults = {
  tokenBalance: 10_000_000_000_000_000_000n,
  gasBalance: 1_000_000_000_000_000n,
  amount: 2_000_000_000_000_000n,
  gasPrice: 3_000_000_000n,
  estimatedGas: 65_000n,
  maxGasPrice: 20_000_000_000n,
  maxGasLimit: 150_000n,
};

test("treasury preflight passes when USDT and BNB gas reserve are sufficient", () => {
  const result = assessBep20PayoutBalances(defaults);
  assert.equal(result.ok, true);
  assert.equal(result.gasLimit, 78_000n);
  assert.equal(result.requiredGasBalance, 468_000_000_000_000n);
});

test("treasury preflight blocks when USDT is insufficient", () => {
  const result = assessBep20PayoutBalances({ ...defaults, tokenBalance: defaults.amount - 1n });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "insufficient_usdt");
});

test("treasury preflight blocks when BNB gas reserve is insufficient", () => {
  const result = assessBep20PayoutBalances({ ...defaults, gasBalance: 1n });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "insufficient_bnb");
});

test("treasury preflight blocks gas price and gas limit outside safety caps", () => {
  assert.equal(assessBep20PayoutBalances({ ...defaults, gasPrice: 21_000_000_000n }).reason, "gas_price_high");
  assert.equal(assessBep20PayoutBalances({ ...defaults, estimatedGas: 130_000n }).reason, "gas_limit_high");
});

test("treasury preflight blocks an absent or invalid gas estimate", () => {
  assert.equal(assessBep20PayoutBalances({ ...defaults, estimatedGas: 0n }).reason, "invalid_gas_estimate");
});
