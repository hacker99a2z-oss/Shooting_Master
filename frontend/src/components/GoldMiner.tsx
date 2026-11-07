import raiseFrame from "@/assets/miner-raise.jpg";
import midFrame from "@/assets/miner-mid.jpg";

const strikeFrame =
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Screenshot%202026-11-07%20111215-DgD8WKIcZOYcMvWlWG0fKUVW1IdaN5.png";

const chips = [
  { dx: "-16px", dy: "-48px" },
  { dx: "20px", dy: "-54px" },
  { dx: "-30px", dy: "-26px" },
  { dx: "30px", dy: "-34px" },
];

// The strike frame uses the supplied reference; the three poses form a continuous swing.
export function GoldMiner({ mining }: { mining: boolean }) {
  return (
    <div className={`mine-scene absolute inset-0 overflow-hidden ${mining ? "is-mining" : ""}`}>
      <div
        className="mine-art"
        role="img"
        aria-label={
          mining
            ? "Miner raises a pickaxe, strikes the gold vein, and sends sparks flying"
            : "Miner waiting beside a gold vein"
        }
      >
        <img src={raiseFrame} alt="" className="f-raise" />
        <img src={midFrame} alt="" className="f-mid" />
        <img src={strikeFrame} alt="" className="f-strike" />
        <span className="mine-glow mine-lantern" style={{ left: "33%", top: "16%" }} />
        <span className="mine-glow mine-lantern b" style={{ left: "81%", top: "10%" }} />
        <span className="mine-glow mine-flash" style={{ left: "66%", top: "72%" }} />
        {chips.map((chip, index) => (
          <span
            key={index}
            className="mine-chip"
            style={{
              left: "65%",
              top: "70%",
              ["--dx" as string]: chip.dx,
              ["--dy" as string]: chip.dy,
              ["--chip-index" as string]: index,
            }}
          />
        ))}
      </div>
    </div>
  );
}
