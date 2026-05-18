import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

describe("CLI version", () => {
  it("matches packages/cli/package.json version", () => {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
    expect(VERSION).not.toBe("0.1.0");
  });
});
