/**
 * Imperative three.js views for the hero, enemies, projectiles and effects.
 * The rules (lib/battle-rules.ts) own every number; these only draw them.
 */
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  ARROW_HEIGHT,
  ARROW_RANGE,
  ENEMY_SPECS,
  HERO_MAX_HP,
  SHIELD_BLOCK_HALF_ANGLE,
  angleDiff,
  type Enemy,
  type EnemyKind,
  type Hero,
  type ShotKind,
} from "@/lib/battle-rules";
import { Animator, cloneModel, findBone } from "./models";

export const HERO_SCALE = 1;
const ENEMY_SCALE: Record<EnemyKind, number> = { archer: 0.95, axeman: 1.02, warrior: 1, minion: 0.92 };

function basic(color: string, opacity = 1, additive = false) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** A copy of a weapon model for one character or projectile. */
function weapon(gltf: GLTF) {
  const g = gltf.scene.clone(true);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.frustumCulled = false;
    }
  });
  return g;
}

/** Recurve bow built from tubes (no CC0 bow model matches the pack). Limbs along y, grip at the hand, belly toward +x. */
export function createBow() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: "#7a3f1c", roughness: 0.6, metalness: 0.1 });
  const gold = new THREE.MeshStandardMaterial({ color: "#f2c14e", roughness: 0.35, metalness: 0.7 });
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.26, -0.78, 0),
    new THREE.Vector3(-0.08, -0.6, 0),
    new THREE.Vector3(0.12, -0.25, 0),
    new THREE.Vector3(0.14, 0, 0),
    new THREE.Vector3(0.12, 0.25, 0),
    new THREE.Vector3(-0.08, 0.6, 0),
    new THREE.Vector3(-0.26, 0.78, 0),
  ]);
  const limb = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.035, 8), wood);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 10), gold);
  grip.position.set(0.14, 0, 0);
  const tipA = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), gold);
  tipA.position.set(-0.26, 0.78, 0);
  const tipB = tipA.clone();
  tipB.position.y = -0.78;
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1.56, 4), new THREE.MeshBasicMaterial({ color: "#f5f0e0" }));
  string.position.set(-0.26, 0, 0);
  g.add(limb, grip, tipA, tipB, string);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

function ring(color: string, inner: number, outer: number, opacity: number) {
  const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 40), basic(color, opacity));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.04;
  m.renderOrder = 2;
  return m;
}

/** Billboard health bar (faces the camera every frame). */
export class HealthBar {
  group = new THREE.Group();
  private fill: THREE.Mesh;
  constructor(color: string, width = 1.1) {
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.08, 0.2), basic("#1b1222", 0.85));
    const fg = new THREE.PlaneGeometry(width, 0.13);
    fg.translate(width / 2, 0, 0);
    this.fill = new THREE.Mesh(fg, basic(color));
    this.fill.position.set(-width / 2, 0, 0.001);
    bg.renderOrder = 10;
    this.fill.renderOrder = 11;
    this.group.add(bg, this.fill);
  }
  set(fraction: number, camera: THREE.Camera) {
    this.fill.scale.x = Math.max(0.001, Math.min(1, fraction));
    this.group.quaternion.copy(camera.quaternion);
  }
}

// ---------- Hero ----------
export class HeroView {
  root = new THREE.Group();
  model: THREE.Group;
  anim: Animator;
  bow: THREE.Group;
  shield: THREE.Object3D;
  bar = new HealthBar("#3ee06a", 1.3);
  aimGuide = new THREE.Group();
  shieldGuide: THREE.Mesh;
  private dead = false;

