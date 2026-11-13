import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import arenaWorldUrl from "@/assets/arena-world.jpg";
import {
  BACK_WALL_DEPTH,
  CAMERA_BACK,
  CAMERA_FOV,
  CAMERA_FOLLOW_RATE,
  CAMERA_HEIGHT,
  CAMERA_LOOK_AHEAD,
  CAMERA_LOOK_HEIGHT,
  CAMERA_SIDE,
  EYE_HEIGHT,
  LEFT_WALL_X,
  PICTURE_BOTTOM,
  PICTURE_LEFT,
  PICTURE_RIGHT,
  PICTURE_TOP,
  RIGHT_WALL_X,
} from "@/lib/arena-world";
import {
  HERO_SPAWN,
  SPAWN_YAW,
  aimRay,
  coverObstacle,
  facing,
  fireBullet,
  generateObstacles,
  muzzlePosition,
  stepBullet,
  stepHero,
  type Bullet,
  type HeroState,
  type Obstacle,
} from "@/lib/arena-hero";
import { createHeroModel } from "@/components/arena/heroModel";
import { ArenaObstacles } from "@/components/arena/ArenaObstacles";
import { ArenaControls, createArenaInput, mergedStick, type ArenaInput } from "@/components/arena/ArenaControls";

const NEAR = 0.1;
const FAR = 400;
/** Surfaces start a little in front of the picture's camera so none crosses its plane. */
const NEAREST_GROUND = 1;
const MAX_BULLETS = 10;
const MAX_SPARKS = 8;
const SPARK_LIFE = 0.28;

const vertexShader = /* glsl */ `
  varying vec4 vProjected;
  uniform mat4 uProjector;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vProjected = uProjector * world;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec4 vProjected;
  uniform sampler2D uMap;
  void main() {
    vec2 uv = vProjected.xy / vProjected.w * 0.5 + 0.5;
    gl_FragColor = texture2D(uMap, uv);
  }
`;

function projectorMatrix() {
  const projection = new THREE.Matrix4().makePerspective(
    PICTURE_LEFT * NEAR,
    PICTURE_RIGHT * NEAR,
    PICTURE_TOP * NEAR,
    PICTURE_BOTTOM * NEAR,
    NEAR,
    FAR,
  );
  const view = new THREE.Matrix4().makeTranslation(0, -EYE_HEIGHT, 0);
  return projection.multiply(view);
}

/** The arena picture projected onto road, left fence and the base at the back. */
function WorldSurfaces({ onReady }: { onReady: () => void }) {
  const texture = useLoader(THREE.TextureLoader, arenaWorldUrl);
  const material = useMemo(() => {
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.MirroredRepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uProjector: { value: projectorMatrix() } },
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
    });
  }, [texture]);

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(onReady));
    return () => cancelAnimationFrame(id);
  }, [onReady]);

  const groundWidth = RIGHT_WALL_X - LEFT_WALL_X;
  return (
    <group>
      {/* Road and pavements */}
      <mesh material={material} rotation-x={-Math.PI / 2} position={[(LEFT_WALL_X + RIGHT_WALL_X) / 2, 0, -(BACK_WALL_DEPTH + NEAREST_GROUND) / 2]}>
        <planeGeometry args={[groundWidth, BACK_WALL_DEPTH - NEAREST_GROUND]} />
      </mesh>
      {/* Left fence, tree and watchtower side */}
      <mesh material={material} rotation-y={Math.PI / 2} position={[LEFT_WALL_X, 75, -(BACK_WALL_DEPTH + NEAREST_GROUND) / 2]}>
        <planeGeometry args={[BACK_WALL_DEPTH - NEAREST_GROUND, 150]} />
      </mesh>
      {/* The base, skyline and sky at the back */}
      <mesh material={material} position={[0, 75, -BACK_WALL_DEPTH]}>
        <planeGeometry args={[400, 150]} />
      </mesh>
      {/* Real-time shadows of the hero and cover pieces on the road */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, -24]} receiveShadow>
        <planeGeometry args={[40, 44]} />
        <shadowMaterial transparent opacity={0.28} color="#1c1450" />
      </mesh>
    </group>
  );
}

type Spark = { x: number; y: number; z: number; age: number };
type Game = {
  hero: HeroState;
  obstacles: Obstacle[];
  bullets: Bullet[];
  sparks: Spark[];
  input: ArenaInput;
};

