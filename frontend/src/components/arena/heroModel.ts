import * as THREE from "three";

/**
 * The blue armoured hero, built from simple shapes with a joint hierarchy so it can be
 * animated in code: walk cycle, turning, gun-arm raise for aiming, shield-arm block and
 * crouching behind cover. Local front is +z; the root's rotation.y is the hero's yaw.
 */

export type HeroPose = {
  /** Actual ground speed in m/s (drives the walk cycle). */
  speed: number;
  aiming: boolean;
  shielding: boolean;
  inCover: boolean;
};

const HIP_Y = 0.74;
const WAIST_Y = 0.8;
const THIGH = 0.33;
const STRIDE = 1.15;
const CROUCH_DROP = 0.28;

const color = (hex: string) => new THREE.Color(hex);

function materials() {
  return {
    armorWhite: new THREE.MeshStandardMaterial({ color: color("#eef2fa"), roughness: 0.32, metalness: 0.2 }),
    armorBlue: new THREE.MeshStandardMaterial({ color: color("#2c6cf2"), roughness: 0.3, metalness: 0.35 }),
    armorDeep: new THREE.MeshStandardMaterial({ color: color("#1c3fa8"), roughness: 0.35, metalness: 0.3 }),
    suit: new THREE.MeshStandardMaterial({ color: color("#1a2140"), roughness: 0.65, metalness: 0.1 }),
    glow: new THREE.MeshStandardMaterial({ color: color("#7ff0ff"), emissive: color("#34d6ff"), emissiveIntensity: 1.6, roughness: 0.3 }),
    skin: new THREE.MeshStandardMaterial({ color: color("#f4c6a2"), roughness: 0.75 }),
    hair: new THREE.MeshStandardMaterial({ color: color("#6e3d20"), roughness: 0.8 }),
    eye: new THREE.MeshStandardMaterial({ color: color("#1b1d2b"), roughness: 0.3 }),
    gunMetal: new THREE.MeshStandardMaterial({ color: color("#a9b6c9"), roughness: 0.28, metalness: 0.75 }),
    gunDark: new THREE.MeshStandardMaterial({ color: color("#262c3d"), roughness: 0.45, metalness: 0.4 }),
    shield: new THREE.MeshStandardMaterial({
      color: color("#4fb4ff"),
      emissive: color("#1a78ff"),
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.62,
      roughness: 0.15,
      metalness: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    shieldRim: new THREE.MeshStandardMaterial({ color: color("#9ff6ff"), emissive: color("#3fe0ff"), emissiveIntensity: 2, roughness: 0.2 }),
  };
}

type Mats = ReturnType<typeof materials>;

function part(geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number] = [0, 0, 0], scale?: [number, number, number], rotation?: [number, number, number]) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...position);
  if (scale) m.scale.set(...scale);
  if (rotation) m.rotation.set(...rotation);
  m.castShadow = true;
  return m;
}

function group(position: [number, number, number] = [0, 0, 0], ...children: THREE.Object3D[]) {
  const g = new THREE.Group();
  g.position.set(...position);
  if (children.length) g.add(...children);
  return g;
}

function buildHead(m: Mats) {
  const head = group([0, 0.6, 0]);
  head.add(part(new THREE.SphereGeometry(0.22, 28, 20), m.skin, [0, 0, 0], [1, 1.02, 0.98]));
  // Eyes and brows on the face.
  for (const side of [-1, 1]) {
    head.add(part(new THREE.SphereGeometry(0.032, 12, 10), m.eye, [side * 0.078, -0.01, 0.198], [0.85, 1.25, 0.5]));
    head.add(part(new THREE.BoxGeometry(0.07, 0.016, 0.02), m.hair, [side * 0.078, 0.055, 0.205], undefined, [0, 0, side * -0.15]));
  }
  // Hair cap with brown spikes, mostly on top and back (what the camera sees).
  head.add(part(new THREE.SphereGeometry(0.236, 28, 20), m.hair, [0, 0.05, -0.035], [1.06, 0.96, 1.04]));
  const spike = new THREE.ConeGeometry(0.075, 0.2, 7);
  const spikes: Array<[number, number]> = [
    [0.15, 0], [0.4, 0.6], [0.4, -0.6], [0.55, 1.6], [0.55, -1.6], [0.7, 2.4], [0.7, -2.4],
    [0.75, Math.PI], [1.0, 2.9], [1.0, -2.9], [1.05, 2.1], [1.05, -2.1], [0.35, Math.PI], [0.5, 0.15],
  ];
  for (const [polar, azimuth] of spikes) {
    const dir = new THREE.Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
    // Front spikes sweep up and back like the artwork's fringe.
    if (dir.z > 0) dir.add(new THREE.Vector3(0, 0.6, -0.4)).normalize();
    const s = part(spike, m.hair, [dir.x * 0.22, 0.05 + dir.y * 0.21, -0.035 + dir.z * 0.22]);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    head.add(s);
  }
  // Earpiece with a glowing ring and a mic on the right.
  for (const side of [-1, 1]) {
    head.add(part(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16), m.armorBlue, [side * 0.225, -0.02, 0], undefined, [0, 0, Math.PI / 2]));
    head.add(part(new THREE.TorusGeometry(0.045, 0.01, 6, 16), m.glow, [side * 0.252, -0.02, 0], undefined, [0, Math.PI / 2, 0]));
  }
  head.add(part(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), m.armorBlue, [-0.23, -0.08, 0.07], undefined, [1.1, 0, 0]));
  head.add(part(new THREE.SphereGeometry(0.022, 8, 8), m.glow, [-0.23, -0.12, 0.14]));
  return head;
}

