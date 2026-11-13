/**
 * Battle Arena 3D world: the cleaned arena picture is projected from the
 * picture's own camera onto simple 3D stand-in surfaces (road, side fence, the
 * base at the back). A third-person camera follows the hero across that world.
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
/** Frustum edges of the picture camera, as tangents (x right, y up). */
export const PICTURE_LEFT = -WORLD_VANISH_X / WORLD_FOCAL_PX;
export const PICTURE_RIGHT = (WORLD_IMAGE_WIDTH - WORLD_VANISH_X) / WORLD_FOCAL_PX;
export const PICTURE_TOP = WORLD_HORIZON_Y / WORLD_FOCAL_PX;
export const PICTURE_BOTTOM = -(WORLD_IMAGE_HEIGHT - WORLD_HORIZON_Y) / WORLD_FOCAL_PX;

/** Third-person follow camera, relative to the hero (metres). */
export const CAMERA_FOV = 60;
export const CAMERA_HEIGHT = 2.9;
export const CAMERA_BACK = 4.4;
/** Camera sits a little to the hero's right so the gun arm stays in view. */
export const CAMERA_SIDE = 0.45;
export const CAMERA_LOOK_HEIGHT = 1.0;
export const CAMERA_LOOK_AHEAD = 5;
/** How quickly the camera catches up with the hero (per second). */
export const CAMERA_FOLLOW_RATE = 6;
