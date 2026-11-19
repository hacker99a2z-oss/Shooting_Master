/**
 * Battle Arena rules: top-down MOBA-style map, hero walking, bow aiming and
 * unlimited arrows, the hold-to-raise shield, random enemies that throw arrows/axes/blades/rocks,
 * and the random props (haystacks, broken carts, barrels...) laid out per match.
 * Plain TypeScript (no React, no three.js) so every rule stays unit-tested.
 *
 * World axes (metres): x = screen right, z = screen down (toward the camera).
 * Yaw: facing = (sin yaw, cos yaw); yaw 0 faces the camera (+z), yaw π faces up the screen.
 */
import { COINS_PER_ENEMY } from "./home-rules.ts";

// ---------- Map ----------
/** Playable half size: the hero walks inside x,z ∈ [-MAP_HALF, MAP_HALF]. */
export const MAP_HALF = 34;
/** Spawn point of the hero (map centre, a little down). */
export const HERO_SPAWN = { x: 0, z: 6 };
/** No props within this radius of the hero spawn. */
export const SPAWN_CLEAR_RADIUS = 7;

// ---------- Hero ----------
export const HERO_RADIUS = 0.5;
/** One hit kills: the hero and every enemy have a single life. */
export const HERO_MAX_HP = 1;
export const HERO_RUN_SPEED = 6;
export const HERO_AIM_SPEED = 3;
export const HERO_SHIELD_SPEED = 2.6;
/** Turn rate toward the wanted facing (per second, exponential). */
export const HERO_TURN_RATE = 14;
/** Seconds between two arrows; arrows themselves are unlimited. */
export const FIRE_COOLDOWN = 0.22;
/** Half angle (radians) of the cone in front of the shield that blocks shots. */
export const SHIELD_BLOCK_HALF_ANGLE = (75 * Math.PI) / 180;

// ---------- Hero arrows ----------
export const ARROW_SPEED = 30;
export const ARROW_RANGE = 22;
/** Every hero arrow that lands kills the enemy it hits. */
export const ARROW_DAMAGE = 1;
/** Height the arrows fly at. */
export const ARROW_HEIGHT = 1.2;

// ---------- Enemies ----------
export type EnemyKind = "archer" | "axeman" | "warrior" | "minion";
export type ShotKind = "arrow" | "axe" | "blade" | "rock";

export type EnemySpec = {
  hp: number;
  speed: number;
  radius: number;
  /** Preferred fighting distance from the hero. */
  minRange: number;
  maxRange: number;
  windup: number;
  cooldown: [number, number];
  shot: ShotKind;
  shotSpeed: number;
  damage: number;
  /** Spawn weight. */
  weight: number;
};

export const ENEMY_SPECS: Record<EnemyKind, EnemySpec> = {
  archer: { hp: 1, speed: 2.8, radius: 0.5, minRange: 10, maxRange: 15, windup: 0.75, cooldown: [2.2, 3.4], shot: "arrow", shotSpeed: 15, damage: 1, weight: 3 },
  axeman: { hp: 1, speed: 3.1, radius: 0.6, minRange: 6, maxRange: 10, windup: 0.6, cooldown: [2.2, 3.2], shot: "axe", shotSpeed: 11, damage: 1, weight: 2 },
  warrior: { hp: 1, speed: 3, radius: 0.55, minRange: 7, maxRange: 11, windup: 0.6, cooldown: [2.4, 3.4], shot: "blade", shotSpeed: 12, damage: 1, weight: 2 },
  minion: { hp: 1, speed: 3.8, radius: 0.45, minRange: 5, maxRange: 9, windup: 0.55, cooldown: [1.8, 2.8], shot: "rock", shotSpeed: 10, damage: 1, weight: 3 },
};

export const SHOT_RANGE = 24;
export const SHOT_RADIUS = 0.3;
export const ENEMY_SPAWN_TIME = 1.1;
/** Dead enemies stay this long so the death animation plays. */
export const ENEMY_CORPSE_TIME = 2;
export const ENEMY_MIN_SPAWN_DISTANCE = 15;
/** Every match has a random 9–12 enemies in total (the server picks the number). */
export const MIN_MATCH_ENEMIES = 9;
export const MAX_MATCH_ENEMIES = 12;
/** Seconds before the first wave and between one wave being cleared and the next arriving. */
export const FIRST_WAVE_DELAY = 1.2;
export const WAVE_GAP = 1.5;

