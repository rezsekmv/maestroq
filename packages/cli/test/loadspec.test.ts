import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSpec } from "../src/load-spec.js";

let dir: string;
let oldCwd: string;

beforeEach(() => {
  // realpath: on macOS, /var/folders is a symlink to /private/var/folders
  // and resolved paths (process.cwd, our resolveSpecPath) come back canonicalized.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "maestroq-loadspec-")));
  oldCwd = process.cwd();
});

afterEach(() => {
  process.chdir(oldCwd);
  rmSync(dir, { recursive: true, force: true });
});

function writeSpec(path: string, body: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}

describe("loadSpec", () => {
  it("resolves a bare name walking up to .maestro/<name>.yaml and parses it", () => {
    const maestroDir = join(dir, ".maestro");
    mkdirSync(maestroDir, { recursive: true });
    writeFileSync(join(maestroDir, "smoke-ios.yaml"), "flows:\n  - a.yaml\nplatform: ios\n");
    const deep = join(dir, "src", "deep");
    mkdirSync(deep, { recursive: true });
    process.chdir(deep);
    const spec = loadSpec("smoke-ios");
    expect(spec.flows).toEqual(["a.yaml"]);
    expect(spec.platform).toBe("ios");
  });

  it("merges project config defaults into the spec when .maestro/maestroq.yaml exists", () => {
    const maestroDir = join(dir, ".maestro");
    mkdirSync(maestroDir, { recursive: true });
    writeFileSync(
      join(maestroDir, "maestroq.yaml"),
      "defaults:\n  rebootSimBefore: true\n  priority: 7\n",
    );
    writeFileSync(join(maestroDir, "smoke.yaml"), "flows:\n  - a.yaml\nplatform: android\n");
    process.chdir(dir);
    const spec = loadSpec("smoke");
    // Defaults fill gaps when spec omits them.
    expect(spec.rebootSimBefore).toBe(true);
    expect(spec.priority).toBe(7);
    expect(spec.cwd).toBe(dir);
  });

  it("falls back to process.cwd() when no project config is found", () => {
    const here = join(dir, "scratch");
    mkdirSync(here, { recursive: true });
    const specPath = join(here, "explicit.yaml");
    writeSpec(specPath, "flows:\n  - x.yaml\nplatform: ios\n");
    process.chdir(here);
    const spec = loadSpec("./explicit.yaml");
    expect(spec.cwd).toBe(here);
    expect(spec.flows).toEqual(["x.yaml"]);
  });

  it("explicit spec values win over project defaults", () => {
    const maestroDir = join(dir, ".maestro");
    mkdirSync(maestroDir, { recursive: true });
    writeFileSync(
      join(maestroDir, "maestroq.yaml"),
      "defaults:\n  rebootSimBefore: true\n  priority: 1\n",
    );
    writeFileSync(
      join(maestroDir, "smoke.yaml"),
      "flows:\n  - a.yaml\nplatform: ios\nrebootSimBefore: false\npriority: 99\n",
    );
    process.chdir(dir);
    const spec = loadSpec("smoke");
    expect(spec.rebootSimBefore).toBe(false);
    expect(spec.priority).toBe(99);
  });
});
