import { describe, expect, it } from "vitest";
import {
  ARENA_FAR_Z,
  ARENA_NEAR_Z,
  BULLET_SPEED,
  HERO_RADIUS,
  HERO_SPAWN,
  OBSTACLE_COUNT,
  SPAWN_YAW,
  WALK_SPEED,
  aimRay,
  arenaBounds,
  coverObstacle,
  facing,
  fireBullet,
  generateObstacles,
  joystickVector,
  moveDirection,
  obstacleGap,
  stepBullet,
  stepHero,
  type HeroState,
  type Obstacle,
} from "@/lib/arena-hero";

const DT = 1 / 60;
const spawn = (): HeroState => ({ x: HERO_SPAWN.x, z: HERO_SPAWN.z, yaw: SPAWN_YAW, speed: 0 });
const run = (hero: HeroState, stick: { x: number; y: number }, seconds: number, obstacles: Obstacle[] = [], aiming = false) => {
  for (let t = 0; t < seconds; t += DT) stepHero(hero, { stick, aiming, shielding: false }, obstacles, DT);
  return hero;
};
const barrier = (x: number, z: number): Obstacle => ({ id: 99, kind: "barrier", x, z, halfW: 1.2, halfD: 0.36, height: 1.15, rotated: false });

describe("joystick", () => {
  it("pushing the stick up moves toward the base, down moves toward the camera", () => {
    expect(moveDirection(joystickVector(0, -60, 60)).z).toBeLessThan(0);
    expect(moveDirection(joystickVector(0, 60, 60)).z).toBeGreaterThan(0);
    expect(moveDirection(joystickVector(60, 0, 60)).x).toBeGreaterThan(0);
  });

  it("ignores tiny finger movements near the centre", () => {
    expect(joystickVector(3, 3, 60)).toEqual({ x: 0, y: 0 });
  });
});

describe("hero walking", () => {
  it("starts facing the base, away from the camera", () => {
    expect(facing(SPAWN_YAW).z).toBeCloseTo(-1, 6);
  });

  it("stick up walks the hero forward", () => {
    const hero = run(spawn(), { x: 0, y: 1 }, 1);
    expect(hero.z).toBeLessThan(HERO_SPAWN.z - WALK_SPEED * 0.9);
  });

  it("stick down turns him around first, then he walks back toward the camera", () => {
    const hero = { ...spawn(), z: -20 };
    stepHero(hero, { stick: { x: 0, y: -1 }, aiming: false, shielding: false }, [], DT);
    expect(Math.abs(hero.z - -20)).toBeLessThan(0.01); // still turning
    run(hero, { x: 0, y: -1 }, 0.6);
    expect(facing(hero.yaw).z).toBeCloseTo(1, 3); // faces the camera
    const z = hero.z;
    run(hero, { x: 0, y: -1 }, 0.3);
    expect(hero.z).toBeGreaterThan(z);
  });

  it("never leaves the arena", () => {
    const hero = run(spawn(), { x: 1, y: -1 }, 20);
    expect(hero.z).toBeLessThanOrEqual(ARENA_NEAR_Z);
    expect(hero.x).toBeLessThanOrEqual(arenaBounds(hero.z).maxX + 1e-9);
    const far = run(spawn(), { x: -1, y: 1 }, 30);
    expect(far.z).toBeGreaterThanOrEqual(ARENA_FAR_Z);
    expect(far.x).toBeGreaterThanOrEqual(arenaBounds(far.z).minX - 1e-9);
  });

  it("cannot walk through an obstacle", () => {
    const wall = barrier(0, -14);
    const hero = run(spawn(), { x: 0, y: 1 }, 3, [wall]);
    expect(hero.z).toBeGreaterThanOrEqual(-14 + 0.36 + HERO_RADIUS - 1e-6);
  });

  it("standing against an obstacle takes cover behind it", () => {
    const wall = barrier(0, -14);
    const hero = run(spawn(), { x: 0, y: 1 }, 3, [wall]);
    expect(coverObstacle(hero, [wall])?.id).toBe(99);
    expect(coverObstacle(spawn(), [wall])).toBeNull();
  });
});

describe("obstacles per match", () => {
  it("each match places them in different spots", () => {
    const a = generateObstacles(1);
    const b = generateObstacles(2);
    expect(a.map((o) => [o.x, o.z])).not.toEqual(b.map((o) => [o.x, o.z]));
  });

  it("the same match seed gives the same layout", () => {
    expect(generateObstacles(42)).toEqual(generateObstacles(42));
  });

  it("places all of them in the middle of the arena, apart and away from the hero", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const list = generateObstacles(seed);
      expect(list.length).toBe(OBSTACLE_COUNT);
      expect(list.filter((o) => o.kind === "barrier").length).toBeGreaterThanOrEqual(2);
      for (const o of list) {
        expect(obstacleGap(HERO_SPAWN, o)).toBeGreaterThanOrEqual(3);
        const { minX, maxX } = arenaBounds(o.z + o.halfD);
        expect(o.x - o.halfW).toBeGreaterThanOrEqual(minX);
        expect(o.x + o.halfW).toBeLessThanOrEqual(maxX);
      }
    }
  });
});

describe("shooting", () => {
  it("the aim ray stops at the first obstacle in the shot's direction", () => {
    const wall = barrier(0, -20);
    const ray = aimRay({ x: 0, z: -10 }, { x: 0, z: -1 }, [wall]);
    expect(ray.obstacle?.id).toBe(99);
    expect(ray.distance).toBeCloseTo(10 - 0.36, 6);
  });

  it("shoots over the low cover the hero is standing behind", () => {
    const wall = barrier(0, -14);
    const hero = run(spawn(), { x: 0, y: 1 }, 3, [wall]);
    const bullet = fireBullet(hero, [wall]);
    expect(bullet.hitsObstacle).toBe(false);
  });

  it("the shot goes in the direction the hero faces", () => {
    const hero = run(spawn(), { x: 1, y: 0 }, 1); // turned right
    const bullet = fireBullet(hero, []);
    expect(bullet.dx).toBeCloseTo(1, 3);
  });

  it("bullets are very fast: 20 m in under a quarter second", () => {
    const bullet = fireBullet(spawn(), []);
    let t = 0;
    while (bullet.traveled < 20) {
      stepBullet(bullet, DT);
      t += DT;
    }
    expect(t).toBeLessThan(0.25);
    expect(BULLET_SPEED).toBeGreaterThanOrEqual(80);
  });
});
