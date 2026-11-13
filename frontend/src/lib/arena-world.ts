/**
 * Battle Arena 3D world: the cleaned arena picture is projected from the
 * picture's own camera onto simple 3D stand-in surfaces (road, side fence, the
 * base at the back). The game camera slides left/right across that world.
 * Pure functions only, so the pan limits stay unit-tested.
 */

/** Pixel size of src/assets/arena-world.jpg. */
export const WORLD_IMAGE_WIDTH = 1776;
export const WORLD_IMAGE_HEIGHT = 896;
/** Picture camera focal length in pixels (about a 90° wide view). */
export const WORLD_FOCAL_PX = 888;
/** Where the road vanishes: the base's gate, in picture pixels. */
export const WORLD_VANISH_X = 1095;
export const WORLD_HORIZON_Y = 375;

/** World layout in metres. */
export const EYE_HEIGHT = 1.6;
export const BACK_WALL_DEPTH = 60;
export const LEFT_WALL_X = -50;
export const RIGHT_WALL_X = 60;
/**
 * How far the camera physically slides sideways at each end (gives the 3D depth effect).
 * It slides opposite to the pan, orbiting the base, so near road never leaves the picture.
 */
export const CAMERA_SLIDE = 1;
/** Keyboard pan speed: share of the whole picture width per second. */
export const KEY_PAN_SPEED = 0.45;

/** Frustum edges of the picture camera, as tangents (x right, y up). */
export const PICTURE_LEFT = -WORLD_VANISH_X / WORLD_FOCAL_PX;
export const PICTURE_RIGHT = (WORLD_IMAGE_WIDTH - WORLD_VANISH_X) / WORLD_FOCAL_PX;
export const PICTURE_TOP = WORLD_HORIZON_Y / WORLD_FOCAL_PX;
export const PICTURE_BOTTOM = -(WORLD_IMAGE_HEIGHT - WORLD_HORIZON_Y) / WORLD_FOCAL_PX;

export type ViewWindow = {
  /** Visible width / height in tangent units. */
  width: number;
  top: number;
  bottom: number;
  /** Allowed range of the window's left edge (tangent units). */
  minLeft: number;
  maxLeft: number;
};

/** The part of the picture a screen of this aspect (width / height) can show. */
export function viewWindow(aspect: number): ViewWindow {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.5;
  const fullWidth = PICTURE_RIGHT - PICTURE_LEFT;
  const fullHeight = PICTURE_TOP - PICTURE_BOTTOM;
  const width = fullHeight * safeAspect;
  if (width >= fullWidth) {
    // Screen wider than the picture: show the full width and crop top/bottom evenly.
    const height = fullWidth / safeAspect;
    const middle = (PICTURE_TOP + PICTURE_BOTTOM) / 2;
    return { width: fullWidth, top: middle + height / 2, bottom: middle - height / 2, minLeft: PICTURE_LEFT, maxLeft: PICTURE_LEFT };
  }
  return { width, top: PICTURE_TOP, bottom: PICTURE_BOTTOM, minLeft: PICTURE_LEFT, maxLeft: PICTURE_RIGHT - width };
}

/** Pan is 0 at the picture's left end and 1 at its right end; never beyond. */
export function clampPan(pan: number) {
  if (!Number.isFinite(pan)) return 0.5;
  return Math.min(1, Math.max(0, pan));
}

/** Left edge of the visible window for a pan value. */
export function windowLeft(view: ViewWindow, pan: number) {
  return view.minLeft + clampPan(pan) * (view.maxLeft - view.minLeft);
}

/** Pan value that starts the game looking straight at the base's gate. */
export function startPan(view: ViewWindow) {
  const range = view.maxLeft - view.minLeft;
  if (range <= 0) return 0.5;
  return clampPan((-view.width / 2 - view.minLeft) / range);
}

/** Pan change for a finger drag of dx pixels on a screen screenWidth pixels wide (world follows the finger). */
export function dragPanDelta(view: ViewWindow, dx: number, screenWidth: number) {
  const range = view.maxLeft - view.minLeft;
  if (range <= 0 || screenWidth <= 0) return 0;
  return (-dx / screenWidth) * (view.width / range);
}

/** Sideways camera position in metres for a pan value. */
export function cameraSlide(pan: number) {
  return -CAMERA_SLIDE * (2 * clampPan(pan) - 1);
}
