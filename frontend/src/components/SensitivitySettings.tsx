import { useEffect, useState } from "react";
import { Crosshair, Settings, Shield, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { DEFAULT_SENSITIVITY, loadSensitivity, saveSensitivity, type Sensitivity } from "@/lib/sensitivity";

export function SensitivitySettings() {
  const [s, setS] = useState<Sensitivity>(DEFAULT_SENSITIVITY);
  const [open, setOpen] = useState(false);
  useEffect(() => setS(loadSensitivity()), []);
  const update = (key: keyof Sensitivity, value: number) => {
    const next = { ...s, [key]: value }; setS(next); saveSensitivity(next);
  };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="outline" size="icon" aria-label="Settings" className="h-10 w-10 rounded-full shadow-card"><Settings className="h-5 w-5" /></Button></PopoverTrigger>
    <PopoverContent side="left" align="start" sideOffset={10} collisionPadding={12} className="sensitivity-panel w-72 max-w-[calc(100vw-24px)] rounded-lg border-2 border-settings-value bg-settings-panel text-settings-ink">
      <div className="mb-6 flex items-center justify-between"><h2 className="font-display text-xl">Sensitivity</h2><Button variant="ghost" size="icon" aria-label="Close sensitivity" onClick={() => setOpen(false)}><X /></Button></div>
      <div className="space-y-6">{(["shoot", "shield"] as const).map(key => <div key={key} className="space-y-3">
        <div className="flex items-center justify-between gap-3"><label htmlFor={`sensitivity-${key}`} className="flex items-center gap-2 font-semibold">{key === "shoot" ? <Crosshair className="h-4 w-4" /> : <Shield className="h-4 w-4" />}{key === "shoot" ? "Shoot" : "Shield"}</label><output className="font-display text-xl tabular-nums text-settings-value">{s[key]}%</output></div>
        <Slider id={`sensitivity-${key}`} min={0} max={100} step={1} value={[s[key]]} onValueChange={([value])=>update(key,value ?? 0)} aria-label={`${key} sensitivity`} />
      </div>)}</div>
    </PopoverContent>
  </Popover>;
}
