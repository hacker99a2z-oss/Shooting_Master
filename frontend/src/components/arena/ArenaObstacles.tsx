import { useMemo } from "react";
import * as THREE from "three";
import type { Obstacle } from "@/lib/arena-hero";

/** Painted canvas textures so the cover pieces match the cartoon arena art. */
function canvasTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, colors: string[], count: number) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[i % colors.length] ?? "#888";
    g.globalAlpha = 0.25;
    g.beginPath();
    g.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function useObstacleMaterials() {
  return useMemo(() => {
    const concrete = canvasTexture(256, 128, (g) => {
      g.fillStyle = "#b9b4b0";
      g.fillRect(0, 0, 256, 128);
      speckle(g, 256, 128, ["#8d8884", "#d6d2cd", "#9e9894"], 220);
    });
    const hazard = canvasTexture(512, 128, (g) => {
      g.fillStyle = "#b9b4b0";
      g.fillRect(0, 0, 512, 128);
      speckle(g, 512, 128, ["#8d8884", "#d6d2cd"], 160);
      g.save();
      g.beginPath();
      g.rect(28, 30, 456, 68);
      g.clip();
      g.fillStyle = "#f3c21b";
      g.fillRect(28, 30, 456, 68);
      g.fillStyle = "#1c1d22";
      for (let x = -80; x < 560; x += 64) {
        g.beginPath();
        g.moveTo(x, 98);
        g.lineTo(x + 32, 98);
        g.lineTo(x + 100, 30);
        g.lineTo(x + 68, 30);
        g.closePath();
        g.fill();
      }
      g.restore();
      g.strokeStyle = "rgba(60,55,50,0.45)";
      g.lineWidth = 4;
      g.strokeRect(28, 30, 456, 68);
    });
    const wood = canvasTexture(256, 256, (g) => {
      g.fillStyle = "#d39a52";
      g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 42) {
        g.fillStyle = y % 84 === 0 ? "#c88d47" : "#dca863";
        g.fillRect(0, y, 256, 40);
        g.fillStyle = "#9c642c";
        g.fillRect(0, y + 40, 256, 2);
      }
      g.strokeStyle = "#a86e33";
      g.lineWidth = 26;
      g.strokeRect(13, 13, 230, 230);
      g.beginPath();
      g.moveTo(26, 26);
      g.lineTo(230, 230);
      g.stroke();
      g.strokeStyle = "#7d4f22";
      g.lineWidth = 3;
      g.strokeRect(2, 2, 252, 252);
      g.strokeRect(26, 26, 204, 204);
      g.fillStyle = "#6b6f78";
      for (const [x, y] of [[13, 13], [243, 13], [13, 243], [243, 243]] as const) {
        g.beginPath();
        g.arc(x, y, 5, 0, Math.PI * 2);
        g.fill();
      }
    });
    const ammo = canvasTexture(256, 160, (g) => {
      g.fillStyle = "#4c7a3a";
      g.fillRect(0, 0, 256, 160);
      g.fillStyle = "#5d9146";
      g.fillRect(10, 10, 236, 140);
      g.fillStyle = "#3e6530";
      g.fillRect(0, 74, 256, 12);
      g.fillStyle = "#2c2f33";
      for (const x of [40, 200]) g.fillRect(x, 64, 18, 30);
      g.fillStyle = "#f2e6b8";
      g.font = "bold 26px sans-serif";
      g.fillText("AMMO", 92, 52);
      g.fillStyle = "#e86a2c";
      g.fillRect(96, 110, 64, 14);
    });
    const barrel = canvasTexture(256, 256, (g) => {
      g.fillStyle = "#d6452a";
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = "#b5341d";
      for (const y of [30, 128, 220]) g.fillRect(0, y, 256, 12);
      g.fillStyle = "#fff4ea";
      g.beginPath();
      g.moveTo(128, 70);
      g.bezierCurveTo(160, 110, 168, 140, 128, 182);
      g.bezierCurveTo(90, 140, 100, 112, 116, 96);
      g.bezierCurveTo(118, 118, 126, 120, 128, 70);
      g.fill();
      speckle(g, 256, 256, ["#8f2412"], 60);
    });
    const std = (map: THREE.Texture, roughness = 0.8) => new THREE.MeshStandardMaterial({ map, roughness, metalness: 0.05 });
    const shadow = canvasTexture(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
      grad.addColorStop(0, "rgba(20,14,50,0.5)");
      grad.addColorStop(1, "rgba(20,14,50,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    });
    return {
      concrete: std(concrete),
      hazard: std(hazard),
      wood: std(wood, 0.85),
      ammo: std(ammo, 0.7),
      barrel: std(barrel, 0.5),
      barrelTop: new THREE.MeshStandardMaterial({ color: "#c23a22", roughness: 0.5, metalness: 0.2 }),
      metal: new THREE.MeshStandardMaterial({ color: "#7b808c", roughness: 0.4, metalness: 0.6 }),
      shadow: new THREE.MeshBasicMaterial({ map: shadow, transparent: true, depthWrite: false }),
    };
  }, []);
}

type Mats = ReturnType<typeof useObstacleMaterials>;

function Barrier({ m }: { m: Mats }) {
  // Jersey-style concrete barrier, 2.4 m long, hazard stripes on both long faces.
  const sides = [m.concrete, m.concrete, m.concrete, m.concrete, m.hazard, m.hazard];
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.2, 0]} material={m.concrete}>
        <boxGeometry args={[2.4, 0.4, 0.72]} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0.72, 0]} material={sides}>
        <boxGeometry args={[2.32, 0.66, 0.5]} />
      </mesh>
      <mesh castShadow position={[0, 1.1, 0]} material={m.concrete}>
        <boxGeometry args={[2.36, 0.1, 0.44]} />
      </mesh>
      {[-0.9, 0.9].map((x) => (
        <mesh key={x} position={[x, 0.06, 0]} material={m.metal}>
          <boxGeometry args={[0.3, 0.12, 0.76]} />
        </mesh>
      ))}
    </group>
  );
}