function glowMaterial(color: string, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
}

/** One stepper: input → hero rules → bullets → hero animation → laser → camera, in that order. */
function GameLoop({ game }: { game: Game }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const hero = useMemo(() => createHeroModel(), []);
  const camTarget = useRef(new THREE.Vector3());
  const lookTarget = useRef(new THREE.Vector3());
  const placed = useRef(false);

  const laser = useMemo(() => {
    const g = new THREE.Group();
    const beamGeo = new THREE.BoxGeometry(1, 1, 1);
    beamGeo.translate(0, 0, 0.5);
    const core = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: "#ff1f2d", transparent: true, opacity: 0.9, toneMapped: false }));
    core.scale.set(0.026, 0.026, 1);
    const halo = new THREE.Mesh(beamGeo, glowMaterial("#ff2a4a", 0.35));
    halo.scale.set(0.07, 0.07, 1);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), glowMaterial("#ff6464"));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.25, 32), glowMaterial("#ff4040", 0.9));
    const cross = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.14), glowMaterial("#ff4040", 0.9));
      tick.position.set(Math.sin((i * Math.PI) / 2) * 0.32, Math.cos((i * Math.PI) / 2) * 0.32, 0);
      tick.rotation.z = (-i * Math.PI) / 2;
      cross.add(tick);
    }
    g.add(core, halo, dot, ring, cross);
    g.visible = false;
    return { g, core, halo, dot, ring, cross };
  }, []);

  const bulletMeshes = useMemo(
    () =>
      Array.from({ length: MAX_BULLETS }, () => {
        const g = new THREE.Group();
        const core = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.5, 4, 8), glowMaterial("#fff6b0"));
        core.rotation.x = Math.PI / 2;
        const trail = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 1.4, 4, 8), glowMaterial("#ffb02e", 0.45));
        trail.rotation.x = Math.PI / 2;
        trail.position.z = -0.6;
        g.add(core, trail);
        g.visible = false;
        return g;
      }),
    [],
  );

  const sparkMeshes = useMemo(
    () =>
      Array.from({ length: MAX_SPARKS }, () => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), glowMaterial("#ffd36b", 0.9));
        m.visible = false;
        return m;
      }),
    [],
  );

  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __arena?: Game }).__arena = game;
  }, [game]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const { input } = game;
    const aiming = input.shootHeld;
    const shielding = input.shieldHeld;

    // 1. Hero rules.
    stepHero(game.hero, { stick: mergedStick(input), aiming, shielding }, game.obstacles, dt);
    if (input.fireQueued) {
      input.fireQueued = false;
      if (game.bullets.length < MAX_BULLETS) game.bullets.push(fireBullet(game.hero, game.obstacles));
      hero.fire();
    }

    // 2. Bullets and their impact sparks.
    for (const b of game.bullets) {
      stepBullet(b, dt);
      if (b.done && b.hitsObstacle) {
        game.sparks.push({ x: b.x, y: b.y, z: b.z, age: 0 });
        if (game.sparks.length > MAX_SPARKS) game.sparks.shift();
      }
    }
    game.bullets = game.bullets.filter((b) => !b.done);
    for (const s of game.sparks) s.age += dt;
    game.sparks = game.sparks.filter((s) => s.age < SPARK_LIFE);

    // 3. Hero model.
    hero.root.position.set(game.hero.x, 0, game.hero.z);
    hero.root.rotation.y = game.hero.yaw;
    hero.update({ speed: game.hero.speed, aiming, shielding, inCover: !!coverObstacle(game.hero, game.obstacles) }, dt);

    bulletMeshes.forEach((mesh, i) => {
      const b = game.bullets[i];
      mesh.visible = !!b;
      if (!b) return;
      mesh.position.set(b.x, b.y, b.z);
      mesh.rotation.y = Math.atan2(b.dx, b.dz);
      const shown = Math.min(1, b.traveled / 1.2);
      mesh.scale.set(1, 1, shown);
    });
    sparkMeshes.forEach((mesh, i) => {
      const s = game.sparks[i];
      mesh.visible = !!s;
      if (!s) return;
      const t = s.age / SPARK_LIFE;
      mesh.position.set(s.x, s.y, s.z);
      mesh.scale.setScalar(0.4 + t * 2.2);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    });

    // 4. Aiming laser: from the gun, along the hero's facing, to the first obstacle.
    const showLaser = aiming && hero.aimAmount() > 0.7;
    laser.g.visible = showLaser;
    if (showLaser) {
      const m = muzzlePosition(game.hero);
      const f = facing(game.hero.yaw);
      const ray = aimRay({ x: m.x, z: m.z }, f, game.obstacles);
      laser.g.position.set(m.x, m.y, m.z);
      laser.g.rotation.set(0, game.hero.yaw, 0);
      const flicker = 0.85 + Math.random() * 0.15;
      laser.core.scale.z = ray.distance;
      laser.halo.scale.set(0.09 * flicker, 0.09 * flicker, ray.distance);
      laser.dot.position.z = ray.distance;
      laser.ring.position.z = ray.distance - 0.02;
      laser.cross.position.z = ray.distance - 0.02;
      const ringScale = Math.min(2.2, 0.6 + ray.distance * 0.06);
      laser.ring.scale.setScalar(ringScale);
      laser.cross.scale.setScalar(ringScale);
      laser.ring.rotation.z += dt * 2;
    }

    // 5. Camera follows the hero left/right and forward/back.
    camTarget.current.set(game.hero.x + CAMERA_SIDE, CAMERA_HEIGHT, game.hero.z + CAMERA_BACK);
    lookTarget.current.set(game.hero.x + CAMERA_SIDE, CAMERA_LOOK_HEIGHT, game.hero.z - CAMERA_LOOK_AHEAD);
    if (!placed.current) {
      camera.position.copy(camTarget.current);
      placed.current = true;
    } else {
      camera.position.lerp(camTarget.current, 1 - Math.exp(-CAMERA_FOLLOW_RATE * dt));
    }
    camera.lookAt(camera.position.x, lookTarget.current.y, lookTarget.current.z);
  });

  return (
    <>
      <primitive object={hero.root} />
      <primitive object={laser.g} />
      {bulletMeshes.map((m, i) => (
        <primitive key={`b${i}`} object={m} />
      ))}
      {sparkMeshes.map((m, i) => (
        <primitive key={`s${i}`} object={m} />
      ))}
    </>
  );
}

