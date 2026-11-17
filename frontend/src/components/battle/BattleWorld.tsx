import { useLoader } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MAP_HALF, type Prop } from "@/lib/battle-rules";
import { MODEL, PROP_FILES, configureLoader, type PropFile } from "./models";

/** Kenney kit models are tiny; this brings them to metres. */
const K = 3.2;

type Part = { geometry: THREE.BufferGeometry; material: THREE.Material };
type Placement = { file: PropFile | "hay" | "bale"; m: THREE.Matrix4 };

/** Bake a model into model-space parts, centred on x/z with its base on y = 0. */
function normalizedParts(gltf: GLTF): Part[] {
  const parts: Part[] = [];
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const c = box.getCenter(new THREE.Vector3());
  const shift = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(shift, mesh.matrixWorld));
    parts.push({ geometry: g, material: mesh.material as THREE.Material });
  });
  return parts;
}

function usePropModels() {
  const gltfs = useLoader(GLTFLoader, PROP_FILES.map(MODEL), configureLoader) as GLTF[];
  return useMemo(() => {
    const map = {} as Record<PropFile, Part[]>;
    PROP_FILES.forEach((f, i) => (map[f] = normalizedParts(gltfs[i]!)));
    return map;
  }, [gltfs]);
}

// ---------- Procedural textures ----------
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function grassTexture() {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#6fae3f";
  g.fillRect(0, 0, size, size);
  const r = seeded(7);
  const greens = ["#7dbb46", "#5f9e36", "#86c24d", "#68a83b", "#558f31", "#91c957"];
  for (let i = 0; i < 260; i++) {
    g.fillStyle = greens[i % greens.length]!;
    g.globalAlpha = 0.25 + r() * 0.35;
    const x = r() * size;
    const y = r() * size;
    const rad = 10 + r() * 46;
    const ry = rad * (0.5 + r() * 0.6);
    const rot = r() * 3;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]] as const) {
      g.beginPath();
      g.ellipse(x + ox, y + oy, rad, ry, rot, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 0.55;
  for (let i = 0; i < 4200; i++) {
    g.strokeStyle = r() < 0.5 ? "#9fd463" : "#4b8a2c";
    g.lineWidth = 1;
    const x = r() * size;
    const y = r() * size;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Dirt roads and worn patches across the battlefield, drawn once per match. */
function pathTexture(seed: number) {
  const size = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = seeded(seed);
  const toPx = (v: number) => ((v + MAP_HALF + 6) / (2 * (MAP_HALF + 6))) * size;
  g.lineCap = "round";
  g.lineJoin = "round";
  const road = (pts: [number, number][], w: number) => {
    for (const [col, width, alpha] of [["#8a6a3d", w * 1.25, 0.35], ["#a88452", w, 0.85], ["#bf9a63", w * 0.55, 0.5]] as const) {
      g.strokeStyle = col;
      g.globalAlpha = alpha;
      g.lineWidth = width;
      g.beginPath();
      pts.forEach(([x, z], i) => (i ? g.lineTo(toPx(x), toPx(z)) : g.moveTo(toPx(x), toPx(z))));
      g.stroke();
    }
  };
  const wobble = (a: [number, number], b: [number, number]) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const j = i === 0 || i === 10 ? 0 : (r() - 0.5) * 5;
      pts.push([a[0] + (b[0] - a[0]) * t + j, a[1] + (b[1] - a[1]) * t + j * 0.6]);
    }
    return pts;
  };
  road(wobble([-MAP_HALF - 4, 2], [MAP_HALF + 4, -3]), 34);
  road(wobble([-4, MAP_HALF + 4], [3, -MAP_HALF - 4]), 30);
  road(wobble([-MAP_HALF, -MAP_HALF + 4], [0, 0]), 22);
  road(wobble([MAP_HALF, MAP_HALF - 6], [2, 0]), 22);
  // Central clearing and worn patches.
  for (let i = 0; i < 26; i++) {
    const x = i === 0 ? 0 : (r() - 0.5) * 2 * MAP_HALF;
    const z = i === 0 ? 0 : (r() - 0.5) * 2 * MAP_HALF;
    const rad = i === 0 ? 120 : 14 + r() * 40;
    const grad = g.createRadialGradient(toPx(x), toPx(z), 0, toPx(x), toPx(z), rad);
    grad.addColorStop(0, "rgba(176,140,88,0.85)");
    grad.addColorStop(0.6, "rgba(160,124,74,0.45)");
    grad.addColorStop(1, "rgba(160,124,74,0)");
    g.globalAlpha = 1;
    g.fillStyle = grad;
    g.beginPath();
    g.arc(toPx(x), toPx(z), rad, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 1600; i++) {
    g.globalAlpha = 0.35;
    g.fillStyle = r() < 0.5 ? "#7a5d36" : "#d2b17a";
    g.fillRect(r() * size, r() * size, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function strawTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d9b24f";
  g.fillRect(0, 0, 256, 256);
  const r = seeded(11);
  for (let i = 0; i < 1400; i++) {
    g.strokeStyle = ["#f0cf6a", "#b98d34", "#e6c25c", "#a67a2a"][i % 4]!;
    g.globalAlpha = 0.6;
    g.lineWidth = 1 + r() * 1.5;
    const x = r() * 256;
    const y = r() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 10, y + 8 + r() * 16);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Haystack and hay bale meshes (no CC0 model fits, so they are built here). */
function hayParts(): Record<"hay" | "bale", Part[]> {
  const straw = strawTexture();
  const mat = new THREE.MeshStandardMaterial({ map: straw, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ map: straw, roughness: 1, color: "#d9b46a" });
  const body = new THREE.CylinderGeometry(1.05, 1.25, 1.3, 14, 2);
  body.translate(0, 0.65, 0);
  const top = new THREE.ConeGeometry(1.15, 1.1, 14, 2);
  top.translate(0, 1.85, 0);
  const bale = new THREE.BoxGeometry(1.3, 0.65, 0.8, 2, 1, 1);
  bale.translate(0, 0.325, 0);
  const twine = new THREE.BoxGeometry(0.06, 0.67, 0.82);
  twine.translate(0, 0.325, 0);
  const twine2 = twine.clone();
  twine.translate(-0.35, 0, 0);
  twine2.translate(0.35, 0, 0);
  const twineMat = new THREE.MeshStandardMaterial({ color: "#7a4b22", roughness: 1 });
  return {
    hay: [
      { geometry: body, material: mat },
      { geometry: top, material: dark },
    ],
    bale: [
      { geometry: bale, material: mat },
      { geometry: twine, material: twineMat },
      { geometry: twine2, material: twineMat },
    ],
  };
}

// ---------- Placement ----------
function mtx(x: number, y: number, z: number, yaw: number, s: number, tiltX = 0, tiltZ = 0) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ, "YXZ"));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
}

/** Prop-local offset rotated by the prop's yaw. */
function off(p: Prop, lx: number, lz: number): [number, number] {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
}

function placeProp(p: Prop, out: Placement[]) {
  const add = (file: Placement["file"], lx: number, lz: number, y: number, yaw: number, s: number, tx = 0, tz = 0) => {
    const [x, z] = off(p, lx, lz);
    out.push({ file, m: mtx(x, y, z, p.yaw + yaw, s, tx, tz) });
  };
  switch (p.kind) {
    case "haystack":
      add("hay", 0, 0, 0, 0, 1);
      if (p.variant > 0) add("bale", 1.4, 0.6, 0, 0.6, 0.9);
      break;
    case "hayBales":
      add("bale", -0.7, 0, 0, 0.1, 1);
      add("bale", 0.7, 0.1, 0, -0.1, 1);
      add("bale", 0, 0.05, 0.65, 0.3, 1);
      if (p.variant === 2) add("bale", 0.2, 1.1, 0, 1.4, 0.95);
      break;
    case "brokenCart":
      add("cart", 0, 0, -0.12, 0, K, 0, 0.38);
      add("wheel", 1.6, 0.5, 0.05, 0.4, K * 0.95, 0, Math.PI / 2);
      add("planks", -1.3, 0.9, 0.02, 0.8, K * 0.7);
      if (p.variant) add("bale", -1.4, -0.8, 0, 0.6, 0.8);
      break;
    case "cart":
      add("cart-high", 0, 0, 0, 0, K);
      add("barrel", 1.4, 0.4, 0, 0, K);
      break;
    case "barrels":
      add("barrel", 0, 0, 0, 0, K);
      add("barrel-open", 0.85, 0.2, 0, 1, K);
      if (p.variant) add("barrel", 0.3, -0.8, 0, 2, K);
      break;
    case "crates":
      add("box", 0, 0, 0, 0, K);
      add("box", 0.95, 0.1, 0, 0.2, K);
      add("box", 0.45, 0, 0.8, -0.2, K * 0.95);
      break;
    case "rock":
      add((["rock-a", "rock-b", "rock-c"] as const)[p.variant % 3]!, 0, 0, 0, 0, K * 1.4);
      break;
    case "bigRock":
      add("rock-large", 0, 0, 0, 0, K * 0.75);
      add("rock-a", 1.6, 0.8, 0, 1, K * 0.7);
      break;
    case "logs":
      add("tree-log", 0, 0, 0, Math.PI / 2, K * 1.2);
      add("tree-log", 0.1, 0.6, 0, Math.PI / 2 + 0.2, K * 1.1);
      add("resource-wood", -1, -0.6, 0, 0.5, K * 1.4);
      break;
    case "tent":
      add("tent", 0, 0, 0, 0, K * 1.5);
      break;
    case "campfire":
      add("campfire", 0, 0, 0, 0, K * 1.6);
      add("tree-log", 1.1, 0, 0, 0.3, K * 0.7);
      break;
    case "brokenFence":
      add("fence-broken", 0, -0.5, 0, Math.PI / 2, K * 1.1);
      add("fence-broken", 0.2, 0.9, 0, Math.PI / 2 + 0.4, K * 1.1, 0, 0.25);
      break;
    case "stall":
      add("stall", 0, 0, 0, 0, K * 0.95);
      break;
    case "brokenWall":
      add("wall-broken", 0, 0, 0, 0, K * 0.9);
      add("rock-c", 1, 0.6, 0, 0.5, K * 0.6);
      break;
    case "deadTree":
      add("tree-trunk", 0, 0, 0, 0, K * 1.6);
      add("tree-log", 0.9, 0.4, 0, 0.9, K * 0.8);
      break;
  }
}

/** The palisade around the map, the forest outside it and grass tufts inside. */
function placeBorder(seed: number, out: Placement[]) {
  const r = seeded(seed ^ 0xabc);
  const edge = MAP_HALF + 0.9;
  const seg = 0.5 * K;
  for (let v = -edge; v <= edge + 0.01; v += seg) {
    out.push({ file: "fence-fortified", m: mtx(v, 0, -edge, 0, K) });
    out.push({ file: "fence-fortified", m: mtx(v, 0, edge, Math.PI, K) });
    out.push({ file: "fence-fortified", m: mtx(-edge, 0, v, Math.PI / 2, K) });
    out.push({ file: "fence-fortified", m: mtx(edge, 0, v, -Math.PI / 2, K) });
  }
  const trees: PropFile[] = ["tree", "tree-tall", "tree-autumn", "tree-high-round", "tree-crooked", "tree"];
  const outer = MAP_HALF + 16;
  for (let x = -outer; x <= outer; x += 3.1) {
    for (let z = -outer; z <= outer; z += 3.1) {
      const jx = x + (r() - 0.5) * 2.4;
      const jz = z + (r() - 0.5) * 2.4;
      if (Math.max(Math.abs(jx), Math.abs(jz)) < MAP_HALF + 2.2) continue;
      const f = trees[Math.floor(r() * trees.length)]!;
      const s = f === "tree-high-round" || f === "tree-crooked" ? K * (0.75 + r() * 0.3) : K * (1.2 + r() * 0.5);
      out.push({ file: f, m: mtx(jx, 0, jz, r() * 6.3, s) });
      if (r() < 0.12) out.push({ file: "rock-b", m: mtx(jx + 1.2, 0, jz + 0.8, r() * 6, K * (1 + r())) });
    }
  }
  // Bushes along the inside of the wall for depth.
  for (let i = 0; i < 30; i++) {
    const side = Math.floor(r() * 4);
    const along = (r() - 0.5) * 2 * (MAP_HALF - 2);
    const inset = MAP_HALF - 0.4 - r() * 0.8;
    const [x, z] = side === 0 ? [along, -inset] : side === 1 ? [along, inset] : side === 2 ? [-inset, along] : [inset, along];
    out.push({ file: r() < 0.5 ? "hedge" : "grass", m: mtx(x, 0, z, (side < 2 ? Math.PI / 2 : 0) + (r() - 0.5) * 0.3, K * 1.2) });
  }
  for (let i = 0; i < 90; i++) {
    const x = (r() - 0.5) * 2 * (MAP_HALF - 1);
    const z = (r() - 0.5) * 2 * (MAP_HALF - 1);
    out.push({ file: "grass", m: mtx(x, 0, z, r() * 6.3, K * (0.4 + r() * 0.35)) });
  }
}

function Instanced({ parts, matrices }: { parts: Part[]; matrices: THREE.Matrix4[] }) {
  const meshes = useMemo(
    () =>
      parts.map((p) => {
        const m = new THREE.InstancedMesh(p.geometry, p.material, matrices.length);
        matrices.forEach((mat, i) => m.setMatrixAt(i, mat));
        m.instanceMatrix.needsUpdate = true;
        m.castShadow = true;
        m.receiveShadow = true;
        m.computeBoundingSphere();
        return m;
      }),
    [parts, matrices],
  );
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  );
}

/** Every prop, the wall and the forest, drawn as one instanced batch per model. */
export function BattleWorld({ props, seed }: { props: Prop[]; seed: number }) {
  const models = usePropModels();
  const hay = useMemo(() => hayParts(), []);
  const groups = useMemo(() => {
    const placements: Placement[] = [];
    for (const p of props) placeProp(p, placements);
    placeBorder(seed, placements);
    const byFile = new Map<Placement["file"], THREE.Matrix4[]>();
    for (const pl of placements) {
      const list = byFile.get(pl.file) ?? [];
      list.push(pl.m);
      byFile.set(pl.file, list);
    }
    return [...byFile.entries()].map(([file, matrices]) => ({
      file,
      matrices,
      parts: file === "hay" || file === "bale" ? hay[file] : models[file],
    }));
  }, [props, seed, models, hay]);

  return (
    <>
      {groups.map((g) => (
        <Instanced key={g.file} parts={g.parts} matrices={g.matrices} />
      ))}
    </>
  );
}

/** Grass everywhere, with dirt roads and the central clearing painted on top. Renders before models load. */
export function BattleGround({ seed }: { seed: number }) {
  const { grass, paths } = useMemo(() => {
    const grass = grassTexture();
    grass.repeat.set(26, 26);
    return { grass, paths: pathTexture(seed) };
  }, [seed]);
  const pathSize = 2 * (MAP_HALF + 6);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[(MAP_HALF + 30) * 2, (MAP_HALF + 30) * 2]} />
        <meshStandardMaterial map={grass} roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} receiveShadow>
        <planeGeometry args={[pathSize, pathSize]} />
        <meshStandardMaterial map={paths} transparent roughness={1} depthWrite={false} />
      </mesh>
    </group>
  );
}
