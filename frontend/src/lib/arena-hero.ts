/**
 * Battle Arena hero rules: joystick mapping, walking/turning, arena limits,
 * obstacle layout per match, cover, aiming ray and bullets.
 * Plain TypeScript (no React, no three.js) so every rule stays unit-tested.
 *
 * World axes: x = screen right, z = toward the camera (the base is at -z).
 * Hero yaw: forward = (sin yaw, cos yaw); yaw π faces the base, yaw 0 faces the camera.
 */

export type Vec2 = { x: number; z: number };
export type Stick = { x: number; y: number };

export type ObstacleKind = "barrier" | "crate" | "crateStack" | "barrel" | "ammo";
export type Obstacle = {
  id: number;
  kind: ObstacleKind;
  x: number;
  z: number;
  /** Half size along world x / world z (already swapped when rotated). */
  halfW: number;
  halfD: number;
  height: number;
  /** Turned 90° on the ground. */
  rotated: boolean;
};

export type HeroState = { x: number; z: number; yaw: number; speed: number };
export type HeroInput = { stick: Stick; aiming: boolean; shielding: boolean };

export type Bullet = {
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  traveled: number;
  /** Where it stops: first obstacle in its path, or its range. */
  distance: number;
  hitsObstacle: boolean;
  done: boolean;
};

/* ---------- Feel constants ---------- */
export const HERO_RADIUS = 0.35;
export const WALK_SPEED = 3.2;
/** Slower while aiming or holding the shield. */
export const AIM_WALK_SPEED = 1.7;
/** Turning speed in radians per second (a full turn-around takes about 0.3 s). */
export const TURN_RATE = 11;
export const JOYSTICK_DEADZONE = 0.15;
/** Bullets are very fast: metres per second. */
export const BULLET_SPEED = 95;
export const BULLET_RANGE = 48;
/** Low cover the gun starts this close to is shot over, not hit. */
export const MUZZLE_CLEARANCE = 1.2;
export const LOW_COVER_HEIGHT = 1.6;
/** Standing this close to an obstacle counts as taking cover. */
export const COVER_GAP = 0.32;
export const OBSTACLE_COUNT = 7;
export const OBSTACLE_MIN_GAP = 1.4;

/** Gun muzzle while aiming, relative to the hero (metres). */
export const MUZZLE_RIGHT = 0.42;
export const MUZZLE_UP = 1.24;
export const MUZZLE_FORWARD = 0.74;

export const HERO_SPAWN: Vec2 = { x: 0, z: -11 };
export const SPAWN_YAW = Math.PI;

/** Walkable depth range (z), nearest to the camera first. */
export const ARENA_NEAR_Z = -9;
export const ARENA_FAR_Z = -36;
export const ARENA_HALF_WIDTH = 9;
/** Obstacles fill the middle of the arena. */
export const OBSTACLE_NEAR_Z = -15;
export const OBSTACLE_FAR_Z = -32;

const TWO_PI = Math.PI * 2;

/* ---------- Joystick ---------- */

/** Finger offset (screen px, y down) → stick vector in -1..1 (y up), radial deadzone rescaled. */
export function joystickVector(dx: number, dy: number, radius: number): Stick {
  if (!(radius > 0)) return { x: 0, y: 0 };
  let x = dx / radius;
  let y = -dy / radius;
  const len = Math.hypot(x, y);
  if (len < JOYSTICK_DEADZONE || !Number.isFinite(len)) return { x: 0, y: 0 };
  const clamped = Math.min(1, len);
  const scaled = (clamped - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE);
  x = (x / len) * scaled;
  y = (y / len) * scaled;
  return { x, y };
}

/** Stick up = toward the base (-z), stick down = toward the camera (+z), right = +x. */
export function moveDirection(stick: Stick): Vec2 {
  return { x: stick.x, z: -stick.y };
}

/* ---------- Facing ---------- */

export function yawFromDirection(x: number, z: number) {
  return Math.atan2(x, z);
}