function buildGun(m: Mats) {
  // Built with the barrel along +z, then laid along the forearm (-y) by the caller.
  const gun = new THREE.Group();
  gun.add(part(new THREE.BoxGeometry(0.05, 0.13, 0.065), m.gunDark, [0, -0.06, -0.015], undefined, [-0.25, 0, 0]));
  gun.add(part(new THREE.BoxGeometry(0.075, 0.09, 0.25), m.gunMetal, [0, 0.03, 0.06]));
  gun.add(part(new THREE.BoxGeometry(0.06, 0.035, 0.2), m.armorBlue, [0, 0.09, 0.05]));
  gun.add(part(new THREE.BoxGeometry(0.08, 0.03, 0.08), m.glow, [0, 0.03, 0.02]));
  gun.add(part(new THREE.CylinderGeometry(0.024, 0.028, 0.13, 12), m.gunDark, [0, 0.04, 0.24], undefined, [Math.PI / 2, 0, 0]));
  gun.add(part(new THREE.TorusGeometry(0.026, 0.007, 6, 14), m.glow, [0, 0.04, 0.3]));
  return gun;
}

function buildShield(m: Mats) {
  const shield = new THREE.Group();
  const plate = part(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 6), m.shield, [0, 0, 0], [0.78, 1, 1.3]);
  plate.castShadow = false;
  shield.add(plate);
  // Glowing border: a slightly larger hexagon just behind the plate.
  shield.add(part(new THREE.CylinderGeometry(0.335, 0.335, 0.012, 6), m.shieldRim, [0, -0.012, 0], [0.78, 1, 1.3]));
  shield.add(part(new THREE.CylinderGeometry(0.07, 0.07, 0.035, 6), m.shieldRim, [0, 0, 0]));
  return shield;
}

function buildArm(m: Mats, side: 1 | -1) {
  // side: +1 = left arm (+x), -1 = right arm (-x).
  const shoulder = group([side * 0.28, 0.36, 0]);
  shoulder.add(part(new THREE.SphereGeometry(0.115, 18, 14), m.armorBlue, [side * 0.035, 0.03, 0], [1.1, 0.9, 1.05]));
  shoulder.add(part(new THREE.TorusGeometry(0.08, 0.012, 6, 16), m.glow, [side * 0.07, 0.0, 0], undefined, [0, Math.PI / 2, 0]));
  const upper = group([0, 0, 0]);
  upper.add(part(new THREE.CapsuleGeometry(0.058, 0.14, 4, 12), m.suit, [0, -0.12, 0]));
  const elbow = group([0, -0.25, 0]);
  elbow.add(part(new THREE.CapsuleGeometry(0.068, 0.12, 4, 12), m.armorWhite, [0, -0.1, 0]));
  elbow.add(part(new THREE.CylinderGeometry(0.078, 0.07, 0.07, 14), m.armorBlue, [0, -0.17, 0]));
  elbow.add(part(new THREE.TorusGeometry(0.074, 0.01, 6, 16), m.glow, [0, -0.13, 0], undefined, [Math.PI / 2, 0, 0]));
  elbow.add(part(new THREE.SphereGeometry(0.068, 14, 12), m.armorBlue, [0, -0.25, 0.01]));
  upper.add(elbow);
  shoulder.add(upper);
  return { shoulder, upper, elbow };
}

