import { describe, expect, it } from "vitest";
import { colorMode } from "../src/color-mode.js";

describe("colorMode", () => {
  it("maps undefined / empty / true to auto", () => {
    expect(colorMode(undefined)).toBe("auto");
    expect(colorMode("")).toBe("auto");
    expect(colorMode(true)).toBe("auto");
  });

  it("maps false to never", () => {
    expect(colorMode(false)).toBe("never");
  });

  it("maps 'always' aliases to always (case-insensitive)", () => {
    expect(colorMode("always")).toBe("always");
    expect(colorMode("ALWAYS")).toBe("always");
    expect(colorMode("yes")).toBe("always");
    expect(colorMode("true")).toBe("always");
    expect(colorMode("on")).toBe("always");
  });

  it("maps 'never' aliases to never (case-insensitive)", () => {
    expect(colorMode("never")).toBe("never");
    expect(colorMode("NEVER")).toBe("never");
    expect(colorMode("no")).toBe("never");
    expect(colorMode("false")).toBe("never");
    expect(colorMode("off")).toBe("never");
  });

  it("falls back to auto for unrecognized strings", () => {
    expect(colorMode("auto")).toBe("auto");
    expect(colorMode("bogus")).toBe("auto");
  });
});
