// Pure gold-mining and energy rules shared by the API and unit tests.
// Gold is stored as integer milli-gold (1 = 0.001 gold) so balances never drift.
export const ENERGY_PER_AD = 10;
export const DAILY_ENERGY_BONUS = 10;
export const ENERGY_PER_GIVE = 10;
export const MINE_CAPACITY = 1000;
export const ENERGY_PER_CYCLE = 10;
export const MINE_CYCLE_MS = 120_000;
export const MILLI_GOLD_PER_CYCLE = 1;
export const AD_ENERGY_COOLDOWN_MS = 180_000;

export type MineState = { energy: number; updatedAt: number; pending: number };

/** Burn stored miner energy for every completed 2-minute cycle and accrue gold. */
export function settleMine(state: MineState, now: number): MineState & { cycles: number } {
  const energy = Math.max(0, Math.floor(state.energy));
  const pending = Math.max(0, Math.floor(state.pending));
  const updatedAt = Number.isFinite(state.updatedAt) && state.updatedAt > 0 ? state.updatedAt : now;
  if (energy < ENERGY_PER_CYCLE) return { energy, updatedAt: now, pending, cycles: 0 };
  const elapsed = Math.max(0, now - updatedAt);
  const cycles = Math.min(Math.floor(elapsed / MINE_CYCLE_MS), Math.floor(energy / ENERGY_PER_CYCLE));
  const left = energy - cycles * ENERGY_PER_CYCLE;
  return {
    energy: left,
    // While energy remains, keep the partial cycle progress; an empty miner restarts on the next give.
    updatedAt: left >= ENERGY_PER_CYCLE ? updatedAt + cycles * MINE_CYCLE_MS : now,
    pending: pending + cycles * MILLI_GOLD_PER_CYCLE,
    cycles,
  };
}

/** Milliseconds until the miner runs out of energy. */
export function mineRemainingMs(state: MineState, now: number) {
  const s = settleMine(state, now);
  const cycles = Math.floor(s.energy / ENERGY_PER_CYCLE);
  if (cycles === 0) return 0;
  return Math.max(0, cycles * MINE_CYCLE_MS - (now - s.updatedAt));
}

/** Add one Give worth of energy to the miner, enforcing the 1000-energy capacity. */
export function giveToMine(state: MineState, playerEnergy: number, now: number) {
  if (playerEnergy < ENERGY_PER_GIVE) throw new Error("Not enough energy. Watch an ad to get more energy.");
  const s = settleMine(state, now);
  if (s.energy + ENERGY_PER_GIVE > MINE_CAPACITY) throw new Error("Your miner is full (1000/1000 energy).");
  const startsNow = s.energy < ENERGY_PER_CYCLE;
  return { energy: s.energy + ENERGY_PER_GIVE, updatedAt: startsNow ? now : s.updatedAt, pending: s.pending };
}

export const formatGold = (milli: number) => (Math.max(0, milli) / 1000).toFixed(3);
