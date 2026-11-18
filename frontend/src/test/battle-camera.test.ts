import { describe, expect, it } from "vitest";
import { MAX_DISTANCE, VIEW_WIDTH, cameraDistance } from "@/lib/battle-camera";

describe("battle camera", () => {
  it("shows about 14 m of ground across an upright phone screen", () => {
    expect(VIEW_WIDTH).toBe(14);
    const fov = 42;
    const aspect = 420 / 760;
    const d = cameraDistance(fov, aspect);
    expect(d).toBeLessThan(MAX_DISTANCE);
    const width = 2 * d * Math.tan((fov * Math.PI) / 180 / 2) * aspect;
    expect(width).toBeCloseTo(14, 5);
  });
});
