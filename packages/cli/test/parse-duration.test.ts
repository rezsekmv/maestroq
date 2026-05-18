import { describe, expect, it } from "vitest";
import { parseDuration } from "../src/since.js";

describe("parseDuration", () => {
  it("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("0s")).toBe(0);
  });
  it("parses minutes", () => {
    expect(parseDuration("30m")).toBe(30 * 60_000);
  });
  it("parses hours", () => {
    expect(parseDuration("2h")).toBe(2 * 3_600_000);
  });
  it("parses days", () => {
    expect(parseDuration("7d")).toBe(7 * 86_400_000);
  });
  it("defaults to seconds when unit omitted", () => {
    expect(parseDuration("45")).toBe(45_000);
  });
  it("returns undefined for invalid input", () => {
    expect(parseDuration("bogus")).toBeUndefined();
    expect(parseDuration("7y")).toBeUndefined();
    expect(parseDuration("")).toBeUndefined();
  });
});
