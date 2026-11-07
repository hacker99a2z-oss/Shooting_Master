// The uploaded reference art already contains the miner, mine cart, cave and gold.
// This component adds subtle light and flying-gold motion without replacing that artwork.
export function GoldMiner({ mining }: { mining: boolean }) {
  return (
    <div className={`reference-miner-fx ${mining ? "is-mining" : ""}`} aria-hidden="true">
      <span className="reference-impact-glow" />
      <span className="reference-gold-spark s1" />
      <span className="reference-gold-spark s2" />
      <span className="reference-gold-spark s3" />
      <span className="reference-gold-spark s4" />
    </div>
  );
}
