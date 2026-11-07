import mineScene from "@/assets/gold-mine-scene.jpg";

const chips = [
  { cls: "c1", dx: "-18px", dy: "-46px" },
  { cls: "c2", dx: "22px", dy: "-52px" },
  { cls: "c3", dx: "-30px", dy: "-28px" },
  { cls: "c4", dx: "30px", dy: "-34px" },
];

// Animated gold-mine scene: lanterns flicker, and while the miner has energy every
// pickaxe strike flashes, shakes the scene and throws gold chips. Resting = dimmed.
export function GoldMiner({ mining }: { mining: boolean }) {
  return (
    <div className={`mine-scene absolute inset-0 overflow-hidden ${mining ? "is-mining" : ""}`}>
      <div className="mine-art">
        <img src={mineScene} alt={mining ? "Gold miner digging gold in the mine" : "Gold miner resting in the mine"} />
        <span className="mine-glow mine-lantern" style={{ left: "33%", top: "19%" }} />
        <span className="mine-glow mine-lantern b" style={{ left: "81%", top: "9%" }} />
        <span className="mine-glow mine-flash" style={{ left: "68%", top: "71%" }} />
        {chips.map((c) => (
          <span key={c.cls} className={`mine-chip ${c.cls}`} style={{ left: "68%", top: "68%", ["--dx" as string]: c.dx, ["--dy" as string]: c.dy }} />
        ))}
      </div>
    </div>
  );
}
