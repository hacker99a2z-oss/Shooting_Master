import { describe, expect, it } from "vitest";
import { rawQueryValues, secretMatches } from "../../../backend/adsgram-secret";

const keys = (url: string) => rawQueryValues(new URL(url).search, "key");

describe("AdsGram reward secret check", () => {
  it("accepts the exact same code", () => expect(secretMatches(keys("https://x.dev/r?userid=1&key=Abc123"), "Abc123")).toBe(true));
  it("accepts a code with + that the URL turns into a space", () => expect(secretMatches(keys("https://x.dev/r?userid=1&key=ab+cd"), "ab+cd")).toBe(true));
  it("accepts a code sent URL-encoded", () => expect(secretMatches(keys("https://x.dev/r?userid=1&key=ab%2Bcd%2F%3D"), "ab+cd/=")).toBe(true));
  it("ignores spaces, newlines and quotes pasted around the server value", () => expect(secretMatches(keys("https://x.dev/r?key=Abc123"), '  "Abc123"\n')).toBe(true));
  it("ignores spaces pasted around the URL value", () => expect(secretMatches(keys("https://x.dev/r?key=%20Abc123%20"), "Abc123")).toBe(true));
  it("still rejects a different code", () => expect(secretMatches(keys("https://x.dev/r?key=Abc124"), "Abc123")).toBe(false));
  it("still rejects a missing code", () => expect(secretMatches(keys("https://x.dev/r?userid=1"), "Abc123")).toBe(false));
  it("rejects when the server has no code", () => expect(secretMatches(keys("https://x.dev/r?key="), "")).toBe(false));
});
