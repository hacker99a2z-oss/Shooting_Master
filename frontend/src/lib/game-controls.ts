export type Point = { x: number; y: number };
export const shortestAngle = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
export function facingTarget(movement: Point, aiming: boolean, aimAngle: number, shielding: boolean, shieldAngle: number, current: number) {
  if (aiming) return aimAngle;
  if (shielding) return shieldAngle;
  return Math.hypot(movement.x, movement.y) > 0.1 ? Math.atan2(movement.y, movement.x) : current;
}
export function joystickVector(dx: number, dy: number, radius = 45): Point {
  const distance = Math.hypot(dx, dy);
  const scale = distance > radius ? radius / distance : 1;
  return { x: dx * scale / radius, y: dy * scale / radius };
}
export function releaseShot(pointerActive: boolean, cancelled: boolean) { return pointerActive && !cancelled; }