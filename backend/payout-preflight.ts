export type PayoutBalanceCheck = {
  tokenBalance: bigint;
  gasBalance: bigint;
  amount: bigint;
  gasPrice: bigint;
  estimatedGas: bigint;
  maxGasPrice: bigint;
  maxGasLimit: bigint;
};

export type PayoutBalanceAssessment =
  | { ok: true; gasLimit: bigint; estimatedGasFee: bigint; requiredGasBalance: bigint }
  | { ok: false; reason: "insufficient_usdt" | "gas_price_high" | "gas_limit_high" | "insufficient_bnb" | "invalid_gas_estimate"; gasLimit: bigint; estimatedGasFee: bigint; requiredGasBalance: bigint };

export function assessBep20PayoutBalances(input: PayoutBalanceCheck): PayoutBalanceAssessment {
  const gasLimit = input.estimatedGas > 0n ? input.estimatedGas * 120n / 100n : 0n;
  const estimatedGasFee = gasLimit * input.gasPrice;
  // Keep a 2x gas reserve, matching the actual payout sender's safety check.
  const requiredGasBalance = estimatedGasFee * 2n;
  if (gasLimit <= 0n) return { ok: false, reason: "invalid_gas_estimate", gasLimit, estimatedGasFee, requiredGasBalance };
  if (input.tokenBalance < input.amount) return { ok: false, reason: "insufficient_usdt", gasLimit, estimatedGasFee, requiredGasBalance };
  if (input.gasPrice > input.maxGasPrice) return { ok: false, reason: "gas_price_high", gasLimit, estimatedGasFee, requiredGasBalance };
  if (gasLimit > input.maxGasLimit) return { ok: false, reason: "gas_limit_high", gasLimit, estimatedGasFee, requiredGasBalance };
  if (input.gasBalance < requiredGasBalance) return { ok: false, reason: "insufficient_bnb", gasLimit, estimatedGasFee, requiredGasBalance };
  return { ok: true, gasLimit, estimatedGasFee, requiredGasBalance };
}
