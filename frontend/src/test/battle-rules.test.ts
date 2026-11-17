import { describe, expect, it } from "vitest";
import {
  ARROW_RANGE,
  ENEMY_SPECS,
  FIRE_COOLDOWN,
  HERO_SPAWN,
  MAP_HALF,
  SPAWN_CLEAR_RADIUS,
  createBattle,
  emptyInput,
  generateProps,
  maxEnemiesAlive,
  spawnEnemy,
  stepBattle,
  type Battle,
} from "@/lib/battle-rules";
import { COINS_PER_ENEMY } from "@/lib/home-rules";

/** A battle with no props and no spawns, so each rule can be checked on its own. */
function emptyBattle(): Battle {
  const b = createBattle(1);
  b.props = [];
  b.spawnTimer = 1e9;
  return b;
}

function run(b: Battle, seconds: number, input = emptyInput()) {
  for (let t = 0; t < seconds; t += 1 / 60) stepBattle(b, { ...input, toggleShield: false, released: false }, 1 / 60);
}

/** Hold the finger on (x, z) for a moment, then let go. */
function aimAndRelease(b: Battle, x: number, z: number) {
  stepBattle(b, { ...emptyInput(), pointerHeld: true, pointerX: x, pointerZ: z }, 1 / 60);
  stepBattle(b, { ...emptyInput(), released: true, pointerX: x, pointerZ: z }, 1 / 60);
}

describe("map edge", () => {
  it("keeps the hero inside the map however long they walk", () => {
    const b = emptyBattle();
    run(b, 20, { ...emptyInput(), moveX: 1, moveZ: -1 });
    expect(b.hero.x).toBeLessThanOrEqual(MAP_HALF);
    expect(b.hero.z).toBeGreaterThanOrEqual(-MAP_HALF);
    expect(b.hero.x).toBeGreaterThan(MAP_HALF - 1);
  });
});

describe("bow", () => {
  it("does not shoot while the finger is still held", () => {
    const b = emptyBattle();
    stepBattle(b, { ...emptyInput(), pointerHeld: true, pointerX: 10, pointerZ: HERO_SPAWN.z }, 1 / 60);
    expect(b.arrows).toHaveLength(0);
    expect(b.hero.aiming).toBe(true);
  });

  it("shoots one arrow straight at the aimed point the moment the finger is let go", () => {
    const b = emptyBattle();
    aimAndRelease(b, HERO_SPAWN.x + 10, HERO_SPAWN.z);
    expect(b.arrows).toHaveLength(1);
    const a = b.arrows[0]!;
    expect(a.dx).toBeCloseTo(1, 5);
    expect(a.dz).toBeCloseTo(0, 5);
    run(b, 0.3);
    expect(b.arrows[0]!.z).toBeCloseTo(HERO_SPAWN.z, 5);
  });

  it("never runs out of arrows", () => {
    const b = emptyBattle();
    let fired = 0;
    for (let i = 0; i < 200; i++) {
      aimAndRelease(b, 0, -20);
      fired += b.arrows.length > 0 ? 1 : 0;
      b.arrows = [];
      run(b, FIRE_COOLDOWN + 0.05);
    }
    expect(fired).toBe(200);
  });

  it("arrows fly at most their range", () => {
    const b = emptyBattle();
    aimAndRelease(b, 0, -30);
    run(b, 3);
    expect(b.arrows).toHaveLength(0);
    expect(ARROW_RANGE).toBe(22);
  });
});

