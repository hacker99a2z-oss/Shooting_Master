import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Link } from "@tanstack/react-router";
import { Home, RotateCcw, Skull } from "lucide-react";
import { HERO_MAX_HP, createBattle, emptyInput, stepBattle, type Battle, type EnemyKind, type ShotKind } from "@/lib/battle-rules";
import { CAMERA_PITCH, cameraDistance, cameraFocusLimit } from "@/lib/battle-camera";
import { BattleGround, BattleWorld } from "./BattleWorld";
import { BattleControls, createControls, type ControlState } from "./BattleControls";
import { CHARACTER_FILES, MODEL, configureLoader } from "./models";
import { EnemyView, Effects, HeroView, ProjectileView } from "./views";

const ENEMY_KINDS: EnemyKind[] = ["archer", "axeman", "warrior", "minion"];
const POOL_PER_KIND = 6;
const SHOT_POOL = 14;
const ARROW_POOL = 14;
const CHAR_URLS = [CHARACTER_FILES.hero, ...ENEMY_KINDS.map((k) => CHARACTER_FILES[k])].map(MODEL);
const WEAPON_FILES = ["shield", "arrow", "axe", "crossbow", "blade"] as const;
const WEAPON_URLS = WEAPON_FILES.map(MODEL);

export type HudState = { hp: number; kills: number; coins: number; shield: boolean; over: boolean };

/** Builds this frame's rules input from the raw controls (pointer ray-cast onto the ground). */
function readInput(c: ControlState, camera: THREE.Camera, ray: THREE.Raycaster, plane: THREE.Plane, hit: THREE.Vector3, ndc: THREE.Vector2) {
  const input = emptyInput();
  const k = c.keys;
  input.moveX = c.stick.x + (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
  input.moveZ = c.stick.y + (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) - (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0);
  const held = c.pointerDown || (c.releaseQueued && !c.pressSeen);
  const released = c.releaseQueued && c.pressSeen;
  if (held || released) {
    ray.setFromCamera(ndc.set(c.ndcX, c.ndcY), camera);
    if (ray.ray.intersectPlane(plane, hit)) {
      input.pointerX = hit.x;
      input.pointerZ = hit.z;
    }
  }
  input.pointerHeld = held;
  input.released = released;
  if (held) c.pressSeen = true;
  if (released) c.releaseQueued = false;
  input.toggleShield = c.shieldToggleQueued;
  c.shieldToggleQueued = false;
  return input;
}

/** Finger / mouse on the map → aim point (works alongside the joystick finger). */
function PointerAim({ controls }: { controls: ControlState }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    const setNdc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      controls.ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
      controls.ndcY = -((e.clientY - r.top) / r.height) * 2 + 1;
    };
    const down = (e: PointerEvent) => {
      if (controls.pointerId !== null) return;
      controls.pointerId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      setNdc(e);
      controls.pointerDown = true;
      controls.pressSeen = false;
      controls.releaseQueued = false;
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === controls.pointerId) setNdc(e);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== controls.pointerId) return;
      setNdc(e);
      controls.pointerId = null;
      controls.pointerDown = false;
      controls.releaseQueued = true;
    };
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("contextmenu", menu);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("contextmenu", menu);
    };
  }, [gl, controls]);
  return null;
}

