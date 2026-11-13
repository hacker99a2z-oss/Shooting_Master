import { describe, expect, it } from "vitest";
import {
  EYE_HEIGHT,
  PICTURE_BOTTOM,
  PICTURE_LEFT,
  PICTURE_RIGHT,
  cameraSlide,
  clampPan,
  dragPanDelta,
  startPan,
  viewWindow,
  windowLeft,
} from "@/lib/arena-world";

// Typical Telegram phone screen, portrait.
const phone = viewWindow(390 / 760);

describe("Battle Arena world camera", () => {
  it("shows only part of the wide picture on a portrait phone, so it can pan", () => {
    expect(phone.width).toBeLessThan(PICTURE_RIGHT - PICTURE_LEFT);
    expect(phone.maxLeft).toBeGreaterThan(phone.minLeft);
  });

  it("going all the way left reaches exactly the picture's left end", () => {
    expect(windowLeft(phone, 0)).toBeCloseTo(PICTURE_LEFT, 6);
  });

  it("going all the way right reaches exactly the picture's right end", () => {
    expect(windowLeft(phone, 1) + phone.width).toBeCloseTo(PICTURE_RIGHT, 6);
  });

  it("cannot go past either end of the picture", () => {
    expect(clampPan(-0.4)).toBe(0);
    expect(clampPan(1.7)).toBe(1);
    expect(windowLeft(phone, -5)).toBeCloseTo(PICTURE_LEFT, 6);
    expect(windowLeft(phone, 5) + phone.width).toBeCloseTo(PICTURE_RIGHT, 6);
  });

  it("starts centred on the base's gate", () => {
    const left = windowLeft(phone, startPan(phone));
    expect(left + phone.width / 2).toBeCloseTo(0, 6);
  });

  it("dragging the finger right moves the view toward the left end", () => {
    expect(dragPanDelta(phone, 100, 390)).toBeLessThan(0);
  });

  it("a screen wider than the picture shows all of it with no panning", () => {
    const wide = viewWindow(2.5);
    expect(wide.width).toBeCloseTo(PICTURE_RIGHT - PICTURE_LEFT, 6);
    expect(wide.maxLeft).toBe(wide.minLeft);
  });

  it("the road right in front of the camera stays inside the picture at both ends", () => {
    const nearestDepth = EYE_HEIGHT / -PICTURE_BOTTOM;
    for (const pan of [0, 1]) {
      const left = cameraSlide(pan) + nearestDepth * windowLeft(phone, pan);
      const right = cameraSlide(pan) + nearestDepth * (windowLeft(phone, pan) + phone.width);
      expect(left).toBeGreaterThanOrEqual(nearestDepth * PICTURE_LEFT - 1e-9);
      expect(right).toBeLessThanOrEqual(nearestDepth * PICTURE_RIGHT + 1e-9);
    }
  });
});
