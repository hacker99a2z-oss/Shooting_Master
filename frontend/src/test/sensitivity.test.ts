import { beforeEach, describe, expect, it } from "vitest";
import { loadSensitivity, saveSensitivity, sensFactor } from "@/lib/sensitivity";
describe("archery aim sensitivity", () => {
  beforeEach(() => localStorage.clear());
  it("saves a single archery aim value", () => {
    saveSensitivity({ aim: 100 });
    expect(loadSensitivity()).toEqual({ aim: 100 });
    expect(sensFactor(loadSensitivity().aim)).toBe(2);
  });
  it("0% aim is the slowest setting", () => {
    saveSensitivity({ aim: 0 });
    expect(sensFactor(loadSensitivity().aim)).toBe(0.1);
  });
  it("reuses the old shoot sensitivity once for existing players", () => {
    localStorage.setItem("control-sensitivity", JSON.stringify({ shoot: 80, shield: 10 }));
    expect(loadSensitivity()).toEqual({ aim: 80 });
  });
});