/** The one stepper: input → rules → views → camera, in that order, every frame. */
function GameLoop({ battle, controls, onHud, onReady }: { battle: Battle; controls: ControlState; onHud: (h: HudState) => void; onReady: () => void }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const scene = useThree((s) => s.scene);
  const chars = useLoader(GLTFLoader, CHAR_URLS, configureLoader) as GLTF[];
  const weaponList = useLoader(GLTFLoader, WEAPON_URLS, configureLoader) as GLTF[];
  const sun = useRef<THREE.DirectionalLight>(null);

  const world = useMemo(() => {
    const weapons: Record<string, GLTF> = {};
    WEAPON_FILES.forEach((f, i) => (weapons[f] = weaponList[i]!));
    const hero = new HeroView(chars[0]!, weapons["shield"]!);
    const enemies: EnemyView[] = [];
    ENEMY_KINDS.forEach((kind, i) => {
      for (let n = 0; n < POOL_PER_KIND; n++) enemies.push(new EnemyView(kind, chars[i + 1]!, weapons));
    });
    const arrows = Array.from({ length: ARROW_POOL }, () => new ProjectileView("hero", weapons));
    const shots: Record<ShotKind, ProjectileView[]> = {
      arrow: Array.from({ length: SHOT_POOL }, () => new ProjectileView("arrow", weapons)),
      axe: Array.from({ length: SHOT_POOL }, () => new ProjectileView("axe", weapons)),
      blade: Array.from({ length: SHOT_POOL }, () => new ProjectileView("blade", weapons)),
      rock: Array.from({ length: SHOT_POOL }, () => new ProjectileView("rock", weapons)),
    };
    const effects = new Effects();
    const group = new THREE.Group();
    group.add(hero.root, effects.group, ...enemies.map((e) => e.root), ...arrows.map((a) => a.root), ...Object.values(shots).flat().map((s) => s.root));
    return { hero, enemies, arrows, shots, effects, group };
  }, [chars, weaponList]);

  const tools = useMemo(
    () => ({
      ray: new THREE.Raycaster(),
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      hit: new THREE.Vector3(),
      ndc: new THREE.Vector2(),
      target: new THREE.Vector3(),
      focus: new THREE.Vector3(battle.hero.x, 0, battle.hero.z),
      placed: false,
      hudTimer: 0,
      frames: 0,
    }),
    [battle],
  );
  const lastHud = useRef("");

  useEffect(() => {
    scene.add(world.group);
    return () => {
      scene.remove(world.group);
    };
  }, [scene, world]);

  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __battle?: unknown }).__battle = { battle, controls, views: world };
  }, [battle, controls, world]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    // 1. Rules.
    const input = readInput(controls, camera, tools.ray, tools.plane, tools.hit, tools.ndc);
    stepBattle(battle, input, dt);

    // 2. Events → one-shot animations and effects.
    const byId = new Map(world.enemies.filter((v) => v.id >= 0).map((v) => [v.id, v] as const));
    for (const ev of battle.events) {
      if (ev.type === "heroFire") world.hero.fire();
      else if (ev.type === "heroHit") world.hero.hit(false);
      else if (ev.type === "blocked") {
        world.hero.hit(true);
        world.effects.block(ev.x, ev.z);
      } else if (ev.type === "impact") world.effects.spark(ev.x, ev.z);
      else if (ev.type === "enemyHit") {
        byId.get(ev.id)?.hit();
        world.effects.spark(ev.x, ev.z, true);
      } else if (ev.type === "enemyKilled") {
        world.effects.spark(ev.x, ev.z, true);
        world.effects.coin(ev.x, ev.z);
      } else if (ev.type === "enemyAttack") byId.get(ev.id)?.attack();
      else if (ev.type === "enemyThrow") byId.get(ev.id)?.threw();
      else if (ev.type === "enemySpawn") {
        const e = battle.enemies.find((x) => x.id === ev.id);
        const view = e && world.enemies.find((v) => v.kind === e.kind && v.id < 0);
        if (e && view) {
          view.bind(e);
          byId.set(e.id, view);
        }
      }
    }
    battle.events.length = 0;

    // 3. Views.
    const h = battle.hero;
    world.hero.update(h, camera, dt);
    const alive = new Set(battle.enemies.map((e) => e.id));
    for (const v of world.enemies) if (v.id >= 0 && !alive.has(v.id)) v.hide();
    for (const e of battle.enemies) byId.get(e.id)?.update(e, h.x, h.z, camera, dt);
    world.arrows.forEach((view, i) => {
      const a = battle.arrows[i];
      if (!a) view.root.visible = false;
      else view.place(a.x, a.z, a.dx, a.dz, a.traveled, dt);
    });
    const used: Record<ShotKind, number> = { arrow: 0, axe: 0, blade: 0, rock: 0 };
    for (const s of battle.shots) world.shots[s.kind][used[s.kind]++]?.place(s.x, s.z, s.dx, s.dz, s.traveled, dt);
    (Object.keys(world.shots) as ShotKind[]).forEach((k) =>
      world.shots[k].forEach((v, i) => {
        if (i >= used[k]) v.root.visible = false;
      }),
    );
    world.effects.update(camera, dt);

    // 4. Camera: high MOBA angle following the hero, kept inside the map so the outside never shows.
    const aspect = size.width / Math.max(1, size.height);
    const dist = cameraDistance(camera.fov, aspect);
    const lim = cameraFocusLimit(camera.fov, aspect, dist);
    tools.target.set(Math.max(-lim.x, Math.min(lim.x, h.x)), 0, Math.max(-lim.zTop, Math.min(lim.zBottom, h.z)));
    if (!tools.placed) {
      tools.focus.copy(tools.target);
      tools.placed = true;
    } else tools.focus.lerp(tools.target, 1 - Math.exp(-7 * dt));
    camera.position.set(tools.focus.x, Math.sin(CAMERA_PITCH) * dist, tools.focus.z + Math.cos(CAMERA_PITCH) * dist);
    camera.lookAt(tools.focus.x, 0, tools.focus.z);
    if (sun.current) {
      sun.current.position.set(tools.focus.x + 14, 26, tools.focus.z + 10);
      sun.current.target.position.set(tools.focus.x, 0, tools.focus.z);
      sun.current.target.updateMatrixWorld();
    }

    // 5. HUD (only when something changed).
    tools.hudTimer -= dt;
    if (tools.hudTimer <= 0) {
      tools.hudTimer = 0.1;
      const hud: HudState = { hp: Math.ceil(h.hp), kills: battle.kills, coins: battle.coins, shield: h.mode === "shield", over: battle.over };
      const key = JSON.stringify(hud);
      if (key !== lastHud.current) {
        lastHud.current = key;
        onHud(hud);
      }
    }
    if (++tools.frames === 3) onReady();
  });

  return (
    <directionalLight
      ref={sun}
      castShadow
      intensity={2.3}
      color="#fff1d6"
      shadow-mapSize={[1024, 1024]}
      shadow-camera-left={-24}
      shadow-camera-right={24}
      shadow-camera-top={24}
      shadow-camera-bottom={-24}
      shadow-camera-near={1}
      shadow-camera-far={70}
      shadow-bias={-0.0006}
      shadow-normalBias={0.03}
    />
  );
}

