import { describe, expect, it } from "vitest";
import {
  CAMERA_BACK,
  CAMERA_FOV,
  CAMERA_HEIGHT,
  CAMERA_LOOK_AHEAD,
  CAMERA_LOOK_HEIGHT,
  EYE_HEIGHT,
  PICTURE_BOTTOM,
} from "@/lib/arena-world";
import { ARENA_NEAR_Z } from "@/lib/arena-hero";

describe("Battle Arena follow camera", () => {
  it("sits behind and above the hero, looking ahead of him", () => {
    expect(CAMERA_BACK).toBeGreaterThan(0);
    expect(CAMERA_HEIGHT).toBeGreaterThan(CAMERA_LOOK_HEIGHT);
    expect(CAMERA_LOOK_AHEAD).toBeGreaterThan(0);
  });

  it("with the hero at the nearest spot, the road at the screen bottom is still inside the arena picture", () => {
    const pitch = Math.atan((CAMERA_HEIGHT - CAMERA_LOOK_HEIGHT) / (CAMERA_BACK + CAMERA_LOOK_AHEAD));
    const bottomRay = pitch + ((CAMERA_FOV / 2) * Math.PI) / 180;
    const groundAhead = CAMERA_HEIGHT / Math.tan(bottomRay);
    const groundZ = ARENA_NEAR_Z + CAMERA_BACK - groundAhead;
    // The picture covers the road from this depth outward.
    const pictureNearestDepth = EYE_HEIGHT / -PICTURE_BOTTOM;
    expect(-groundZ).toBeGreaterThan(pictureNearestDepth);
  });
});
