import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Link } from "@tanstack/react-router";
import { Home, Skull } from "lucide-react";
import { createBattle, emptyInput, randomEnemyTotal, stepBattle, type Battle, type ShotKind } from "@/lib/battle-rules";
import { cancelGame, finishGame, startGame, type Player } from "@/lib/api.functions";
import { COIN_GAIN_KEY, type CoinGain } from "@/lib/coin-gain";
import { auth } from "@/lib/tg";
import { CAMERA_PITCH, cameraDistance, cameraFocusLimit } from "@/lib/battle-camera";
import { BattleGround, BattleWorld } from "./BattleWorld";
import { BattleControls, createControls, type ControlState } from "./BattleControls";
import { CHARACTER_URLS, ENEMY_KINDS, WEAPON_FILES, WEAPON_URLS, configureLoader } from "./models";
import { EnemyView, Effects, HeroView, ProjectileView } from "./views";
import { QUALITY } from "./quality";

const POOL_PER_KIND = 6;
const SHOT_POOL = 14;
const ARROW_POOL = 14;

export type HudState = { kills: number; coins: number; total: number; wave: number; shield: boolean; over: boolean; won: boolean };

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
  input.shieldHeld = c.shieldHeld || c.keys.has("KeyE") || c.keys.has("Space") || c.keys.has("ShiftLeft") || c.keys.has("KeyK");
  if (c.shieldAim) {
    input.shieldDirX = c.shieldAim.x;
    input.shieldDirZ = c.shieldAim.y;
  }
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
  const chars = useLoader(GLTFLoader, CHARACTER_URLS, configureLoader) as GLTF[];
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
  // Reused every frame so the loop does not allocate (less garbage collection stutter on phones).
  const byId = useMemo(() => new Map<number, EnemyView>(), [world]);
  const alive = useMemo(() => new Set<number>(), [world]);
  const used = useMemo(() => ({ arrow: 0, axe: 0, blade: 0, rock: 0 }) as Record<ShotKind, number>, [world]);

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
    byId.clear();
    for (const v of world.enemies) if (v.id >= 0) byId.set(v.id, v);
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
        let e: (typeof battle.enemies)[number] | undefined;
        for (const x of battle.enemies) if (x.id === ev.id) { e = x; break; }
        let view: EnemyView | undefined;
        if (e) for (const v of world.enemies) if (v.kind === e.kind && v.id < 0) { view = v; break; }
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
    alive.clear();
    for (const e of battle.enemies) alive.add(e.id);
    for (const v of world.enemies) if (v.id >= 0 && !alive.has(v.id)) v.hide();
    for (const e of battle.enemies) byId.get(e.id)?.update(e, h.x, h.z, camera, dt);
    for (let i = 0; i < world.arrows.length; i++) {
      const view = world.arrows[i]!;
      const a = battle.arrows[i];
      if (!a) view.root.visible = false;
      else view.place(a.x, a.z, a.dx, a.dz, a.traveled, dt);
    }
    used.arrow = used.axe = used.blade = used.rock = 0;
    for (const s of battle.shots) world.shots[s.kind][used[s.kind]++]?.place(s.x, s.z, s.dx, s.dz, s.traveled, dt);
    for (const k in world.shots) {
      const list = world.shots[k as ShotKind];
      for (let i = used[k as ShotKind]; i < list.length; i++) list[i]!.root.visible = false;
    }
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
      const hud: HudState = {
        kills: battle.kills,
        coins: battle.coins,
        total: battle.enemyTotal,
        wave: battle.wave,
        shield: h.mode === "shield",
        over: battle.over,
        won: battle.won,
      };
      const key = `${hud.kills}|${hud.coins}|${hud.total}|${hud.wave}|${hud.shield}|${hud.over}|${hud.won}`;
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
      shadow-mapSize={[QUALITY.shadowMap, QUALITY.shadowMap]}
      shadow-camera-left={-32}
      shadow-camera-right={32}
      shadow-camera-top={32}
      shadow-camera-bottom={-32}
      shadow-camera-near={1}
      shadow-camera-far={80}
      shadow-bias={-0.0006}
      shadow-normalBias={0.03}
    />
  );
}

/** Kills (out of this match's total) top-left, coins top-right, and a short "Wave N" banner. No health bar: one hit kills. */
function Hud({ hud }: { hud: HudState }) {
  return (
    <>
      <div className="battle-hud">
        <span className="battle-kills" aria-label="Enemies killed out of this match's total">
          <Skull className="h-4 w-4" />
          {hud.kills}/{hud.total}
        </span>
        <span className="battle-coins" aria-label="Coins earned this round">
          <span className="coin-dot" />
          <span className="text-gold-gradient">{hud.coins.toLocaleString()}</span>
        </span>
      </div>
      {hud.wave > 0 && !hud.over && (
        <p key={hud.wave} className="battle-wave-banner" aria-live="polite">
          Wave {hud.wave}
        </p>
      )}
    </>
  );
}

export type SaveState = "saving" | "saved" | "offline" | "error";