  constructor(gltf: GLTF, shieldGltf: GLTF) {
    this.model = cloneModel(gltf);
    this.model.scale.setScalar(HERO_SCALE);
    this.root.add(this.model);
    this.anim = new Animator(this.model, gltf.animations);
    this.anim.setBase("Idle", "Idle");

    this.bow = createBow();
    findBone(this.model, "handslotr")?.add(this.bow);
    this.shield = weapon(shieldGltf);
    this.shield.position.set(0, 0.02, 0.16);
    this.shield.scale.setScalar(1.15);
    this.shield.visible = false;
    findBone(this.model, "handslotl")?.add(this.shield);

    // Team ring under the hero.
    this.root.add(ring("#3ee06a", 0.7, 0.84, 0.85));

    // Aim guide: a bright lane on the ground from the hero to the arrow's full range.
    const lineGeo = new THREE.PlaneGeometry(0.42, ARROW_RANGE - 1.4);
    lineGeo.translate(0, (ARROW_RANGE - 1.4) / 2 + 0.6, 0);
    lineGeo.rotateX(Math.PI / 2);
    const line = new THREE.Mesh(lineGeo, basic("#bff6ff", 0.38));
    const head = new THREE.Shape();
    head.moveTo(-0.6, 0);
    head.lineTo(0.6, 0);
    head.lineTo(0, 1.1);
    head.closePath();
    const headGeo = new THREE.ShapeGeometry(head);
    headGeo.rotateX(Math.PI / 2);
    const arrowHead = new THREE.Mesh(headGeo, basic("#e9fdff", 0.8));
    arrowHead.position.z = ARROW_RANGE - 0.9;
    line.renderOrder = arrowHead.renderOrder = 3;
    this.aimGuide.add(line, arrowHead);
    this.aimGuide.position.y = 0.05;
    this.aimGuide.visible = false;
    this.root.add(this.aimGuide);

    // Shield arc: the cone in front of the hero that blocks shots.
    const arcGeo = new THREE.RingGeometry(0.85, 1.25, 32, 1, -Math.PI / 2 - SHIELD_BLOCK_HALF_ANGLE, SHIELD_BLOCK_HALF_ANGLE * 2);
    arcGeo.rotateX(-Math.PI / 2);
    this.shieldGuide = new THREE.Mesh(arcGeo, basic("#5ed0ff", 0.55));
    this.shieldGuide.position.y = 0.05;
    this.shieldGuide.visible = false;
    this.shieldGuide.renderOrder = 3;
    this.root.add(this.shieldGuide);

    this.bar.group.position.y = 2.85;
    this.root.add(this.bar.group);
  }

  fire() {
    this.anim.upperOnce("1H_Ranged_Shoot", 2.2);
  }

  hit(blocked: boolean) {
    this.anim.upperOnce(blocked ? "Block_Hit" : "Hit_A", 1.6);
  }

  update(h: Hero, camera: THREE.Camera, dt: number) {
    this.root.position.set(h.x, 0, h.z);
    this.model.rotation.y = h.yaw;

    if (h.dead && !this.dead) {
      this.dead = true;
      this.anim.fullOnce("Death_A", 1);
    }
    if (!h.dead) {
      // Walk cycle relative to where the hero faces (strafe / backpedal while aiming).
      let legs = "Idle";
      let scale = 1;
      if (h.speed > 0.4) {
        const slow = h.aiming || h.mode === "shield";
        const rel = angleDiff(h.yaw, Math.atan2(h.vx, h.vz));
        if (!slow) {
          legs = "Running_A";
          scale = h.speed / 6;
        } else {
          if (Math.abs(rel) < Math.PI / 4) legs = "Walking_A";
          else if (Math.abs(rel) > (3 * Math.PI) / 4) legs = "Walking_Backwards";
          else legs = rel > 0 ? "Running_Strafe_Left" : "Running_Strafe_Right";
          scale = Math.max(0.7, h.speed / 3);
        }
      }
      const upper = h.mode === "shield" ? "Blocking" : h.aiming ? "1H_Ranged_Aiming" : legs;
      this.anim.setBase(legs, upper, Math.max(0.6, Math.min(1.4, scale)));
    }

    this.bow.visible = h.mode === "bow";
    this.shield.visible = h.mode === "shield";
    this.aimGuide.visible = h.aiming && !h.dead;
    this.aimGuide.rotation.y = Math.atan2(h.aimX - h.x, h.aimZ - h.z);
    this.shieldGuide.visible = h.mode === "shield" && !h.dead;
    this.shieldGuide.rotation.y = h.yaw;

    this.bar.set(h.hp / HERO_MAX_HP, camera);
    this.bar.group.visible = !h.dead;
    this.anim.update(dt);
  }
}

// ---------- Enemies ----------
const WEAPON_FOR: Partial<Record<EnemyKind, { file: string; pos: [number, number, number]; rotY: number }>> = {
  archer: { file: "crossbow", pos: [-0.1, -0.01, 0], rotY: Math.PI / 2 },
  axeman: { file: "axe", pos: [0, 0.033, 0], rotY: Math.PI },
  warrior: { file: "blade", pos: [0, 0.03, 0], rotY: Math.PI },
};

