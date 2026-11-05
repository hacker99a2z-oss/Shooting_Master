import { useEffect, useState } from "react";
import { Crosshair, Settings, Shield } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { DEFAULT_SENSITIVITY, loadSensitivity, saveSensitivity, type Sensitivity } from "@/lib/sensitivity";

export function SensitivitySettings() {
  const [s, setS] = useState<Sensitivity>(DEFAULT_SENSITIVITY);
  useEffect(() => setS(loadSensitivity()), []);
  const update = (k: keyof Sensitivity, v: number) => {
    const next = { ...s, [k]: v };
    setS(next);
    saveSensitivity(next);
  };
  const row = (k: keyof Sensitivity, label: string, icon: React.ReactNode) => (
    <div key={k} className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium">{icon}{label}</span>
        <span className="font-display tabular-nums text-primary">{s[k]}%</span>
      </div>
      <Slider min={0} max={100} step={1} value={[s[k]]} onValueChange={([v]) => update(k, v ?? 0)} aria-label={`${label} sensitivity`} />
    </div>
  );
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button aria-label="Settings" className="flex h-10 w-10 items-center justify-center rounded-full border bg-card text-card-foreground shadow-card active:scale-90 transition-transform">
          <Settings className="h-5 w-5" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Sensitivity</DialogTitle></DialogHeader>
        <div className="space-y-6 pt-2">
          {row("shield", "Shield", <Shield className="h-4 w-4 text-primary" />)}
          {row("shoot", "Shoot", <Crosshair className="h-4 w-4 text-primary" />)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
