import { useEffect, useRef } from "react";
import { Shield, Target } from "lucide-react";

/** Raw input written by the joystick, shield button, keyboard and the finger/mouse on the map. */
export type ControlState = {
  stick: { x: number; y: number };
  keys: Set<string>;
  /** Finger / mouse on the map, in normalised device coordinates. */
  pointerDown: boolean;
  pointerId: number | null;
  ndcX: number;
  ndcY: number;
  /** The press has been seen by at least one frame (so a quick tap still aims, then fires). */
  pressSeen: boolean;
  releaseQueued: boolean;
  /** The shield button is held down (the shield is up only while this is true). */
  shieldHeld: boolean;
  /** Unit direction the finger has slid on the shield button (y = screen down), or null to keep facing. */
  shieldAim: { x: number; y: number } | null;
};

export function createControls(): ControlState {
  return { stick: { x: 0, y: 0 }, keys: new Set(), pointerDown: false, pointerId: null, ndcX: 0, ndcY: 0, pressSeen: false, releaseQueued: false, shieldHeld: false, shieldAim: null };
}

const KNOB_TRAVEL = 46;
/** Pixels the finger must slide on the shield button before it starts turning the shield. */
const SHIELD_SLIDE_DEAD_ZONE = 12;

/** Direction of a slide on the shield button, or null inside the small dead zone. */
export function shieldSlideDirection(dx: number, dy: number) {
  const len = Math.hypot(dx, dy);
  if (len < SHIELD_SLIDE_DEAD_ZONE) return null;
  return { x: dx / len, y: dy / len };
}

/** Hold to raise the shield; slide the same finger left / right (any way) to turn it. */
function ShieldButton({ controls, shieldOn }: { controls: ControlState; shieldOn: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let pointer: number | null = null;
    let startX = 0;
    let startY = 0;
    const down = (e: PointerEvent) => {
      if (pointer !== null) return;
      pointer = e.pointerId;
      el.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      controls.shieldHeld = true;
      controls.shieldAim = null;
      e.preventDefault();
      e.stopPropagation();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      const dir = shieldSlideDirection(e.clientX - startX, e.clientY - startY);
      if (dir) controls.shieldAim = dir;
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      controls.shieldHeld = false;
      controls.shieldAim = null;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      controls.shieldHeld = false;
      controls.shieldAim = null;
    };
  }, [controls]);

  return (
    <button
      ref={ref}
      type="button"
      className="battle-shield-button"
      data-on={shieldOn ? "true" : undefined}
      aria-pressed={shieldOn}
      aria-label="Hold to raise the shield, slide to turn it"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Shield className="battle-shield-icon" strokeWidth={2.4} />
      <span className="battle-shield-label">Shield</span>
    </button>
  );
}

/** Joystick vector with a small dead zone, length ≤ 1 (y = screen down). */
export function joystickVector(dx: number, dy: number, travel: number) {
  const len = Math.hypot(dx, dy);
  if (len < travel * 0.12) return { x: 0, y: 0 };
  const k = Math.min(1, len / travel) / len;
  return { x: dx * k, y: dy * k };
}

function Joystick({ controls }: { controls: ControlState }) {
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
      controls.stick = joystickVector(dx, dy, KNOB_TRAVEL);
    };
    const down = (e: PointerEvent) => {
      if (pointer !== null) return;
      pointer = e.pointerId;
      base.setPointerCapture(e.pointerId);
      base.dataset["active"] = "true";
      update(e);
      e.preventDefault();
      e.stopPropagation();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === pointer) update(e);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      delete base.dataset["active"];
      knob.style.transform = "translate(0px, 0px)";
      controls.stick = { x: 0, y: 0 };
    };
    base.addEventListener("pointerdown", down);
    base.addEventListener("pointermove", move);
    base.addEventListener("pointerup", up);
    base.addEventListener("pointercancel", up);
    return () => {
      base.removeEventListener("pointerdown", down);
      base.removeEventListener("pointermove", move);
      base.removeEventListener("pointerup", up);
      base.removeEventListener("pointercancel", up);
    };
  }, [controls]);

  return (
    <div ref={baseRef} className="battle-joystick" aria-label="Move joystick" role="application">
      <div ref={knobRef} className="battle-joystick-knob" />
    </div>
  );
}

/**
 * Joystick bottom-left, Shield button bottom-right (held = shield up). Touch/click on the
 * map aims the bow (let go to shoot) or turns the raised shield.
 * Keyboard: WASD / arrows move, hold E / Space / Shift for the shield.
 */
export function BattleControls({ controls, shieldOn }: { controls: ControlState; shieldOn: boolean }) {
  useEffect(() => {
    const moveKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    const shieldKeys = ["KeyE", "Space", "ShiftLeft", "KeyK"];
    const onDown = (e: KeyboardEvent) => {
      if (moveKeys.includes(e.code) || shieldKeys.includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      controls.keys.add(e.code);
    };
    const onUp = (e: KeyboardEvent) => controls.keys.delete(e.code);
    const clear = () => controls.keys.clear();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", clear);
    };
  }, [controls]);

  return (
    <div className="battle-controls">
      <Joystick controls={controls} />
      <p className="battle-hint" aria-hidden="true">
        <Target className="h-3.5 w-3.5" />
        {shieldOn ? "Slide left or right to turn your shield" : "Touch the map to aim, let go to shoot"}
      </p>
      <ShieldButton controls={controls} shieldOn={shieldOn} />
    </div>
  );
}