export class EnemyView {
  root = new THREE.Group();
  model: THREE.Group;
  anim: Animator;
  bar = new HealthBar("#ff4b4b");
  weapon: THREE.Object3D | null = null;
  telegraph: THREE.Mesh;
  ring: THREE.Mesh;
  id = -1;
  kind: EnemyKind;
  private state: Enemy["state"] | "" = "";
  private weaponHidden = 0;

  constructor(kind: EnemyKind, gltf: GLTF, weapons: Record<string, GLTF>) {
    this.kind = kind;
    this.model = cloneModel(gltf);
    this.model.scale.setScalar(ENEMY_SCALE[kind]);
    this.root.add(this.model);
    this.anim = new Animator(this.model, gltf.animations);
    const w = WEAPON_FOR[kind];
    const wg = w ? weapons[w.file] : undefined;
    if (w && wg) {
      this.weapon = weapon(wg);
      this.weapon.position.set(...w.pos);
      this.weapon.rotation.y = w.rotY;
      findBone(this.model, "handslotr")?.add(this.weapon);
    }
    this.ring = ring("#ff4b4b", 0.55, 0.66, 0.75);
    this.root.add(this.ring);
    // Red ground line that warns where the shot will fly (scaled to the distance).
    const tg = new THREE.PlaneGeometry(0.3, 1);
    tg.translate(0, 0.5, 0);
    tg.rotateX(Math.PI / 2);
    this.telegraph = new THREE.Mesh(tg, basic("#ff3030", 0.45));
    this.telegraph.position.y = 0.05;
    this.telegraph.visible = false;
    this.telegraph.renderOrder = 3;
    this.root.add(this.telegraph);
    this.bar.group.position.y = kind === "minion" ? 2.1 : 2.75;
    this.root.add(this.bar.group);
    this.root.visible = false;
  }

  bind(e: Enemy) {
    this.id = e.id;
    this.state = "";
    this.root.visible = true;
    this.anim.release();
  }

  attack() {
    this.anim.upperOnce(this.kind === "archer" ? "1H_Ranged_Shoot" : "Throw", this.kind === "archer" ? 1.1 : 1.3);
  }

  threw() {
    if (this.weapon && this.kind !== "archer") {
      this.weapon.visible = false;
      this.weaponHidden = 0.7;
    }
  }

  hit() {
    this.anim.upperOnce("Hit_A", 1.6);
  }

  update(e: Enemy, heroX: number, heroZ: number, camera: THREE.Camera, dt: number) {
    this.root.position.set(e.x, 0, e.z);
    this.model.rotation.y = e.yaw;
    if (e.state !== this.state) {
      if (e.state === "spawning") {
        this.anim.fullOnce(this.anim.has("Spawn_Ground") ? "Spawn_Ground" : "Idle", 1.4);
      } else if (e.state === "dead") {
        this.anim.fullOnce("Death_A", 1);
      } else if (this.state === "spawning" || this.state === "") {
        this.anim.release();
      }
      this.state = e.state;
    }
    if (e.state === "moving" || e.state === "windup" || e.state === "recover") {
      const fast = e.speed > ENEMY_SPECS[e.kind].speed * 0.75;
      const legs = e.speed > 0.3 ? (fast ? "Running_A" : "Walking_A") : "Idle";
      this.anim.setBase(legs, e.state === "windup" && this.kind === "archer" ? "1H_Ranged_Aiming" : legs);
    }
    this.telegraph.visible = e.state === "windup";
    if (this.telegraph.visible) {
      const dx = heroX - e.x;
      const dz = heroZ - e.z;
      this.telegraph.rotation.y = Math.atan2(dx, dz);
      this.telegraph.scale.z = Math.hypot(dx, dz);
    }
    this.weaponHidden -= dt;
    if (this.weapon && this.weaponHidden <= 0) this.weapon.visible = true;
    this.bar.set(e.hp / ENEMY_SPECS[e.kind].hp, camera);
    this.bar.group.visible = e.state !== "dead" && e.state !== "spawning";
    this.ring.visible = e.state !== "dead";
    this.anim.update(dt);
  }

  hide() {
    this.root.visible = false;
    this.id = -1;
  }
}

