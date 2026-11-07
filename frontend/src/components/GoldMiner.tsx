import raiseFrame from "@/assets/miner-raise.jpg";
import midFrame from "@/assets/miner-mid.jpg";
import strikeFrame from "@/assets/miner-strike.jpg";

const chips = [
  { dx: "-16px", dy: "-48px" },
  { dx: "20px", dy: "-54px" },
  { dx: "-30px", dy: "-26px" },
  { dx: "30px", dy: "-34px" },
];

// Animated gold-mine scene. While the miner has energy he swings like a real miner:
// pickaxe raised behind his head, brought overhead, then struck into the gold rock
// (flash, shake and flying gold chips on every hit). Resting = dimmed, no swing.
export function GoldMiner({ mining }: { mining: boolean }) {
  return (
    <div className={`mine-scene absolute inset-0 overflow-hidden ${mining ? "is-mining" : ""}`}>
      <div className="mine-art" role="img" aria-label={mining ? "Gold miner swinging his pickaxe into a gold rock" : "Gold miner resting in the mine"}>
        <img src={raiseFrame} alt="" className="f-raise" />
        <img src={midFrame} alt="" className="f-mid" />
        <img src={strikeFrame} alt="" className="f-strike" />
        <span className="mine-glow mine-lantern" style={{ left: "33%", top: "16%" }} />
        <span className="mine-glow mine-lantern b" style={{ left: "81%", top: "10%" }} />
        <span className="mine-glow mine-flash" style={{ left: "66%", top: "72%" }} />
        {chips.map((c, i) => (
          <span key={i} className="mine-chip" style={{ left: "65%", top: "70%", ["--dx" as string]: c.dx, ["--dy" as string]: c.dy }} />
        ))}
      </div>
    </div>
  );
}
