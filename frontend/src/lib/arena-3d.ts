import * as THREE from "three";

type Actor = { x: number; y: number; face?: number; walk?: number; dead?: number; shieldA?: number; shieldT?: number; gunA?: number };
type Cover = { x: number; y: number; w: number; h: number; kind: string };
type Frame = { player: Actor; enemies: Actor[]; bullets: {x:number;y:number;enemy:boolean}[]; covers: Cover[]; camX: number; aiming: boolean; aimX: number; aimY: number };

export function createArena3D(host: HTMLElement, width: number, height: number) {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string) => new THREE.Color(styles.getPropertyValue(name).trim());
  const palette = { ground: color("--arena-ground"), blue: color("--arena-blue"), red: color("--arena-red"), armor: color("--arena-armor"), skin: color("--arena-skin"), hair: color("--arena-hair"), dark: color("--arena-dark"), cover: color("--arena-cover"), gold: color("--arena-gold"), sky: color("--arena-sky"), shield: color("--arena-shield") };
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = "arena-three";
  renderer.domElement.setAttribute("aria-label", "3D military battle arena");
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = palette.sky;
  scene.add(new THREE.HemisphereLight(palette.armor, palette.ground, 2.3));
  const sunlight = new THREE.DirectionalLight(palette.armor, 3);
  sunlight.position.set(-300, 700, 200); sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = -width * 2; sunlight.shadow.camera.right = width * 2;
  sunlight.shadow.camera.top = height; sunlight.shadow.camera.bottom = -height;
  scene.add(sunlight);
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 1, 6000);
  const materials = Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, new THREE.MeshStandardMaterial({ color: value, roughness: 0.8 })]));
  const box = (parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, role: keyof typeof palette) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[role]);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const ground = box(scene, width * 1.5, -7, height / 2, width * 4, 12, height * 2, "ground");
  ground.receiveShadow = true;
  for (let i = 0; i < 10; i++) {
    const x = i * width * 0.4;
    box(scene, x, 70, 15, 110, 140, 85, i % 2 ? "cover" : "armor");
    box(scene, x, 135, 15, 128, 10, 102, "blue");
    for (let j = -1; j <= 1; j++) box(scene, x + j * 30, 85, 59, 18, 24, 3, "blue");
    box(scene, x, 150, -22, 5, 160, 5, "dark");
  }
  const coverGroup = new THREE.Group(); scene.add(coverGroup);
  let coversBuilt = false;
  function soldier(enemy: boolean) {
    const group = new THREE.Group(); const body = new THREE.Group(); group.add(body);
    const suit = enemy ? "red" : "blue";
    box(body, 0, 47, 0, 25, 35, 18, suit);
    box(body, 0, 53, -10, 20, 18, 5, enemy ? "dark" : "armor");
    box(body, 0, 72, 0, 23, 22, 21, "skin");
    box(body, 0, 83, 2, 26, 9, 23, enemy ? "dark" : "hair");
    box(body, -7, 74, -11, 4, 4, 2, "dark"); box(body, 7, 74, -11, 4, 4, 2, "dark");
    box(body, -19, 51, 0, 12, 22, 16, enemy ? "dark" : "armor");
    box(body, 19, 51, 0, 12, 22, 16, enemy ? "dark" : "armor");
    box(body, 15, 43, -20, 9, 9, 34, "dark"); box(body, 15, 45, -39, 6, 5, 8, "gold");
    const left = new THREE.Group(); left.position.set(-8, 30, 0); body.add(left);
    const right = new THREE.Group(); right.position.set(8, 30, 0); body.add(right);
    for (const leg of [left, right]) { box(leg, 0, -12, 0, 11, 24, 12, suit); box(leg, 0, -26, -4, 13, 8, 20, "dark"); }
    const shield = new THREE.Mesh(new THREE.SphereGeometry(43, 24, 16, 0, Math.PI), new THREE.MeshStandardMaterial({ color: palette.shield, transparent: true, opacity: 0.45, metalness: 0.25, roughness: 0.1, side: THREE.DoubleSide }));
    shield.position.set(0, 40, -35); shield.scale.set(1, 1, 0.25); group.add(shield); shield.visible = false;
    group.scale.setScalar(1.45);
    scene.add(group); return { group, body, left, right, shield };
  }
  const hero = soldier(false); const enemies: ReturnType<typeof soldier>[] = [];
  const bullets: THREE.Mesh[] = [];
  const laserGeometry = new THREE.BufferGeometry();
  const laser = new THREE.Line(laserGeometry, new THREE.LineBasicMaterial({color: palette.red})); scene.add(laser);
  const target = new THREE.Mesh(new THREE.TorusGeometry(14, 2, 8, 32), new THREE.MeshBasicMaterial({color:palette.red})); target.rotation.x = -Math.PI / 2; scene.add(target);
  const update = (model: ReturnType<typeof soldier>, actor: Actor, face: number) => {
    model.group.position.set(actor.x, 0, actor.y);
    model.body.rotation.y = -face - Math.PI / 2;
    model.left.rotation.x = Math.sin(actor.walk ?? 0) * 0.6;
    model.right.rotation.x = -model.left.rotation.x;
    model.body.position.y = Math.abs(Math.sin(actor.walk ?? 0)) * 2;
    model.group.rotation.z = actor.dead ? Math.min(actor.dead, 1) * Math.PI / 2 : 0;
    model.shield.visible = (actor.shieldT ?? 0) > 0.1;
    const angle = actor.shieldA ?? -Math.PI / 2;
    model.shield.position.set(Math.cos(angle) * 46, 38, Math.sin(angle) * 46);
    model.shield.rotation.y = -angle + Math.PI / 2;
  };
  return {
    render(frame: Frame) {
      if (!coversBuilt) {
        for (const c of frame.covers) {
          const group = new THREE.Group(); group.position.set(c.x + c.w / 2, 0, c.y + c.h / 2); coverGroup.add(group);
          const height = c.kind === "barrier" ? 30 : 42;
          box(group, 0, height / 2, 0, c.w, height, c.h, c.kind === "barrel" ? "red" : "cover");
          box(group, 0, height - 6, -c.h / 2 - 1, c.w, 7, 2, "gold");
        }
        coversBuilt = true;
      }
      const centerX = frame.camX + width / 2;
      camera.position.set(centerX, 1250, height / 2 + 900); camera.lookAt(centerX, 0, height / 2);
      update(hero, frame.player, frame.player.face ?? -Math.PI / 2);
      while (enemies.length < frame.enemies.length) enemies.push(soldier(true));
      enemies.forEach((model, i) => { const e = frame.enemies[i]; model.group.visible = Boolean(e); if (e) update(model, e, Math.atan2(frame.player.y - e.y, frame.player.x - e.x)); });
      while (bullets.length < frame.bullets.length) { const mesh = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 8), new THREE.MeshBasicMaterial({color:palette.gold})); scene.add(mesh); bullets.push(mesh); }
      bullets.forEach((mesh, i) => { const b = frame.bullets[i]; mesh.visible = Boolean(b); if (b) { mesh.position.set(b.x, 35, b.y); (mesh.material as THREE.MeshBasicMaterial).color.copy(b.enemy ? palette.red : palette.shield); } });
      laser.visible = frame.aiming; target.visible = frame.aiming;
      if (frame.aiming) { laserGeometry.setFromPoints([new THREE.Vector3(frame.player.x, 40, frame.player.y), new THREE.Vector3(frame.aimX, 5, frame.aimY)]); target.position.set(frame.aimX, 5, frame.aimY); }
      renderer.render(scene, camera);
    },
    resize(w: number, h: number) { width = w; height = h; renderer.setSize(w,h); camera.left=-w/2; camera.right=w/2; camera.top=h/2; camera.bottom=-h/2; camera.updateProjectionMatrix(); },
    dispose() { scene.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); } }); Object.values(materials).forEach(m => m.dispose()); laserGeometry.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  };
}