/** Round over: Victory or Defeated, kills and coins side by side, and only a Home button. */
function GameOver({ hud, save, error }: { hud: HudState; save: SaveState; error: string }) {
  const note =
    save === "saving"
      ? "Adding coins to your profile…"
      : save === "saved"
        ? hud.coins > 0
          ? "Coins added to your profile"
          : "No coins this time"
        : save === "offline"
          ? "Open the game in Telegram to save your coins"
          : `Coins could not be saved: ${error}`;
  return (
    <div className="battle-over" role="dialog" aria-label="Round over">
      <div className="battle-over-card" data-result={hud.won ? "victory" : "defeat"}>
        <p className="battle-over-title">{hud.won ? "Victory!" : "Defeated!"}</p>
        <p className="battle-over-sub">{hud.won ? `All ${hud.total} enemies killed` : `${hud.kills} of ${hud.total} enemies killed`}</p>
        <div className="battle-over-stats">
          <div className="battle-over-stat">
            <Skull className="battle-over-stat-icon" />
            <span className="battle-over-stat-value">{hud.kills}</span>
            <span className="battle-over-stat-label">Kills</span>
          </div>
          <div className="battle-over-stat">
            <span className="coin-dot battle-over-stat-icon" />
            <span className="battle-over-stat-value text-gold-gradient">+{hud.coins.toLocaleString()}</span>
            <span className="battle-over-stat-label">Coins</span>
          </div>
        </div>
        <p className="battle-over-note" data-state={save}>
          {note}
        </p>
        <Link to="/" className="battle-over-button battle-over-primary">
          <Home className="h-5 w-5" /> Home
        </Link>
      </div>
    </div>
  );
}

type MatchSession = { seed: number; enemyTotal: number; gameId: string | null };

function Match({ session }: { session: MatchSession }) {
  const { seed, enemyTotal, gameId } = session;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const battle = useMemo(() => createBattle(seed, enemyTotal), [seed, enemyTotal]);
  const controls = useMemo(() => createControls(), []);
  const [hud, setHud] = useState<HudState>({ kills: 0, coins: 0, total: battle.enemyTotal, wave: 0, shield: false, over: false, won: false });
  const [overShown, setOverShown] = useState(false);
  const [save, setSave] = useState<SaveState>(gameId ? "saving" : "offline");
  const [saveError, setSaveError] = useState("");
  const finished = useRef(false);
  const markReady = useMemo(() => () => wrapperRef.current?.setAttribute("data-scene-ready", "true"), []);

  // Round over → send the result to the game server; it adds the coins to the profile.
  useEffect(() => {
    if (!hud.over || finished.current) return;
    finished.current = true;
    const t = setTimeout(() => setOverShown(true), 1600);
    if (!gameId) return () => clearTimeout(t);
    const before = qc.getQueryData<Player>(["me"])?.coins;
    finishGame({ ...auth(), gameId, score: battle.coins, kills: battle.kills })
      .then((p) => {
        const from = before ?? p.coins - p.reward;
        if (p.reward > 0) qc.setQueryData<CoinGain>(COIN_GAIN_KEY, { from, to: p.coins, gained: p.reward });
        qc.setQueryData(["me"], p);
        setSave("saved");
      })
      .catch((e: unknown) => {
        setSaveError(e instanceof Error ? e.message : "Please try again");
        setSave("error");
      });
    return () => clearTimeout(t);
  }, [hud.over, gameId, battle, qc]);

  // Leaving in the middle of a round closes it on the server without coins.
  useEffect(
    () => () => {
      if (gameId && !finished.current) void cancelGame({ ...auth(), gameId }).catch(() => undefined);
    },
    [gameId],
  );

  return (
    <div ref={wrapperRef} className="battle-world" aria-label="Battle Arena map">
      <Canvas
        shadows={QUALITY.low ? "basic" : "percentage"}
        dpr={QUALITY.dpr}
        camera={{ fov: 42, near: 0.5, far: 220, position: [0, 30, 30] }}
        gl={{ antialias: QUALITY.antialias, powerPreference: "high-performance", stencil: false }}
      >
        <hemisphereLight args={["#d8efff", "#4d6b2a", 1.1]} />
        <ambientLight intensity={0.25} />
        <PointerAim controls={controls} />
        {/* One boundary: the ground, props and characters appear together in the same frame.
            The home page preloads every model, so this resolves at once after tapping Play. */}
        <Suspense fallback={null}>
          <color attach="background" args={["#4f7a35"]} />
          <fog attach="fog" args={["#9cc6a0", 45, 95]} />
          <BattleGround seed={seed} />
          <BattleWorld props={battle.props} seed={seed} />
          <GameLoop battle={battle} controls={controls} onHud={setHud} onReady={markReady} />
        </Suspense>
      </Canvas>
      <Hud hud={hud} />
      {!hud.over && <BattleControls controls={controls} shieldOn={hud.shield} />}
      {overShown && <GameOver hud={hud} save={save} error={saveError} />}
    </div>
  );
}

const newSeed = () => (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
const START_TIMEOUT_MS = 8000;

/**
 * Battle Arena: every Play asks the game server for a new match (its random 9–12 enemy total),
 * then lays out a fresh random map. Without the server (outside Telegram) the round still plays
 * with a local 9–12 total, but no coins are saved.
 */
export function BattleGame() {
  const [session, setSession] = useState<MatchSession | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const seed = newSeed();
    const offline = () => ({ seed, enemyTotal: randomEnemyTotal(), gameId: null });
    const a = auth();
    if (!a.initData) {
      setSession(offline());
      return;
    }
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), START_TIMEOUT_MS));
    Promise.race([startGame(a), timeout])
      .then((r) => setSession({ seed, enemyTotal: r.enemyTotal, gameId: r.gameId }))
      .catch(() => setSession(offline()));
  }, []);
  if (!session) {
    return (
      <div className="battle-world battle-loading" aria-label="Getting the match ready">
        <p className="battle-loading-text">Getting ready…</p>
      </div>
    );
  }
  return <Match session={session} />;
}
