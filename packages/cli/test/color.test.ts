import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { colorExit, colorStatus, paint, resolveUseColor } from "../src/color.js";

const fakeStream = (isTTY: boolean): NodeJS.WriteStream =>
  ({ isTTY } as unknown as NodeJS.WriteStream);

const env: NodeJS.ProcessEnv = {};

beforeEach(() => {
  env.NO_COLOR = process.env.NO_COLOR;
  env.FORCE_COLOR = process.env.FORCE_COLOR;
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
});

afterEach(() => {
  if (env.NO_COLOR !== undefined) process.env.NO_COLOR = env.NO_COLOR;
  if (env.FORCE_COLOR !== undefined) process.env.FORCE_COLOR = env.FORCE_COLOR;
});

describe("resolveUseColor", () => {
  it("always means yes", () => {
    expect(resolveUseColor("always", fakeStream(false))).toBe(true);
  });

  it("never means no", () => {
    expect(resolveUseColor("never", fakeStream(true))).toBe(false);
  });

  it("auto returns true on TTY", () => {
    expect(resolveUseColor("auto", fakeStream(true))).toBe(true);
  });

  it("auto returns false off-TTY", () => {
    expect(resolveUseColor("auto", fakeStream(false))).toBe(false);
  });

  it("NO_COLOR forces no even on TTY", () => {
    process.env.NO_COLOR = "1";
    expect(resolveUseColor("auto", fakeStream(true))).toBe(false);
  });

  it("FORCE_COLOR=1 forces yes off-TTY", () => {
    process.env.FORCE_COLOR = "1";
    expect(resolveUseColor("auto", fakeStream(false))).toBe(true);
  });
});

describe("colorStatus", () => {
  it("maps terminal statuses to expected colors", () => {
    expect(colorStatus("succeeded")).toBe("green");
    expect(colorStatus("failed")).toBe("red");
    expect(colorStatus("cancelled")).toBe("gray");
  });
  it("maps in-flight to yellow and queued to cyan", () => {
    expect(colorStatus("running")).toBe("yellow");
    expect(colorStatus("queued")).toBe("cyan");
  });
});

describe("colorExit", () => {
  it("returns green for 0, red for non-zero, null for missing", () => {
    expect(colorExit(0)).toBe("green");
    expect(colorExit(1)).toBe("red");
    expect(colorExit(143)).toBe("red");
    expect(colorExit(undefined)).toBeNull();
  });
});

describe("paint", () => {
  it("wraps in ANSI codes", () => {
    expect(paint("hi", "green")).toBe("\x1b[32mhi\x1b[0m");
  });
  it("passes through when color is null", () => {
    expect(paint("hi", null)).toBe("hi");
  });
});