function Lights() {
  const sun = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    light.target.position.set(0, 0, -22);
    light.target.updateMatrixWorld();
    const cam = light.shadow.camera;
    cam.left = -22;
    cam.right = 22;
    cam.top = 26;
    cam.bottom = -26;
    cam.near = 1;
    cam.far = 80;
    cam.updateProjectionMatrix();
  }, []);
  return (
    <>
      <hemisphereLight args={["#d8ecff", "#7a6f9c", 1.35]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        ref={sun}
        position={[-14, 24, -6]}
        intensity={2.4}
        color="#fff1d6"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0008}
      />
      <directionalLight position={[6, 6, 10]} intensity={0.9} color="#9fd2ff" />
    </>
  );
}

export function ArenaWorld() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  // A fresh random cover layout every match.
  const [seed] = useState(() => (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
  const game = useMemo<Game>(
    () => ({
      hero: { x: HERO_SPAWN.x, z: HERO_SPAWN.z, yaw: SPAWN_YAW, speed: 0 },
      obstacles: generateObstacles(seed),
      bullets: [],
      sparks: [],
      input: createArenaInput(),
    }),
    [seed],
  );

  const markReady = useMemo(() => () => wrapperRef.current?.setAttribute("data-scene-ready", "true"), []);

  return (
    <div ref={wrapperRef} className="arena-world" aria-label="Battle Arena world">
      <Canvas
        flat
        shadows
        dpr={[1, 2]}
        camera={{ fov: CAMERA_FOV, near: NEAR, far: FAR, position: [HERO_SPAWN.x + CAMERA_SIDE, CAMERA_HEIGHT, HERO_SPAWN.z + CAMERA_BACK] }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#3f8fe8"]} />
        <Lights />
        <ArenaObstacles obstacles={game.obstacles} />
        <GameLoop game={game} />
        <Suspense fallback={null}>
          <WorldSurfaces onReady={markReady} />
        </Suspense>
      </Canvas>
      <ArenaControls input={game.input} />
    </div>
  );
}
