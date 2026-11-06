import { useEffect, useState } from "react";
import { Settings, Target, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { DEFAULT_SENSITIVITY, loadSensitivity, saveSensitivity, type Sensitivity } from "@/lib/sensitivity";

// Sensitivity now only controls archery aiming (how far the sight moves per finger drag).
export function SensitivitySettings() {
  const [s, setS] = useState<Sensitivity>(DEFAULT_SENSITIVITY);
  const [open, setOpen] = useState(false);
  useEffect(() => setS(loadSensitivity()), []);
  const update = (value: number) => {
    const next = { aim: value }; setS(next); saveSensitivity(next);
  };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="outline" size="icon" aria-label="Settings" className="h-10 w-10 rounded-full shadow-card"><Settings className="h-5 w-5" /></Button></PopoverTrigger>
    <PopoverContent side="left" align="start" sideOffset={10} collisionPadding={12} className="sensitivity-panel w-72 max-w-[calc(100vw-24px)] rounded-lg border-2 border-settings-value bg-settings-panel text-settings-ink">
      <div className="mb-6 flex items-center justify-between"><h2 className="font-display text-xl">Sensitivity</h2><Button variant="ghost" size="icon" aria-label="Close sensitivity" onClick={() => setOpen(false)}><X /></Button></div>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3"><label htmlFor="sensitivity-aim" className="flex items-center gap-2 font-semibold"><Target className="h-4 w-4" />Archery aim</label><output className="font-display text-xl tabular-nums text-settings-value">{s.aim}%</output></div>
        <Slider id="sensitivity-aim" min={0} max={100} step={1} value={[s.aim]} onValueChange={([value]) => update(value ?? 0)} aria-label="Archery aim sensitivity" />
        <p className="text-xs opacity-80">Higher = the sight moves farther when you drag.</p>
      </div>
    </PopoverContent>
  </Popover>;
}
