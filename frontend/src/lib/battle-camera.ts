/**
 * Battle Arena camera: a high, tilted MOBA view that follows the hero and stops
 * at the map edge so the area outside the walls never fills the screen.
 */
import { MAP_HALF } from "@/lib/battle-rules";

/** Camera tilt above the ground (radians): 56°. */
export const CAMERA_PITCH = (56 * Math.PI) / 180;
/** Ground width (metres) visible across the screen on a phone held upright. */
export const VIEW_WIDTH = 15;
export const MIN_DISTANCE = 18;
export const MAX_DISTANCE = 40;
/** How much of the wooden wall / forest may show past the map edge (metres). */
export const EDGE_MARGIN = 3;

/** Distance from the hero so about VIEW_WIDTH metres of ground fit across the screen. */
export function cameraDistance(fovDeg: number, aspect: number) {
  const halfV = Math.tan((fovDeg * Math.PI) / 180 / 2);
  const d = VIEW_WIDTH / 2 / (halfV * aspect);
  return Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, d));
}

/** How far from the centre the camera focus may go before the view would leave the map. */
export function cameraFocusLimit(fovDeg: number, aspect: number, distance: number) {
  const halfV = Math.tan((fovDeg * Math.PI) / 180 / 2);
  const halfW = distance * halfV * aspect;
  // Ground distance seen above / below the focus point along the tilted view.
  const a = (fovDeg * Math.PI) / 180 / 2;
  const up = (distance * Math.sin(a)) / Math.sin(CAMERA_PITCH - a);
  const down = (distance * Math.sin(a)) / Math.sin(CAMERA_PITCH + a);
  const lim = (v: number) => Math.max(0, MAP_HALF + EDGE_MARGIN - v);
  return { x: lim(halfW), zTop: lim(up), zBottom: lim(down) };
}
