import { describe, expect, it } from "vitest";
import { parseWatchInterval } from "../src/parse-interval.js";

describe("parseWatchInterval", () => {
  it("returns 2_000 when input is undefined or empty", () => {
    expect(parseWatchInterval(undefined)).toBe(2_000);
    expect(parseWatchInterval("")).toBe(2_000);
  });

  it("converts seconds to ms", () => {
    expect(parseWatchInterval("5")).toBe(5_000);
    expect(parseWatchInterval("2")).toBe(2_000);
    expect(parseWatchInterval("10")).toBe(10_000);
  });

  it("floors at 500ms", () => {
    expect(parseWatchInterval("0.1")).toBe(500);
    expect(parseWatchInterval("0.4")).toBe(500);
    expect(parseWatchInterval("0.5")).toBe(500);
  });

  it("falls back to default for non-positive or invalid input", () => {
    expect(parseWatchInterval("0")).toBe(2_000);
    expect(parseWatchInterval("-1")).toBe(2_000);
    expect(parseWatchInterval("abc")).toBe(2_000);
    expect(parseWatchInterval("NaN")).toBe(2_000);
  });

  it("handles fractional seconds above the floor", () => {
    expect(parseWatchInterval("1.5")).toBe(1_500);
    expect(parseWatchInterval("0.75")).toBe(750);
  });
});