/** Random match size between MIN_MATCH_ENEMIES and MAX_MATCH_ENEMIES (used when the server gives none). */
export function randomEnemyTotal(rand: () => number = Math.random) {
  return MIN_MATCH_ENEMIES + Math.floor(rand() * (MAX_MATCH_ENEMIES - MIN_MATCH_ENEMIES + 1));
}
/** Clamps any enemy total into the 9–12 range. */
/** Seed from the server-issued, unguessable game UUID. */
export function battleSeedFromGameId(gameId: string) {
  const uuid = gameId.startsWith("r2_") ? gameId.slice(3) : gameId;
  const compact = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(compact)) throw new Error("Invalid game session ID");
  return Number.parseInt(compact.slice(0, 8), 16) >>> 0;
}

export function clampEnemyTotal(n: number) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return MIN_MATCH_ENEMIES;
  return Math.max(MIN_MATCH_ENEMIES, Math.min(MAX_MATCH_ENEMIES, v));
}
/**
 * Waves for a match: wave 1 has 1 enemy, wave 2 has 2, wave 3 has 3 ...
 * the last wave brings whatever is left, so the sizes always add up to the total.
 */
export function waveSizes(total: number): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.floor(total));
  for (let n = 1; left > 0; n++) {
    const size = Math.min(n, left);
    out.push(size);
    left -= size;
  }
  return out;
}

// ---------- Props ----------
export type PropKind =
  | "haystack"
  | "hayBales"
  | "brokenCart"
  | "cart"
  | "barrels"
  | "crates"
  | "rock"
  | "bigRock"
  | "logs"
  | "tent"
  | "campfire"
  | "brokenFence"
  | "stall"
  | "brokenWall"
  | "deadTree";

/** Collision radius per prop. */
export const PROP_RADIUS: Record<PropKind, number> = {
  haystack: 1.3,
  hayBales: 1.1,
  brokenCart: 1.6,
  cart: 1.5,
  barrels: 0.9,
  crates: 1,
  rock: 1,
  bigRock: 1.9,
  logs: 1.2,
  tent: 1.5,
  campfire: 0.7,
  brokenFence: 1.1,
  stall: 1.5,
  brokenWall: 1.4,
  deadTree: 0.7,
};
const PROP_WEIGHTS: [PropKind, number][] = [
  ["haystack", 4],
  ["hayBales", 3],
  ["brokenCart", 3],
  ["cart", 1],
  ["barrels", 3],
  ["crates", 3],
  ["rock", 3],
  ["bigRock", 2],
  ["logs", 2],
  ["tent", 1],
  ["campfire", 1],
  ["brokenFence", 2],
  ["stall", 1],
  ["brokenWall", 2],
  ["deadTree", 2],
];
export const PROP_COUNT = 34;

export type Prop = { id: number; kind: PropKind; x: number; z: number; r: number; yaw: number; variant: number };

// ---------- State ----------
export type Vec2 = { x: number; z: number };
export type HeroMode = "bow" | "shield";
export type Hero = {
  x: number;
  z: number;
  yaw: number;
  /** Current ground speed and velocity (for the walk animation). */
  speed: number;
  vx: number;
  vz: number;
  hp: number;
  mode: HeroMode;
  aiming: boolean;
  aimX: number;
  aimZ: number;
  fireCooldown: number;
  sinceHit: number;
  dead: boolean;
};
export type EnemyState = "spawning" | "moving" | "windup" | "recover" | "dead";
export type Enemy = {
  id: number;
  kind: EnemyKind;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  hp: number;
  state: EnemyState;
  timer: number;
  cooldown: number;
  strafe: 1 | -1;
  strafeTimer: number;
};
export type Arrow = { id: number; x: number; z: number; dx: number; dz: number; traveled: number };
export type Shot = { id: number; kind: ShotKind; x: number; z: number; dx: number; dz: number; speed: number; traveled: number; damage: number };

