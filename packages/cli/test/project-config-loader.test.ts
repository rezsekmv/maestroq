import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findProjectConfig,
  mergeProjectConfigIntoSpec,
  resolveSpecPath,
} from "../src/project-config-loader.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-projcfg-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeProjectConfig(root: string, body: string): string {
  const maestroDir = join(root, ".maestro");
  mkdirSync(maestroDir, { recursive: true });
  const path = join(maestroDir, "maestroq.yaml");
  writeFileSync(path, body);
  return path;
}

describe("findProjectConfig", () => {
  it("walks up to find .maestro/maestroq.yaml", () => {
    writeProjectConfig(dir, "defaults:\n  rebootSimBefore: true\n");
    const deep = join(dir, "src", "deep", "nested");
    mkdirSync(deep, { recursive: true });
    const found = findProjectConfig(deep);
    expect(found).not.toBeNull();
    expect(found?.dir).toBe(dir);
    expect(found?.config.defaults?.rebootSimBefore).toBe(true);
  });

  it("returns null when no project config exists anywhere up the tree", () => {
    expect(findProjectConfig(dir)).toBeNull();
  });
});

describe("mergeProjectConfigIntoSpec", () => {
  it("spec values always win over project defaults", () => {
    writeProjectConfig(
      dir,
      "defaults:\n  rebootSimBefore: true\n  priority: 5\n",
    );
    const found = findProjectConfig(dir);
    if (!found) throw new Error("expected project config");
    const merged = mergeProjectConfigIntoSpec(
      {
        flows: ["a.yaml"],
        platform: "ios",
        rebootSimBefore: false, // spec wins
        priority: 10,           // spec wins
      },
      found,
    );
    expect(merged.rebootSimBefore).toBe(false);
    expect(merged.priority).toBe(10);
  });

  it("fills gaps from project defaults when spec omits them", () => {
    writeProjectConfig(
      dir,
      "defaults:\n  rebootSimBefore: true\n  build:\n    variant: debug\n",
    );
    const found = findProjectConfig(dir);
    if (!found) throw new Error("expected project config");
    const merged = mergeProjectConfigIntoSpec(
      { flows: ["a.yaml"], platform: "ios" },
      found,
    );
    expect(merged.rebootSimBefore).toBe(true);
    expect(merged.build).toEqual({ variant: "debug" });
  });

  it("defaults cwd to the project config's directory when neither spec nor config specifies one", () => {
    writeProjectConfig(dir, "defaults: {}\n");
    const found = findProjectConfig(dir);
    if (!found) throw new Error("expected project config");
    const merged = mergeProjectConfigIntoSpec(
      { flows: ["a.yaml"], platform: "ios" },
      found,
    );
    expect(merged.cwd).toBe(dir);
  });

  it("resolves a relative cwd in project config against the config file's dir", () => {
    writeProjectConfig(dir, "cwd: ./packages/app\n");
    const found = findProjectConfig(dir);
    if (!found) throw new Error("expected project config");
    const merged = mergeProjectConfigIntoSpec(
      { flows: ["a.yaml"], platform: "ios" },
      found,
    );
    expect(merged.cwd).toBe(join(dir, "packages", "app"));
  });

  it("merges env with spec values winning per-key", () => {
    writeProjectConfig(
      dir,
      "defaults:\n  env:\n    FOO: project\n    BAR: project\n",
    );
    const found = findProjectConfig(dir);
    if (!found) throw new Error("expected project config");
    const merged = mergeProjectConfigIntoSpec(
      {
        flows: ["a.yaml"],
        platform: "ios",
        env: { BAR: "spec", BAZ: "spec" },
      },
      found,
    );
    expect(merged.env).toEqual({ FOO: "project", BAR: "spec", BAZ: "spec" });
  });
});

describe("resolveSpecPath", () => {
  it("resolves a bare name against .maestro/<name>.yaml walking up", () => {
    const maestroDir = join(dir, ".maestro");
    mkdirSync(maestroDir, { recursive: true });
    writeFileSync(join(maestroDir, "smoke-ios.yaml"), "flows: [a]\nplatform: ios\n");
    const deep = join(dir, "src", "deep");
    mkdirSync(deep, { recursive: true });
    expect(resolveSpecPath("smoke-ios", deep)).toBe(
      join(maestroDir, "smoke-ios.yaml"),
    );
  });

  it("returns an explicit relative path unchanged when it contains a slash", () => {
    expect(resolveSpecPath("./foo/bar.yaml", dir)).toBe(join(dir, "foo", "bar.yaml"));
  });
});