describe("shield", () => {
  it("the shield button swaps the bow for the shield and back", () => {
    const b = emptyBattle();
    stepBattle(b, { ...emptyInput(), toggleShield: true }, 1 / 60);
    expect(b.hero.mode).toBe("shield");
    stepBattle(b, { ...emptyInput(), toggleShield: true }, 1 / 60);
    expect(b.hero.mode).toBe("bow");
  });

  it("does not shoot while the shield is raised", () => {
    const b = emptyBattle();
    stepBattle(b, { ...emptyInput(), toggleShield: true }, 1 / 60);
    aimAndRelease(b, 10, HERO_SPAWN.z);
    expect(b.arrows).toHaveLength(0);
  });

  it("dragging on the map turns the raised shield toward the finger", () => {
    const b = emptyBattle();
    stepBattle(b, { ...emptyInput(), toggleShield: true }, 1 / 60);
    run(b, 1, { ...emptyInput(), pointerHeld: true, pointerX: HERO_SPAWN.x + 10, pointerZ: HERO_SPAWN.z });
    expect(b.hero.yaw).toBeCloseTo(Math.PI / 2, 2);
  });

  it("blocks a shot coming from the front but not from behind", () => {
    const front = emptyBattle();
    stepBattle(front, { ...emptyInput(), toggleShield: true }, 1 / 60);
    run(front, 1, { ...emptyInput(), pointerHeld: true, pointerX: 10, pointerZ: HERO_SPAWN.z });
    const e = spawnEnemy(front, "axeman", { x: HERO_SPAWN.x + 8, z: HERO_SPAWN.z })!;
    e.state = "windup";
    e.timer = 0;
    run(front, 2, { ...emptyInput(), pointerHeld: true, pointerX: 10, pointerZ: HERO_SPAWN.z });
    expect(front.hero.hp).toBe(100);

    const back = emptyBattle();
    stepBattle(back, { ...emptyInput(), toggleShield: true }, 1 / 60);
    run(back, 1, { ...emptyInput(), pointerHeld: true, pointerX: -10, pointerZ: HERO_SPAWN.z });
    const e2 = spawnEnemy(back, "axeman", { x: HERO_SPAWN.x + 8, z: HERO_SPAWN.z })!;
    e2.state = "windup";
    e2.timer = 0;
    run(back, 2, { ...emptyInput(), pointerHeld: true, pointerX: -10, pointerZ: HERO_SPAWN.z });
    expect(back.hero.hp).toBe(100 - ENEMY_SPECS.axeman.damage);
  });
});

describe("enemies", () => {
  it("killing an enemy adds a kill and COINS_PER_ENEMY coins", () => {
    const b = emptyBattle();
    const e = spawnEnemy(b, "minion", { x: HERO_SPAWN.x + 6, z: HERO_SPAWN.z })!;
    e.state = "moving";
    e.cooldown = 99;
    aimAndRelease(b, e.x, e.z);
    run(b, 0.5);
    expect(b.kills).toBe(1);
    expect(b.coins).toBe(COINS_PER_ENEMY);
    expect(COINS_PER_ENEMY).toBe(10);
  });

  it("spawn over time, starting with 3 at once and never more than 8", () => {
    expect(maxEnemiesAlive(0)).toBe(3);
    expect(maxEnemiesAlive(1000)).toBe(8);
    const b = createBattle(7);
    run(b, 30);
    const alive = b.enemies.filter((e) => e.state !== "dead").length;
    expect(alive).toBeGreaterThan(0);
    expect(alive).toBeLessThanOrEqual(maxEnemiesAlive(b.time));
  });
});

describe("props per match", () => {
  it("lays out haystacks, carts and other props differently each match", () => {
    const a = generateProps(1);
    const b = generateProps(2);
    expect(a.length).toBeGreaterThan(20);
    expect(a.map((p) => `${p.kind}${p.x.toFixed(1)}`)).not.toEqual(b.map((p) => `${p.kind}${p.x.toFixed(1)}`));
  });

  it("keeps the hero spawn clear and every prop inside the wall", () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      for (const p of generateProps(seed)) {
        expect(Math.hypot(p.x - HERO_SPAWN.x, p.z - HERO_SPAWN.z)).toBeGreaterThanOrEqual(SPAWN_CLEAR_RADIUS);
        expect(Math.abs(p.x) + p.r).toBeLessThan(MAP_HALF);
        expect(Math.abs(p.z) + p.r).toBeLessThan(MAP_HALF);
      }
    }
  });
});