export type BattleEvent =
  | { type: "heroFire"; id: number }
  | { type: "heroHit"; damage: number }
  | { type: "blocked"; x: number; z: number }
  | { type: "impact"; x: number; z: number }
  | { type: "enemySpawn"; id: number }
  | { type: "enemyAttack"; id: number }
  | { type: "enemyThrow"; id: number }
  | { type: "enemyHit"; id: number; x: number; z: number }
  | { type: "enemyKilled"; id: number; x: number; z: number; coins: number }
  | { type: "waveStart"; wave: number; size: number }
  | { type: "victory" }
  | { type: "heroDied" };

export type Battle = {
  time: number;
  rng: number;
  hero: Hero;
  enemies: Enemy[];
  arrows: Arrow[];
  shots: Shot[];
  props: Prop[];
  kills: number;
  coins: number;
  /** Enemies in this whole match (9–12) and how many have come out so far. */
  enemyTotal: number;
  spawned: number;
  /** Wave sizes for the match and the wave now on the map (1-based, 0 = not started). */
  waves: number[];
  wave: number;
  /** Enemies of the current wave still waiting to come out. */
  waveLeft: number;
  /** Seconds until the next wave (or the next spawn attempt). */
  spawnTimer: number;
  /** True when every enemy of the match is dead. */
  won: boolean;
  nextId: number;
  over: boolean;
  events: BattleEvent[];
};

export type BattleInput = {
  /** Move direction on the ground, length 0..1 (joystick / WASD). */
  moveX: number;
  moveZ: number;
  /** Finger / mouse is held on the map: the hero aims (bow) or turns the shield toward this point. */
  pointerHeld: boolean;
  pointerX: number;
  pointerZ: number;
  /** The finger / mouse was let go this frame: the bow fires. */
  released: boolean;
  /** The shield button is being held: the shield is up only while this is true. */
  shieldHeld: boolean;
  /** Direction the finger on the shield button slides (screen right = +x, down = +z); 0,0 = keep facing. */
  shieldDirX: number;
  shieldDirZ: number;
};

export function emptyInput(): BattleInput {
  return { moveX: 0, moveZ: 0, pointerHeld: false, pointerX: 0, pointerZ: 0, released: false, shieldHeld: false, shieldDirX: 0, shieldDirZ: 0 };
}

// ---------- Helpers ----------
/** Deterministic PRNG (mulberry32) stored as a number in the state. */
export function nextRandom(b: { rng: number }) {
  b.rng = (b.rng + 0x6d2b79f5) >>> 0;
  let t = b.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const range = (b: { rng: number }, lo: number, hi: number) => lo + (hi - lo) * nextRandom(b);

export const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);
export function angleDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function turnToward(yaw: number, target: number, rate: number, dt: number) {
  return yaw + angleDiff(yaw, target) * (1 - Math.exp(-rate * dt));
}
const clampMap = (v: number, r: number) => Math.max(-MAP_HALF + r, Math.min(MAP_HALF - r, v));

/** Push a circle out of every prop and keep it inside the map. */
export function resolveCircle(p: Vec2, r: number, props: Prop[]) {
  for (const o of props) {
    const dx = p.x - o.x;
    const dz = p.z - o.z;
    const min = r + o.r;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min) {
      const d = Math.sqrt(d2) || 0.0001;
      p.x = o.x + (dx / d) * min;
      p.z = o.z + (dz / d) * min;
    }
  }
  p.x = clampMap(p.x, r);
  p.z = clampMap(p.z, r);
}

function hitsProp(x: number, z: number, r: number, props: Prop[]) {
  for (const o of props) {
    const dx = x - o.x;
    const dz = z - o.z;
    if (dx * dx + dz * dz < (o.r + r) * (o.r + r)) return true;
  }
  return false;
}

// ---------- Setup ----------
function pickWeighted<T>(b: { rng: number }, list: [T, number][]): T {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let roll = nextRandom(b) * total;
  for (const [v, w] of list) {
    roll -= w;
    if (roll <= 0) return v;
  }
  return list[list.length - 1]![0];
}

