import { useEffect, useRef } from "react";
import { joystickVector, type Stick } from "@/lib/arena-hero";

/** Input written by the on-screen controls and keyboard, read every frame by the game loop. */
export type ArenaInput = {
  stick: Stick;
  keys: Set<string>;
  shootHeld: boolean;
  shieldHeld: boolean;
  /** Set when the shoot button is let go; the game loop fires and clears it. */
  fireQueued: boolean;
};

export function createArenaInput(): ArenaInput {
  return { stick: { x: 0, y: 0 }, keys: new Set(), shootHeld: false, shieldHeld: false, fireQueued: false };
}

const KNOB_TRAVEL = 46;

function Joystick({ input }: { input: ArenaInput }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const base = baseRef.current;
    const knob = knobRef.current;
    if (!base || !knob) return;
    let pointer: number | null = null;
    const update = (e: PointerEvent) => {
      const rect = base.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const len = Math.hypot(dx, dy);
      const k = len > KNOB_TRAVEL ? KNOB_TRAVEL / len : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      input.stick = joystickVector(dx, dy, KNOB_TRAVEL);
    };
    const onDown = (e: PointerEvent) => {
      if (pointer !== null) return;
      pointer = e.pointerId;
      base.setPointerCapture(e.pointerId);
      base.dataset["active"] = "true";
      update(e);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === pointer) update(e);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      delete base.dataset["active"];
      knob.style.transform = "translate(0px, 0px)";
      input.stick = { x: 0, y: 0 };
    };
    base.addEventListener("pointerdown", onDown);
    base.addEventListener("pointermove", onMove);
    base.addEventListener("pointerup", onUp);
    base.addEventListener("pointercancel", onUp);
    return () => {
      base.removeEventListener("pointerdown", onDown);
      base.removeEventListener("pointermove", onMove);
      base.removeEventListener("pointerup", onUp);
      base.removeEventListener("pointercancel", onUp);
    };
  }, [input]);

  return (
    <div ref={baseRef} className="arena-joystick" aria-label="Move joystick" role="application">
      <span className="arena-joystick-arrow arena-joystick-arrow-up" />
      <span className="arena-joystick-arrow arena-joystick-arrow-down" />
      <span className="arena-joystick-arrow arena-joystick-arrow-left" />
      <span className="arena-joystick-arrow arena-joystick-arrow-right" />
      <div ref={knobRef} className="arena-joystick-knob" />
    </div>
  );
}

/** A button that stays "held" while a finger is on it (tracks its own pointer). */
function HoldButton({ className, label, onHold, onRelease, children }: { className: string; label: string; onHold: () => void; onRelease: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const handlers = useRef({ onHold, onRelease });
  handlers.current = { onHold, onRelease };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let pointer: number | null = null;
    const down = (e: PointerEvent) => {
      if (pointer !== null) return;
      pointer = e.pointerId;
      el.setPointerCapture(e.pointerId);
      el.dataset["active"] = "true";
      handlers.current.onHold();
      e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      delete el.dataset["active"];
      handlers.current.onRelease();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, []);

  return (
    <button ref={ref} type="button" className={className} aria-label={label} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </button>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 48 48" className="arena-button-icon" aria-hidden>
      <path d="M24 4 L40 10 V22 C40 33 33 40 24 44 C15 40 8 33 8 22 V10 Z" fill="currentColor" opacity="0.95" />
      <path d="M24 9 L35 13.5 V22 C35 30 30 35.5 24 38.5 Z" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

function BulletIcon() {
  return (
    <svg viewBox="0 0 48 48" className="arena-button-icon" aria-hidden>
      <g transform="rotate(45 24 24)">
        <path d="M24 3 C29 9 30 14 30 19 V33 H18 V19 C18 14 19 9 24 3 Z" fill="currentColor" />
        <rect x="16.5" y="34.5" width="15" height="5" rx="1.5" fill="currentColor" opacity="0.8" />
        <rect x="18" y="41" width="12" height="4" rx="1.5" fill="currentColor" opacity="0.6" />
      </g>
    </svg>
  );
}

/** Joystick bottom-left; Shield and Shoot bottom-right. Keyboard: WASD/arrows, Space/J shoot, K/E shield. */
export function ArenaControls({ input }: { input: ArenaInput }) {
  useEffect(() => {
    const shootKeys = ["Space", "KeyJ"];
    const shieldKeys = ["KeyK", "KeyE", "ShiftLeft"];
    const moveKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (moveKeys.includes(e.code) || shootKeys.includes(e.code)) e.preventDefault();
      input.keys.add(e.code);
      if (shootKeys.includes(e.code)) input.shootHeld = true;
      if (shieldKeys.includes(e.code)) input.shieldHeld = true;
    };
    const onUp = (e: KeyboardEvent) => {
      input.keys.delete(e.code);
      if (shootKeys.includes(e.code) && input.shootHeld) {
        input.shootHeld = false;
        input.fireQueued = true;
      }
      if (shieldKeys.includes(e.code)) input.shieldHeld = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [input]);

  return (
    <div className="arena-controls">
      <Joystick input={input} />
      <HoldButton
        className="arena-shield-button"
        label="Shield"
        onHold={() => (input.shieldHeld = true)}
        onRelease={() => (input.shieldHeld = false)}
      >
        <ShieldIcon />
      </HoldButton>
      <HoldButton
        className="arena-shoot-button"
        label="Shoot"
        onHold={() => (input.shootHeld = true)}
        onRelease={() => {
          input.shootHeld = false;
          input.fireQueued = true;
        }}
      >
        <BulletIcon />
      </HoldButton>
    </div>
  );
}

/** Merge keyboard keys into the stick (keyboard wins when any move key is held). */
export function mergedStick(input: ArenaInput): Stick {
  const k = input.keys;
  const x = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
  const y = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
  if (!x && !y) return input.stick;
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
}