export function facing(yaw: number): Vec2 {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

/** Hero's right-hand side in world space. */
export function rightSide(yaw: number): Vec2 {
  return { x: -Math.cos(yaw), z: Math.sin(yaw) };
}

/** Signed shortest angle from a to b, in -π..π. */
export function angleDiff(a: number, b: number) {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

export function turnToward(current: number, target: number, maxStep: number) {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/* ---------- Arena limits ---------- */

/**
 * Side limits at a depth. The arena picture is projected from the camera start point and
 * its road vanishes right of centre, so the walkable strip widens with depth and is wider on the left.
 */
export function arenaBounds(z: number) {
  const depth = -z;
  return {
    minX: Math.max(-ARENA_HALF_WIDTH, -(0.85 * depth - 1.5)),
    maxX: Math.min(ARENA_HALF_WIDTH, 0.62 * depth - 1.5),
  };
}

export function clampToArena(p: Vec2): Vec2 {
  const z = Math.min(ARENA_NEAR_Z, Math.max(ARENA_FAR_Z, p.z));
  const { minX, maxX } = arenaBounds(z);
  return { x: Math.min(maxX, Math.max(minX, p.x)), z };
}

/* ---------- Obstacles ---------- */

/** Gap between a point and an obstacle's footprint (0 when inside). */
export function obstacleGap(p: Vec2, o: Obstacle) {
  const dx = Math.max(Math.abs(p.x - o.x) - o.halfW, 0);
  const dz = Math.max(Math.abs(p.z - o.z) - o.halfD, 0);
  return Math.hypot(dx, dz);
}

/** Push a circle out of every obstacle footprint. */
export function resolveObstacles(p: Vec2, obstacles: Obstacle[], radius = HERO_RADIUS): Vec2 {
  let { x, z } = p;
  for (const o of obstacles) {
    const cx = Math.min(o.x + o.halfW, Math.max(o.x - o.halfW, x));
    const cz = Math.min(o.z + o.halfD, Math.max(o.z - o.halfD, z));
    const dx = x - cx;
    const dz = z - cz;
    const dist = Math.hypot(dx, dz);
    if (dist >= radius) continue;
    if (dist > 1e-6) {
      x = cx + (dx / dist) * radius;
      z = cz + (dz / dist) * radius;
    } else {
      // Centre inside the box: leave along the shallowest side.
      const pushX = o.halfW - Math.abs(x - o.x) + radius;
      const pushZ = o.halfD - Math.abs(z - o.z) + radius;
      if (pushX < pushZ) x += (x >= o.x ? 1 : -1) * pushX;
      else z += (z >= o.z ? 1 : -1) * pushZ;
    }
  }
  return { x, z };
}

const OBSTACLE_SIZES: Record<ObstacleKind, { halfW: number; halfD: number; height: number }> = {
  barrier: { halfW: 1.2, halfD: 0.36, height: 1.15 },
  crate: { halfW: 0.6, halfD: 0.6, height: 1.2 },
  crateStack: { halfW: 1.2, halfD: 0.6, height: 2.3 },
  barrel: { halfW: 0.46, halfD: 0.46, height: 1.25 },
  ammo: { halfW: 0.85, halfD: 0.46, height: 1.35 },
};

/** Small deterministic random generator so a match's layout is reproducible from its seed. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function footprintGap(a: Obstacle, b: Obstacle) {
  const dx = Math.max(Math.abs(a.x - b.x) - a.halfW - b.halfW, 0);
  const dz = Math.max(Math.abs(a.z - b.z) - a.halfD - b.halfD, 0);
  return Math.hypot(dx, dz);
}

/** A new random obstacle layout for one match. The first two are always barriers (cover). */
export function generateObstacles(seed: number, count = OBSTACLE_COUNT): Obstacle[] {
  const rand = seededRandom(seed);
  const kinds: ObstacleKind[] = ["crate", "crateStack", "barrel", "ammo", "barrier"];
  const result: Obstacle[] = [];
  for (let i = 0; i < count; i++) {
    const kind: ObstacleKind = i < 2 ? "barrier" : (kinds[Math.floor(rand() * kinds.length)] ?? "crate");
    for (let attempt = 0; attempt < 80; attempt++) {
      const size = OBSTACLE_SIZES[kind];
      const rotated = kind !== "barrel" && rand() < 0.25;
      const halfW = rotated ? size.halfD : size.halfW;
      const halfD = rotated ? size.halfW : size.halfD;
      const z = OBSTACLE_NEAR_Z - halfD - rand() * (OBSTACLE_NEAR_Z - OBSTACLE_FAR_Z - 2 * halfD);
      const nearBounds = arenaBounds(z + halfD);
      const minX = nearBounds.minX + halfW + 0.8;
      const maxX = nearBounds.maxX - halfW - 0.8;
      if (maxX <= minX) continue;
      const x = minX + rand() * (maxX - minX);
      const candidate: Obstacle = { id: i, kind, x, z, halfW, halfD, height: size.height, rotated };
      if (obstacleGap(HERO_SPAWN, candidate) < 3) continue;
      if (result.some((o) => footprintGap(o, candidate) < OBSTACLE_MIN_GAP)) continue;
      result.push(candidate);
      break;
    }
  }
  return result;
}

/** The obstacle the hero is taking cover behind, if any. */
export function coverObstacle(p: Vec2, obstacles: Obstacle[]): Obstacle | null {
  let best: Obstacle | null = null;
  let bestGap = Infinity;
  for (const o of obstacles) {
    const gap = obstacleGap(p, o) - HERO_RADIUS;
    if (gap <= COVER_GAP && gap < bestGap) {
      best = o;
      bestGap = gap;
    }
  }
  return best;
}

/* ---------- Hero movement ---------- */

/**
 * One fixed step of hero movement. The hero turns toward the stick direction and only walks
 * once roughly facing it, so pulling the stick back makes him turn around, then walk back.
 * While aiming/shielding the stick still turns him, so shots and the shield follow its direction.
 */
export function stepHero(hero: HeroState, input: HeroInput, obstacles: Obstacle[], dt: number) {
  const dir = moveDirection(input.stick);
  const amount = Math.min(1, Math.hypot(dir.x, dir.z));
  if (amount <= 0 || dt <= 0) {
    hero.speed = 0;
    return hero;
  }
  const targetYaw = yawFromDirection(dir.x, dir.z);
  hero.yaw = turnToward(hero.yaw, targetYaw, TURN_RATE * dt);
  const alignment = Math.max(0, Math.cos(angleDiff(hero.yaw, targetYaw)));
  const maxSpeed = input.aiming || input.shielding ? AIM_WALK_SPEED : WALK_SPEED;
  const speed = maxSpeed * amount * alignment * alignment;
  const step = speed * dt;
  const ux = dir.x / Math.hypot(dir.x, dir.z);
  const uz = dir.z / Math.hypot(dir.x, dir.z);
  const before = { x: hero.x, z: hero.z };
  let next = { x: hero.x + ux * step, z: hero.z + uz * step };
  next = clampToArena(resolveObstacles(next, obstacles));
  hero.x = next.x;
  hero.z = next.z;
  hero.speed = Math.hypot(next.x - before.x, next.z - before.z) / dt;
  hero.yaw = ((hero.yaw % TWO_PI) + TWO_PI) % TWO_PI;
  return hero;
}

/* ---------- Aiming and bullets ---------- */

export function muzzlePosition(hero: HeroState) {
  const f = facing(hero.yaw);
  const r = rightSide(hero.yaw);
  return {
    x: hero.x + f.x * MUZZLE_FORWARD + r.x * MUZZLE_RIGHT,
    y: MUZZLE_UP,
    z: hero.z + f.z * MUZZLE_FORWARD + r.z * MUZZLE_RIGHT,
  };
}

/**
 * Distance along a flat ray to the first obstacle it hits. Low cover that the ray starts
 * inside or right next to (the hero's own cover) is shot over.
 */
export function aimRay(origin: Vec2, dir: Vec2, obstacles: Obstacle[], maxDist = BULLET_RANGE) {
  let best = maxDist;
  let hit: Obstacle | null = null;
  for (const o of obstacles) {
    let tEnter = -Infinity;
    let tExit = Infinity;
    const axes: Array<[number, number, number, number]> = [
      [origin.x, dir.x, o.x - o.halfW, o.x + o.halfW],
      [origin.z, dir.z, o.z - o.halfD, o.z + o.halfD],
    ];
    let miss = false;
    for (const [p, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) miss = true;
        continue;
      }
      let t1 = (lo - p) / d;
      let t2 = (hi - p) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tEnter = Math.max(tEnter, t1);
      tExit = Math.min(tExit, t2);
    }
    if (miss || tExit < tEnter || tExit < 0) continue;
    if (o.height < LOW_COVER_HEIGHT && tEnter < MUZZLE_CLEARANCE) continue;
    const t = Math.max(0, tEnter);
    if (t < best) {
      best = t;
      hit = o;
    }
  }
  return { distance: best, obstacle: hit };
}

export function fireBullet(hero: HeroState, obstacles: Obstacle[]): Bullet {
  const m = muzzlePosition(hero);
  const f = facing(hero.yaw);
  const ray = aimRay({ x: m.x, z: m.z }, f, obstacles);
  return { x: m.x, y: m.y, z: m.z, dx: f.x, dz: f.z, traveled: 0, distance: ray.distance, hitsObstacle: !!ray.obstacle, done: false };
}

/** Moves a bullet; it stops exactly where its path ends. */
export function stepBullet(b: Bullet, dt: number) {
  if (b.done) return b;
  const step = Math.min(BULLET_SPEED * dt, b.distance - b.traveled);
  b.x += b.dx * step;
  b.z += b.dz * step;
  b.traveled += step;
  if (b.traveled >= b.distance - 1e-9) b.done = true;
  return b;
}
