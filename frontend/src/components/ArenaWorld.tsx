import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import arenaWorldUrl from "@/assets/arena-world.jpg";
import {
  BACK_WALL_DEPTH,
  EYE_HEIGHT,
  KEY_PAN_SPEED,
  LEFT_WALL_X,
  PICTURE_BOTTOM,
  PICTURE_LEFT,
  PICTURE_RIGHT,
  PICTURE_TOP,
  RIGHT_WALL_X,
  cameraSlide,
  clampPan,
  dragPanDelta,
  startPan,
  viewWindow,
  windowLeft,
} from "@/lib/arena-world";

const NEAR = 0.1;
const FAR = 400;
/** Surfaces start a little in front of the camera so none crosses the camera's own plane. */
const NEAREST_GROUND = 1;

/** Shared pan state written by input handlers and read every frame (kept outside React). */
type PanState = { pan: number; started: boolean; keys: { left: boolean; right: boolean } };

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
    </group>
  );
}

/** Slides the camera across the world each frame, never past the picture's ends. */
function CameraRig({ state }: { state: PanState }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const view = viewWindow(size.width / size.height);
    if (!state.started) {
      state.pan = startPan(view);
      state.started = true;
    }
    const direction = (state.keys.right ? 1 : 0) - (state.keys.left ? 1 : 0);
    if (direction) state.pan = clampPan(state.pan + direction * KEY_PAN_SPEED * dt);

    const left = windowLeft(view, state.pan);
    camera.position.set(cameraSlide(state.pan), EYE_HEIGHT, 0);
    camera.rotation.set(0, 0, 0);
    camera.updateMatrixWorld();
    camera.projectionMatrix.makePerspective(
      left * NEAR,
      (left + view.width) * NEAR,
      view.top * NEAR,
      view.bottom * NEAR,
      NEAR,
      FAR,
    );
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  });
  return null;
}

export function ArenaWorld() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const state = useRef<PanState>({ pan: 0.5, started: false, keys: { left: false, right: false } }).current;

  // Swipe/drag left-right to move across the world; arrows or A/D on a keyboard.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    let lastX: number | null = null;
    const onDown = (e: PointerEvent) => {
      lastX = e.clientX;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (lastX === null) return;
      const rect = el.getBoundingClientRect();
      const view = viewWindow(rect.width / Math.max(1, rect.height));
      state.pan = clampPan(state.pan + dragPanDelta(view, e.clientX - lastX, rect.width));
      lastX = e.clientX;
    };
    const onUp = () => {
      lastX = null;
    };
    const setKey = (e: KeyboardEvent, down: boolean) => {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") state.keys.left = down;
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") state.keys.right = down;
    };
    const onKeyDown = (e: KeyboardEvent) => setKey(e, true);
    const onKeyUp = (e: KeyboardEvent) => setKey(e, false);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [state]);

  const markReady = useMemo(
    () => () => wrapperRef.current?.setAttribute("data-scene-ready", "true"),
    [],
  );

  return (
    <div ref={wrapperRef} className="arena-world" aria-label="Battle Arena world">
      <Canvas flat dpr={[1, 2]} camera={{ manual: true, near: NEAR, far: FAR }} gl={{ antialias: true }}>
        <color attach="background" args={["#3f8fe8"]} />
        <CameraRig state={state} />
        <Suspense fallback={null}>
          <WorldSurfaces onReady={markReady} />
        </Suspense>
      </Canvas>
    </div>
  );
}
