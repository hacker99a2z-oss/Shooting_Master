import { describe, expect, it } from "vitest";
import { loadSensitivity, saveSensitivity, sensFactor } from "@/lib/sensitivity";
describe("shoot and shield sensitivity", () => {
  it("shoot and shield have independent saved values", () => {
    saveSensitivity({shoot:100,shield:0});
    expect(loadSensitivity()).toEqual({shoot:100,shield:0});
    expect(sensFactor(loadSensitivity().shoot)).toBe(2);
    expect(sensFactor(loadSensitivity().shield)).toBe(0.1);
  });
});