/** A fresh random prop layout for a match: props keep apart from each other and from the hero spawn. */
export function generateProps(seed: number): Prop[] {
  const b = { rng: seed >>> 0 };
  const props: Prop[] = [];
  let attempts = 0;
  while (props.length < PROP_COUNT && attempts < 2000) {
    attempts++;
    const kind = pickWeighted(b, PROP_WEIGHTS);
    const r = PROP_RADIUS[kind];
    const edge = MAP_HALF - 3 - r;
    const x = range(b, -edge, edge);
    const z = range(b, -edge, edge);
    if (Math.hypot(x - HERO_SPAWN.x, z - HERO_SPAWN.z) < SPAWN_CLEAR_RADIUS + r) continue;
    if (props.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 2.6)) continue;
    props.push({ id: props.length, kind, x, z, r, yaw: range(b, 0, Math.PI * 2), variant: Math.floor(nextRandom(b) * 3) });
  }
  return props;
}

export function createBattle(seed: number, enemyTotal?: number): Battle {
  const total = enemyTotal == null ? randomEnemyTotal(() => nextRandom({ rng: (seed ^ 0x51ed27) >>> 0 })) : clampEnemyTotal(enemyTotal);
  return {
    time: 0,
    rng: (seed ^ 0x9e3779b9) >>> 0,
    hero: {
      x: HERO_SPAWN.x,
      z: HERO_SPAWN.z,
      yaw: Math.PI,
      speed: 0,
      vx: 0,
      vz: 0,
      hp: HERO_MAX_HP,
      mode: "bow",
      aiming: false,
      aimX: HERO_SPAWN.x,
      aimZ: HERO_SPAWN.z - 5,
      fireCooldown: 0,
      sinceHit: 99,
      dead: false,
    },
    enemies: [],
    arrows: [],
    shots: [],
    props: generateProps(seed),
    kills: 0,
    coins: 0,
    enemyTotal: total,
    spawned: 0,
    waves: waveSizes(total),
    wave: 0,
    waveLeft: 0,
    spawnTimer: FIRST_WAVE_DELAY,
    won: false,
    nextId: 1,
    over: false,
    events: [],
  };
}

// ---------- Hero ----------
/** Direction the hero aims / holds the shield: toward the pointer, else straight ahead. */
export function aimDirection(hero: Hero): Vec2 {
  const dx = hero.aimX - hero.x;
  const dz = hero.aimZ - hero.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.2) return { x: Math.sin(hero.yaw), z: Math.cos(hero.yaw) };
  return { x: dx / len, z: dz / len };
}

/** Fires one arrow straight from the hero toward the aim point. Arrows never run out. */
export function fireArrow(b: Battle): Arrow {
  const h = b.hero;
  const d = aimDirection(h);
  h.yaw = yawTo(d.x, d.z);
  const arrow: Arrow = { id: b.nextId++, x: h.x + d.x * 0.7, z: h.z + d.z * 0.7, dx: d.x, dz: d.z, traveled: 0 };
  b.arrows.push(arrow);
  h.fireCooldown = FIRE_COOLDOWN;
  b.events.push({ type: "heroFire", id: arrow.id });
  return arrow;
}

