/**
 * Model loading, cloning and layered animation for Battle Arena characters.
 * Every GLB lives in public/models (CC0 — see public/models/CREDITS.md).
 */
import * as THREE from "three";
import type { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

export const MODEL = (name: string) => `${import.meta.env.BASE_URL}models/${name}.glb`;

export const CHARACTER_FILES = {
  hero: "hero",
  archer: "enemy-archer",
  axeman: "enemy-barbarian",
  warrior: "enemy-warrior",
  minion: "enemy-minion",
} as const;

export const PROP_FILES = [
  "barrel",
  "barrel-open",
  "box",
  "rock-a",
  "rock-b",
  "rock-c",
  "rock-large",
  "tree",
  "tree-tall",
  "tree-autumn",
  "tree-crooked",
  "tree-high-round",
  "tree-log",
  "tree-trunk",
  "tent",
  "campfire",
  "fence-fortified",
  "fence-broken",
  "grass",
  "cart",
  "cart-high",
  "wheel",
  "hedge",
  "wall-broken",
  "planks",
  "stall",
  "resource-wood",
] as const;
export type PropFile = (typeof PROP_FILES)[number];

export function configureLoader(loader: GLTFLoader) {
  loader.setMeshoptDecoder(MeshoptDecoder);
}

/** Clone a loaded model (skinned-mesh safe) and turn on shadows. */
export function cloneModel(gltf: GLTF) {
  const root = cloneSkinned(gltf.scene) as THREE.Group;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    }
  });
  return root;
}

export function findBone(root: THREE.Object3D, name: string) {
  let found: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (!found && o.name === name) found = o;
  });
  return found;
}

// ---------- Layered animation ----------
/** Bones driven by the legs layer; every other bone follows the upper-body layer. */
const LOWER_BONES = new Set(["root", "Rig", "hips", "upperlegl", "upperlegr", "lowerlegl", "lowerlegr", "footl", "footr", "toesl", "toesr"]);

function splitClip(clip: THREE.AnimationClip) {
  const lower: THREE.KeyframeTrack[] = [];
  const upper: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    const bone = t.name.slice(0, t.name.lastIndexOf("."));
    (LOWER_BONES.has(bone) ? lower : upper).push(t);
  }
  return {
    lower: new THREE.AnimationClip(`${clip.name}:lower`, clip.duration, lower),
    upper: new THREE.AnimationClip(`${clip.name}:upper`, clip.duration, upper),
  };
}

const splitCache = new WeakMap<THREE.AnimationClip, ReturnType<typeof splitClip>>();

type Layer = "lower" | "upper";

/**
 * Two animation layers: legs play the walk/run cycle while the upper body
 * aims the bow, raises the shield or throws. One-shots return to the base pose.
 */
export class Animator {
  mixer: THREE.AnimationMixer;
  private clips = new Map<string, THREE.AnimationClip>();
  private actions = new Map<string, THREE.AnimationAction>();
  private current: Record<Layer, THREE.AnimationAction | null> = { lower: null, upper: null };
  private base: Record<Layer, string> = { lower: "Idle", upper: "Idle" };
  private oneShot: THREE.AnimationAction | null = null;
  private full = false;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const c of clips) this.clips.set(c.name, c);
    this.mixer.addEventListener("finished", (e) => {
      if (e.action === this.oneShot) {
        this.oneShot = null;
        this.play("upper", this.base.upper, 0.18);
      }
    });
  }

  has(name: string) {
    return this.clips.has(name);
  }

  private action(layer: Layer, name: string) {
    const key = `${layer}:${name}`;
    let a = this.actions.get(key);
    if (!a) {
      const clip = this.clips.get(name);
      if (!clip) return null;
      let split = splitCache.get(clip);
      if (!split) {
        split = splitClip(clip);
        splitCache.set(clip, split);
      }
      a = this.mixer.clipAction(split[layer]);
      this.actions.set(key, a);
    }
    return a;
  }

  private play(layer: Layer, name: string, fade: number, once = false, timeScale = 1) {
    const next = this.action(layer, name);
    if (!next) return null;
    const prev = this.current[layer];
    if (prev === next && !once) {
      next.timeScale = timeScale;
      return next;
    }
    next.reset();
    next.timeScale = timeScale;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.fadeIn(fade).play();
    if (prev && prev !== next) prev.fadeOut(fade);
    this.current[layer] = next;
    return next;
  }

  /** Legs (and the upper body when nothing overrides it) play this loop. */
  setBase(lower: string, upper: string, timeScale = 1) {
    if (this.full) return;
    this.base.lower = lower;
    this.base.upper = upper;
    this.play("lower", lower, 0.2, false, timeScale);
    if (!this.oneShot) this.play("upper", upper, 0.2, false, upper === lower ? timeScale : 1);
  }

  /** Upper-body one-shot (shoot, throw, flinch); returns to the base loop afterwards. */
  upperOnce(name: string, timeScale = 1) {
    if (this.full) return;
    const a = this.play("upper", name, 0.08, true, timeScale);
    if (a) this.oneShot = a;
  }

  /** Whole-body one-shot that holds its last frame (death, spawn). */
  fullOnce(name: string, timeScale = 1) {
    this.full = true;
    this.oneShot = null;
    this.play("lower", name, 0.12, true, timeScale);
    this.play("upper", name, 0.12, true, timeScale);
  }

  /** Back to normal layered playback after a whole-body one-shot. */
  release() {
    this.full = false;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }
}