// ---------- Projectiles ----------
export class ProjectileView {
  root = new THREE.Group();
  spin = new THREE.Group();
  kind: ShotKind | "hero";
  constructor(kind: ShotKind | "hero", models: Record<string, GLTF>) {
    this.kind = kind;
    this.root.add(this.spin);
    const arrowModel = models["arrow"];
    const throwModel = models[kind === "axe" ? "axe" : "blade"];
    if ((kind === "hero" || kind === "arrow") && arrowModel) {
      const a = weapon(arrowModel);
      a.rotation.x = Math.PI / 2;
      a.scale.setScalar(kind === "hero" ? 1.9 : 1.6);
      this.spin.add(a);
      // Glowing streak behind the arrow.
      const trailGeo = new THREE.ConeGeometry(0.09, 1.6, 8, 1, true);
      trailGeo.rotateX(-Math.PI / 2);
      trailGeo.translate(0, 0, -0.9);
      this.root.add(new THREE.Mesh(trailGeo, basic(kind === "hero" ? "#8fe9ff" : "#ff7a5a", 0.55, true)));
    } else if ((kind === "axe" || kind === "blade") && throwModel) {
      const m = weapon(throwModel);
      m.position.y = -0.4;
      m.scale.setScalar(1.1);
      this.spin.add(m);
    } else {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({ color: "#8d8a82", roughness: 0.9, flatShading: true }));
      rock.castShadow = true;
      this.spin.add(rock);
    }
    this.root.visible = false;
  }

  place(x: number, z: number, dx: number, dz: number, traveled: number, dt: number) {
    this.root.visible = true;
    this.root.rotation.y = Math.atan2(dx, dz);
    let y = ARROW_HEIGHT;
    if (this.kind === "axe" || this.kind === "blade") this.spin.rotation.x += dt * 16;
    if (this.kind === "rock") {
      y = 0.9 + Math.sin(Math.min(1, traveled / 12) * Math.PI) * 1.6;
      this.spin.rotation.x += dt * 8;
      this.spin.rotation.z += dt * 5;
    }
    this.root.position.set(x, y, z);
  }
}

// ---------- Effects ----------
type Fx = { mesh: THREE.Object3D; age: number; life: number; kind: "spark" | "block" | "coin" | "blood" };

function coinSprite() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "bold 76px 'Lilita One', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 12;
  g.strokeStyle = "#5a2d00";
  g.strokeText("+10", 150, 66);
  g.fillStyle = "#ffd23a";
  g.fillText("+10", 150, 66);
  g.beginPath();
  g.arc(46, 64, 30, 0, Math.PI * 2);
  g.fillStyle = "#ffcc2e";
  g.fill();
  g.lineWidth = 6;
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  group = new THREE.Group();
  private pool: Fx[] = [];
  private coinTex: THREE.Texture | null = null;

  private take(kind: Fx["kind"]) {
    let fx = this.pool.find((f) => f.kind === kind && f.age >= f.life);
    if (!fx) {
      let mesh: THREE.Object3D;
      if (kind === "coin") {
        this.coinTex ??= coinSprite();
        mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.coinTex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
        mesh.scale.set(2, 1, 1);
        mesh.renderOrder = 20;
      } else if (kind === "block") {
        mesh = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.5, 24), basic("#7fe3ff", 1, true));
      } else {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), basic(kind === "blood" ? "#ff5a3c" : "#ffd36b", 1, true));
      }
      fx = { mesh, age: 0, life: 1, kind };
      this.pool.push(fx);
      this.group.add(mesh);
    }
    fx.age = 0;
    fx.mesh.visible = true;
    return fx;
  }

  spark(x: number, z: number, blood = false) {
    const fx = this.take(blood ? "blood" : "spark");
    fx.life = 0.3;
    fx.mesh.position.set(x, ARROW_HEIGHT, z);
  }
  block(x: number, z: number) {
    const fx = this.take("block");
    fx.life = 0.35;
    fx.mesh.position.set(x, ARROW_HEIGHT, z);
  }
  coin(x: number, z: number) {
    const fx = this.take("coin");
    fx.life = 1.1;
    fx.mesh.position.set(x, 2.4, z);
  }

  update(camera: THREE.Camera, dt: number) {
    for (const f of this.pool) {
      if (f.age >= f.life) {
        f.mesh.visible = false;
        continue;
      }
      f.age += dt;
      const t = Math.min(1, f.age / f.life);
      const mat = (f.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (f.kind === "coin") {
        f.mesh.position.y += dt * 1.6;
        mat.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      } else if (f.kind === "block") {
        f.mesh.quaternion.copy(camera.quaternion);
        f.mesh.scale.setScalar(1 + t * 2.5);
        mat.opacity = 1 - t;
      } else {
        f.mesh.scale.setScalar(0.5 + t * 2.4);
        mat.opacity = 0.9 * (1 - t);
      }
    }
  }
}