function stepHero(b: Battle, input: BattleInput, dt: number) {
  const h = b.hero;
  if (h.dead) {
    h.speed = 0;
    h.vx = h.vz = 0;
    return;
  }
  // The shield is up only while its button is held; letting go brings the bow back.
  h.mode = input.shieldHeld ? "shield" : "bow";
  if (h.mode === "shield") h.aiming = false;
  h.fireCooldown = Math.max(0, h.fireCooldown - dt);
  h.sinceHit += dt;

  const shieldSlide = h.mode === "shield" && Math.hypot(input.shieldDirX, input.shieldDirZ) > 0.01;
  if (shieldSlide) {
    // Sliding the finger on the shield button turns the shield that way (left → left, right → right).
    h.aimX = h.x + input.shieldDirX * 5;
    h.aimZ = h.z + input.shieldDirZ * 5;
  } else if (input.pointerHeld || input.released) {
    h.aimX = input.pointerX;
    h.aimZ = input.pointerZ;
  }
  const wasAiming = h.aiming;
  h.aiming = h.mode === "bow" && input.pointerHeld;

  // Move.
  let mx = input.moveX;
  let mz = input.moveZ;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const top = h.mode === "shield" ? HERO_SHIELD_SPEED : h.aiming ? HERO_AIM_SPEED : HERO_RUN_SPEED;
  const p = { x: h.x + mx * top * dt, z: h.z + mz * top * dt };
  resolveCircle(p, HERO_RADIUS, b.props);
  h.vx = (p.x - h.x) / Math.max(dt, 1e-6);
  h.vz = (p.z - h.z) / Math.max(dt, 1e-6);
  h.speed = Math.hypot(h.vx, h.vz);
  h.x = p.x;
  h.z = p.z;

  // Face: toward the aim point while aiming / turning the shield, else along the walk.
  if (h.aiming || (h.mode === "shield" && (input.pointerHeld || shieldSlide))) {
    const d = aimDirection(h);
    h.yaw = turnToward(h.yaw, yawTo(d.x, d.z), HERO_TURN_RATE * 1.6, dt);
  } else if (len > 0.05) {
    h.yaw = turnToward(h.yaw, yawTo(mx, mz), HERO_TURN_RATE, dt);
  }

  // Let go → the arrow flies straight to where the hero was aiming.
  if (input.released && wasAiming && h.mode === "bow" && h.fireCooldown <= 0) fireArrow(b);
}

function damageHero(b: Battle, dmg: number) {
  const h = b.hero;
  if (h.dead || b.won) return;
  // One hit kills (every shot does at least the hero's whole single life).
  h.hp = Math.max(0, h.hp - Math.max(dmg, h.hp));
  h.sinceHit = 0;
  b.events.push({ type: "heroHit", damage: dmg });
  if (h.hp <= 0) {
    h.dead = true;
    h.aiming = false;
    b.over = true;
    b.events.push({ type: "heroDied" });
  }
}

/** True when a shot at (x,z) coming toward the hero meets the raised shield. */
export function shieldBlocks(hero: Hero, shotX: number, shotZ: number) {
  if (hero.mode !== "shield" || hero.dead) return false;
  const toShot = yawTo(shotX - hero.x, shotZ - hero.z);
  return Math.abs(angleDiff(hero.yaw, toShot)) <= SHIELD_BLOCK_HALF_ANGLE;
}

// ---------- Arrows ----------
function damageEnemy(b: Battle, e: Enemy, dmg: number) {
  if (e.state === "dead") return;
  // One hit kills (an arrow takes the enemy's whole single life).
  e.hp -= Math.max(dmg, e.hp);
  if (e.hp <= 0) {
    e.hp = 0;
    e.state = "dead";
    e.timer = ENEMY_CORPSE_TIME;
    b.kills += 1;
    b.coins += COINS_PER_ENEMY;
    b.events.push({ type: "enemyKilled", id: e.id, x: e.x, z: e.z, coins: COINS_PER_ENEMY });
    // The last enemy of the match is down: the hero wins and the round ends.
    if (b.kills >= b.enemyTotal && !b.hero.dead) {
      b.won = true;
      b.over = true;
      b.hero.aiming = false;
      b.events.push({ type: "victory" });
    }
  } else {
    b.events.push({ type: "enemyHit", id: e.id, x: e.x, z: e.z });
  }
}

function stepArrows(b: Battle, dt: number) {
  const keep: Arrow[] = [];
  for (const a of b.arrows) {
    const step = ARROW_SPEED * dt;
    let done = false;
    // Sub-steps so fast arrows can't skip through a target.
    const n = Math.max(1, Math.ceil(step / 0.4));
    for (let i = 0; i < n && !done; i++) {
      a.x += (a.dx * step) / n;
      a.z += (a.dz * step) / n;
      a.traveled += step / n;
      for (const e of b.enemies) {
        if (e.state === "dead" || e.state === "spawning") continue;
        const r = ENEMY_SPECS[e.kind].radius + 0.15;
        if ((e.x - a.x) ** 2 + (e.z - a.z) ** 2 < r * r) {
          damageEnemy(b, e, ARROW_DAMAGE);
          done = true;
          break;
        }
      }
      if (!done && hitsProp(a.x, a.z, 0.05, b.props)) {
        b.events.push({ type: "impact", x: a.x, z: a.z });
        done = true;
      }
    }
    if (!done && (a.traveled >= ARROW_RANGE || Math.abs(a.x) > MAP_HALF + 2 || Math.abs(a.z) > MAP_HALF + 2)) done = true;
    if (!done) keep.push(a);
  }
  b.arrows = keep;
}