function buildLeg(m: Mats, side: 1 | -1) {
  const hip = group([side * 0.1, HIP_Y, 0]);
  hip.add(part(new THREE.CapsuleGeometry(0.078, 0.2, 4, 12), m.suit, [0, -0.165, 0]));
  hip.add(part(new THREE.BoxGeometry(0.12, 0.16, 0.06), m.armorWhite, [0, -0.15, 0.06]));
  const knee = group([0, -THIGH, 0]);
  knee.add(part(new THREE.SphereGeometry(0.07, 12, 10), m.armorBlue, [0, 0, 0.035]));
  knee.add(part(new THREE.CapsuleGeometry(0.084, 0.16, 4, 12), m.armorWhite, [0, -0.15, 0]));
  knee.add(part(new THREE.BoxGeometry(0.03, 0.12, 0.02), m.glow, [0, -0.14, 0.085]));
  knee.add(part(new THREE.BoxGeometry(0.17, 0.13, 0.27), m.armorBlue, [0, -0.33, 0.035]));
  knee.add(part(new THREE.BoxGeometry(0.18, 0.04, 0.29), m.suit, [0, -0.39, 0.04]));
  hip.add(knee);
  return { hip, knee };
}

const damp = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function createHeroModel() {
  const m = materials();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // Pelvis and belt.
  body.add(part(new THREE.SphereGeometry(0.17, 18, 14), m.suit, [0, HIP_Y + 0.02, 0], [1.15, 0.7, 0.85]));
  body.add(part(new THREE.CylinderGeometry(0.19, 0.19, 0.07, 20), m.armorDeep, [0, HIP_Y + 0.07, 0]));
  body.add(part(new THREE.BoxGeometry(0.08, 0.05, 0.03), m.glow, [0, HIP_Y + 0.07, 0.18]));

  const legL = buildLeg(m, 1);
  const legR = buildLeg(m, -1);
  body.add(legL.hip, legR.hip);

  const torso = group([0, WAIST_Y, 0]);
  body.add(torso);
  torso.add(part(new THREE.CapsuleGeometry(0.15, 0.06, 4, 14), m.suit, [0, 0.07, 0]));
  torso.add(part(new THREE.SphereGeometry(0.25, 22, 16), m.armorWhite, [0, 0.25, 0], [1, 0.86, 0.74]));
  torso.add(part(new THREE.SphereGeometry(0.2, 20, 14), m.armorBlue, [0, 0.26, 0.07], [0.92, 0.72, 0.55]));
  torso.add(part(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 6), m.glow, [0, 0.25, 0.185], undefined, [Math.PI / 2, 0, 0]));
  // Backpack (seen from the camera behind the hero).
  torso.add(part(new THREE.BoxGeometry(0.3, 0.3, 0.12), m.armorDeep, [0, 0.25, -0.17]));
  torso.add(part(new THREE.BoxGeometry(0.035, 0.2, 0.02), m.glow, [-0.07, 0.25, -0.235]));
  torso.add(part(new THREE.BoxGeometry(0.035, 0.2, 0.02), m.glow, [0.07, 0.25, -0.235]));
  torso.add(part(new THREE.CylinderGeometry(0.13, 0.15, 0.07, 18), m.armorBlue, [0, 0.41, 0]));
  torso.add(part(new THREE.CylinderGeometry(0.06, 0.065, 0.08, 12), m.skin, [0, 0.46, 0]));
  const head = buildHead(m);
  torso.add(head);

  const armL = buildArm(m, 1);
  const armR = buildArm(m, -1);
  torso.add(armL.shoulder, armR.shoulder);

  const gun = buildGun(m);
  gun.rotation.x = Math.PI / 2; // barrel (+z) along the forearm (-y)
  gun.position.set(0, -0.25, 0.0);
  armR.elbow.add(gun);

  const shield = buildShield(m);
  armL.elbow.add(shield);
  // Resting on the outside of the left forearm, facing outward.
  const shieldRestQ = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0)),
  );
  const shieldRestP = new THREE.Vector3(0.1, -0.13, 0);
  // Held in front of the chest, facing forward (in torso space).
  const shieldFrontQ = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)),
  ).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.35));
  const shieldFrontP = new THREE.Vector3(0.3, 0.2, 0.44);

  // Soft round shadow on the ground.
  const shadowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, "rgba(10,12,40,0.55)");
    grad.addColorStop(1, "rgba(10,12,40,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);

  const muzzleFlash = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshBasicMaterial({ color: color("#fff2a8"), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  muzzleFlash.position.set(0, 0.04, 0.34);
  muzzleFlash.visible = false;
  gun.add(muzzleFlash);

  const anim = { phase: 0, amp: 0, aim: 0, shield: 0, crouch: 0, recoil: 0, flash: 0, time: 0 };
  const tmpQ = new THREE.Quaternion();
  const tmpQ2 = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();

  function update(pose: HeroPose, dt: number) {
    anim.time += dt;
    const targetAmp = Math.min(1, pose.speed / 3.2);
    anim.amp = damp(anim.amp, targetAmp, 10, dt);
    anim.phase += (pose.speed * dt * Math.PI * 2) / STRIDE;
    anim.aim = damp(anim.aim, pose.aiming ? 1 : 0, pose.aiming ? 20 : 9, dt);
    anim.shield = damp(anim.shield, pose.shielding ? 1 : 0, pose.shielding ? 16 : 9, dt);
    const crouchTarget = pose.inCover && !pose.aiming && pose.speed < 0.4 ? 1 : 0;
    anim.crouch = damp(anim.crouch, crouchTarget, 7, dt);
    anim.recoil = damp(anim.recoil, 0, 14, dt);
    anim.flash = Math.max(0, anim.flash - dt);

    const p = anim.phase;
    const a = anim.amp;
    const c = anim.crouch;
    const breathe = Math.sin(anim.time * 2.2) * 0.012 * (1 - a);

    // Legs: swing, knee bend on the forward swing, squat when in cover.
    const swing = Math.sin(p) * 0.62 * a;
    const kneeL = 0.12 + 0.95 * a * Math.max(0, Math.cos(p));
    const kneeR = 0.12 + 0.95 * a * Math.max(0, -Math.cos(p));
    legL.hip.rotation.x = lerp(-swing, -1.0, c);
    legR.hip.rotation.x = lerp(swing, -1.0, c);
    legL.knee.rotation.x = lerp(kneeL, 1.81, c);
    legR.knee.rotation.x = lerp(kneeR, 1.81, c);
    legL.hip.rotation.z = lerp(0.03, 0.18, c);
    legR.hip.rotation.z = lerp(-0.03, -0.18, c);

    body.position.y = 0.035 * a * Math.cos(2 * p) - CROUCH_DROP * c;
    torso.rotation.x = 0.1 * a + 0.32 * c + breathe - 0.05 * anim.aim;
    torso.rotation.y = 0.08 * Math.sin(p) * a * (1 - anim.aim) + 0.06 * anim.aim - 0.1 * anim.shield * (1 - anim.aim);
    head.rotation.x = -0.55 * torso.rotation.x;
    head.rotation.y = -torso.rotation.y * 0.8;

    // Arms swing opposite to the legs.
    const armSwing = Math.sin(p) * 0.5 * a;
    // Right arm: hangs with the gun pointing down, or raised straight out to aim.
    armR.shoulder.rotation.y = lerp(0, -0.2, anim.aim);
    armR.upper.rotation.x = lerp(-armSwing + 0.05 - 0.35 * c, -1.62 - anim.recoil * 0.4, anim.aim);
    armR.upper.rotation.z = lerp(-0.12, 0.02, anim.aim);
    armR.elbow.rotation.x = lerp(-0.35 - 0.25 * a, -0.04 + anim.recoil * 0.25, anim.aim);
    // Left arm: swings, or brings the shield up in front.
    armL.shoulder.rotation.y = lerp(0, -0.12, anim.shield);
    armL.upper.rotation.x = lerp(armSwing + 0.05 - 0.35 * c, -1.15, anim.shield);
    armL.upper.rotation.z = lerp(0.12, 0.25, anim.shield);
    armL.elbow.rotation.x = lerp(-0.3 - 0.2 * a, -0.7, anim.shield);

    // Place the shield: on the forearm at rest, in front of the chest when blocking.
    root.updateMatrixWorld(true);
    torso.getWorldQuaternion(tmpQ);
    armL.elbow.getWorldQuaternion(tmpQ2);
    const forearmInTorso = tmpQ.clone().invert().multiply(tmpQ2);
    const frontLocalQ = forearmInTorso.invert().multiply(shieldFrontQ);
    shield.quaternion.slerpQuaternions(shieldRestQ, frontLocalQ, anim.shield);
    tmpV.copy(shieldFrontP);
    torso.localToWorld(tmpV);
    armL.elbow.worldToLocal(tmpV);
    shield.position.lerpVectors(shieldRestP, tmpV, anim.shield);
    const s = 1 + 0.45 * anim.shield;
    shield.scale.set(s, s, s);

    muzzleFlash.visible = anim.flash > 0;
    if (muzzleFlash.visible) muzzleFlash.scale.setScalar(0.6 + anim.flash * 12);
  }

  /** Snap the gun arm up and kick it back for a shot. */
  function fire() {
    anim.aim = 1;
    anim.recoil = 1;
    anim.flash = 0.07;
  }

  return { root, update, fire, aimAmount: () => anim.aim };
}

export type HeroModel = ReturnType<typeof createHeroModel>;