function Crate({ m, size = 1.2, position = [0, 0, 0] as [number, number, number], turn = 0 }: { m: Mats; size?: number; position?: [number, number, number]; turn?: number }) {
  return (
    <mesh castShadow receiveShadow position={[position[0], position[1] + size / 2, position[2]]} rotation-y={turn} material={m.wood}>
      <boxGeometry args={[size, size, size]} />
    </mesh>
  );
}

function Barrel({ m }: { m: Mats }) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.62, 0]} material={[m.barrel, m.barrelTop, m.barrelTop]}>
        <cylinderGeometry args={[0.44, 0.44, 1.24, 24]} />
      </mesh>
      {[0.12, 1.12].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation-x={Math.PI / 2} material={m.barrelTop}>
          <torusGeometry args={[0.445, 0.03, 6, 24]} />
        </mesh>
      ))}
    </group>
  );
}

function AmmoStack({ m }: { m: Mats }) {
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, 0.36, 0]} material={m.ammo}>
        <boxGeometry args={[1.7, 0.72, 0.9]} />
      </mesh>
      <mesh castShadow receiveShadow position={[0.1, 1.04, 0]} rotation-y={0.06} material={m.ammo}>
        <boxGeometry args={[1.3, 0.62, 0.8]} />
      </mesh>
    </group>
  );
}

function ObstacleMesh({ o, m }: { o: Obstacle; m: Mats }) {
  let content: React.ReactNode;
  switch (o.kind) {
    case "barrier":
      content = <Barrier m={m} />;
      break;
    case "crate":
      content = <Crate m={m} />;
      break;
    case "crateStack":
      content = (
        <>
          <Crate m={m} position={[-0.6, 0, 0]} />
          <Crate m={m} position={[0.6, 0, 0]} turn={0.05} />
          <Crate m={m} size={1.05} position={[-0.1, 1.2, 0]} turn={-0.12} />
        </>
      );
      break;
    case "barrel":
      content = <Barrel m={m} />;
      break;
    case "ammo":
      content = <AmmoStack m={m} />;
      break;
  }
  const shadowW = (o.rotated ? o.halfD : o.halfW) * 2 + 0.8;
  const shadowD = (o.rotated ? o.halfW : o.halfD) * 2 + 0.8;
  return (
    <group position={[o.x, 0, o.z]} rotation-y={o.rotated ? Math.PI / 2 : 0}>
      <mesh rotation-x={-Math.PI / 2} position={[0.15, 0.015, 0.15]} material={m.shadow}>
        <planeGeometry args={[shadowW, shadowD]} />
      </mesh>
      {content}
    </group>
  );
}

/** This match's cover pieces. */
export function ArenaObstacles({ obstacles }: { obstacles: Obstacle[] }) {
  const m = useObstacleMaterials();
  return (
    <group>
      {obstacles.map((o) => (
        <ObstacleMesh key={o.id} o={o} m={m} />
      ))}
    </group>
  );
}