// ---------- Enemies ----------
export function spawnEnemy(b: Battle, kind?: EnemyKind, at?: Vec2): Enemy | null {
  const k = kind ?? pickWeighted(b, Object.entries(ENEMY_SPECS).map(([n, s]) => [n as EnemyKind, s.weight] as [EnemyKind, number]));
  const spec = ENEMY_SPECS[k];
  let pos = at;
  for (let i = 0; !pos && i < 40; i++) {
    const x = range(b, -MAP_HALF + 2, MAP_HALF - 2);
    const z = range(b, -MAP_HALF + 2, MAP_HALF - 2);
    const d = Math.hypot(x - b.hero.x, z - b.hero.z);
    if (d < ENEMY_MIN_SPAWN_DISTANCE || d > 30) continue;
    if (hitsProp(x, z, spec.radius + 0.4, b.props)) continue;
    pos = { x, z };
  }
  if (!pos) return null;
  const e: Enemy = {
    id: b.nextId++,
    kind: k,
    x: pos.x,
    z: pos.z,
    yaw: yawTo(b.hero.x - pos.x, b.hero.z - pos.z),
    speed: 0,
    hp: spec.hp,
    state: "spawning",
    timer: ENEMY_SPAWN_TIME,
    cooldown: range(b, 0.6, 1.6),
    strafe: nextRandom(b) < 0.5 ? 1 : -1,
    strafeTimer: range(b, 1, 3),
  };
  b.enemies.push(e);
  b.events.push({ type: "enemySpawn", id: e.id });
  return e;
}

function throwShot(b: Battle, e: Enemy) {
  const spec = ENEMY_SPECS[e.kind];
  const h = b.hero;
  const dx = h.x - e.x;
  const dz = h.z - e.z;
  const len = Math.hypot(dx, dz) || 1;
  const d = { x: dx / len, z: dz / len };
  e.yaw = yawTo(d.x, d.z);
  b.shots.push({ id: b.nextId++, kind: spec.shot, x: e.x + d.x * 0.8, z: e.z + d.z * 0.8, dx: d.x, dz: d.z, speed: spec.shotSpeed, traveled: 0, damage: spec.damage });
  b.events.push({ type: "enemyThrow", id: e.id });
}