function Hud({ hud }: { hud: HudState }) {
  const pct = (hud.hp / HERO_MAX_HP) * 100;
  return (
    <div className="battle-hud">
      <div className="battle-hp" aria-label={`Health ${hud.hp} of ${HERO_MAX_HP}`}>
        <span className="battle-hp-fill" style={{ width: `${pct}%` }} data-low={pct < 30 ? "true" : undefined} />
        <span className="battle-hp-text">{hud.hp}</span>
      </div>
      <div className="battle-score">
        <span className="battle-kills" aria-label="Enemies killed">
          <Skull className="h-4 w-4" />
          {hud.kills}
        </span>
        <span className="battle-coins" aria-label="Coins earned this round">
          <span className="coin-dot" />
          <span className="text-gold-gradient">{hud.coins.toLocaleString()}</span>
        </span>
      </div>
    </div>
  );
}

function GameOver({ hud, onRestart }: { hud: HudState; onRestart: () => void }) {
  return (
    <div className="battle-over" role="dialog" aria-label="Round over">
      <div className="battle-over-card">
        <p className="battle-over-title">Defeated!</p>
        <p className="battle-over-stat">
          <Skull className="h-5 w-5" /> {hud.kills} enemies killed
        </p>
        <p className="battle-over-stat">
          <span className="coin-dot" /> <span className="text-gold-gradient">{hud.coins.toLocaleString()}</span> coins
        </p>
        <div className="battle-over-actions">
          <button type="button" className="battle-over-button battle-over-primary" onClick={onRestart}>
            <RotateCcw className="h-5 w-5" /> Play again
          </button>
          <Link to="/" className="battle-over-button">
            <Home className="h-5 w-5" /> Home
          </Link>
        </div>
      </div>
    </div>
  );
}

function Match({ seed, onRestart }: { seed: number; onRestart: () => void }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const battle = useMemo(() => createBattle(seed), [seed]);
  const controls = useMemo(() => createControls(), []);
  const [hud, setHud] = useState<HudState>({ hp: HERO_MAX_HP, kills: 0, coins: 0, shield: false, over: false });
  const [overShown, setOverShown] = useState(false);
  const markReady = useMemo(() => () => wrapperRef.current?.setAttribute("data-scene-ready", "true"), []);

  useEffect(() => {
    if (!hud.over) return;
    const t = setTimeout(() => setOverShown(true), 1600);
    return () => clearTimeout(t);
  }, [hud.over]);

  return (
    <div ref={wrapperRef} className="battle-world" aria-label="Battle Arena map">
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 42, near: 0.5, far: 220, position: [0, 30, 30] }} gl={{ antialias: true }}>
        <color attach="background" args={["#4f7a35"]} />
        <fog attach="fog" args={["#9cc6a0", 45, 95]} />
        <hemisphereLight args={["#d8efff", "#4d6b2a", 1.1]} />
        <ambientLight intensity={0.25} />
        <BattleGround seed={seed} />
        <PointerAim controls={controls} />
        <Suspense fallback={null}>
          <BattleWorld props={battle.props} seed={seed} />
        </Suspense>
        <Suspense fallback={null}>
          <GameLoop battle={battle} controls={controls} onHud={setHud} onReady={markReady} />
        </Suspense>
      </Canvas>
      <Hud hud={hud} />
      {!hud.over && <BattleControls controls={controls} shieldOn={hud.shield} />}
      {overShown && <GameOver hud={hud} onRestart={onRestart} />}
    </div>
  );
}

const newSeed = () => (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;

/** Battle Arena: a fresh random map and enemies every match. */
export function BattleGame() {
  const [seed, setSeed] = useState(newSeed);
  return <Match key={seed} seed={seed} onRestart={() => setSeed(newSeed())} />;
}