function stepEnemies(b: Battle, dt: number) {
  const h = b.hero;
  for (const e of b.enemies) {
    const spec = ENEMY_SPECS[e.kind];
    e.timer -= dt;
    if (e.state === "dead" || e.state === "spawning") {
      e.speed = 0;
      if (e.state === "spawning" && e.timer <= 0) e.state = "moving";
      continue;
    }
    const dx = h.x - e.x;
    const dz = h.z - e.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const ux = dx / dist;
    const uz = dz / dist;
    e.cooldown -= dt;

    if (e.state === "windup") {
      e.speed = 0;
      e.yaw = turnToward(e.yaw, yawTo(ux, uz), 10, dt);
      if (e.timer <= 0) {
        if (!h.dead) throwShot(b, e);
        e.state = "recover";
        e.timer = 0.45;
        e.cooldown = range(b, spec.cooldown[0], spec.cooldown[1]);
      }
      continue;
    }
    if (e.state === "recover") {
      e.speed = 0;
      if (e.timer <= 0) e.state = "moving";
      continue;
    }

    // Moving: close in, back off, or circle the hero inside the fighting range.
    e.strafeTimer -= dt;
    if (e.strafeTimer <= 0) {
      e.strafe = e.strafe === 1 ? -1 : 1;
      e.strafeTimer = range(b, 1.2, 3.2);
    }
    let mx = 0;
    let mz = 0;
    if (dist > spec.maxRange) {
      mx = ux;
      mz = uz;
    } else if (dist < spec.minRange) {
      mx = -ux;
      mz = -uz;
    } else {
      mx = -uz * e.strafe * 0.6;
      mz = ux * e.strafe * 0.6;
    }
    const p = { x: e.x + mx * spec.speed * dt, z: e.z + mz * spec.speed * dt };
    // Keep enemies apart.
    for (const o of b.enemies) {
      if (o === e || o.state === "dead") continue;
      const ox = p.x - o.x;
      const oz = p.z - o.z;
      const min = spec.radius + ENEMY_SPECS[o.kind].radius;
      const d = Math.hypot(ox, oz);
      if (d < min && d > 0.0001) {
        p.x = o.x + (ox / d) * min;
        p.z = o.z + (oz / d) * min;
      }
    }
    resolveCircle(p, spec.radius, b.props);
    e.speed = Math.hypot(p.x - e.x, p.z - e.z) / Math.max(dt, 1e-6);
    const moveYaw = e.speed > 0.2 ? yawTo(p.x - e.x, p.z - e.z) : e.yaw;
    e.x = p.x;
    e.z = p.z;
    const inRange = dist <= spec.maxRange + 2;
    e.yaw = turnToward(e.yaw, inRange ? yawTo(ux, uz) : moveYaw, 8, dt);

    if (inRange && e.cooldown <= 0 && !h.dead) {
      e.state = "windup";
      e.timer = spec.windup;
      b.events.push({ type: "enemyAttack", id: e.id });
    }
  }
  // Remove corpses once their death animation has played.
  b.enemies = b.enemies.filter((e) => !(e.state === "dead" && e.timer <= 0));
}

function stepShots(b: Battle, dt: number) {
  const h = b.hero;
  const keep: Shot[] = [];
  for (const s of b.shots) {
    const step = s.speed * dt;
    s.x += s.dx * step;
    s.z += s.dz * step;
    s.traveled += step;
    const reach = HERO_RADIUS + SHOT_RADIUS + (h.mode === "shield" ? 0.35 : 0);
    if (!h.dead && (s.x - h.x) ** 2 + (s.z - h.z) ** 2 < reach * reach) {
      if (shieldBlocks(h, s.x - s.dx * 0.5, s.z - s.dz * 0.5)) b.events.push({ type: "blocked", x: s.x, z: s.z });
      else damageHero(b, s.damage);
      continue;
    }
    if (hitsProp(s.x, s.z, SHOT_RADIUS * 0.5, b.props)) {
      b.events.push({ type: "impact", x: s.x, z: s.z });
      continue;
    }
    if (s.traveled < SHOT_RANGE) keep.push(s);
  }
  b.shots = keep;
}

/** Enemies of the match still alive on the map. */
export function enemiesAlive(b: Battle) {
  return b.enemies.filter((e) => e.state !== "dead").length;
}

/** Waves: the next wave comes only after every enemy of the current one is dead. */
function stepSpawner(b: Battle, dt: number) {
  if (b.over) return;
  // The gap before the next wave only starts counting once the current wave is cleared.
  if (b.waveLeft === 0 && enemiesAlive(b) > 0) {
    b.spawnTimer = WAVE_GAP;
    return;
  }
  b.spawnTimer -= dt;
  if (b.spawnTimer > 0) return;
  if (b.waveLeft === 0) {
    if (b.wave >= b.waves.length) return;
    b.wave += 1;
    b.waveLeft = b.waves[b.wave - 1]!;
    b.events.push({ type: "waveStart", wave: b.wave, size: b.waveLeft });
  }
  // Bring the whole wave out (a spawn that finds no free spot tries again shortly).
  while (b.waveLeft > 0 && spawnEnemy(b)) {
    b.waveLeft -= 1;
    b.spawned += 1;
  }
  b.spawnTimer = b.waveLeft > 0 ? 0.2 : WAVE_GAP;
}

/** One fixed order per frame: hero → arrows → enemies → enemy shots → spawner. */
export function stepBattle(b: Battle, input: BattleInput, dt: number) {
  b.time += dt;
  stepHero(b, input, dt);
  stepArrows(b, dt);
  stepEnemies(b, dt);
  stepShots(b, dt);
  stepSpawner(b, dt);
}
