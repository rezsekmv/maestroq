import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobSpecSchema } from "@maestroq/core";
import {
  _resetCacheForTests,
  decideCache,
  gitHead,
  hashEnv,
  recordSuccessfulBuild,
} from "../src/build-cache.js";

let dir: string;

async function initRepo(): Promise<void> {
  await execa("git", ["init", "-q"], { cwd: dir });
  await execa("git", ["config", "user.email", "t@t"], { cwd: dir });
  await execa("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "x");
  await execa("git", ["add", "."], { cwd: dir });
  await execa("git", ["commit", "-qm", "init"], { cwd: dir });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-cache-"));
  _resetCacheForTests();
  await initRepo();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const specFor = (overrides: { cache?: boolean } = {}) =>
  JobSpecSchema.parse({
    cwd: dir,
    flows: ["a.yaml"],
    platform: "ios",
    build: { variant: "release", cache: overrides.cache ?? true },
  });

describe("decideCache", () => {
  it("returns no-prior-build on first call against a clean tree", async () => {
    const decision = await decideCache(specFor(), "release", "udid-A");
    expect(decision.use).toBe(false);
    expect(decision.reason).toBe("no-prior-build");
    expect(decision.key?.head).toBe(await gitHead(dir));
  });

  it("returns clean-hit after a recorded build with the same key", async () => {
    const head = await gitHead(dir);
    recordSuccessfulBuild(
      { cwd: dir, head, platform: "ios", variant: "release", envHash: hashEnv({}) },
      "udid-A",
    );
    const decision = await decideCache(specFor(), "release", "udid-A");
    expect(decision.use).toBe(true);
    expect(decision.reason).toBe("clean-hit");
  });

  it("bypasses cache when working tree is dirty even with a matching prior build", async () => {
    const head = await gitHead(dir);
    recordSuccessfulBuild(
      { cwd: dir, head, platform: "ios", variant: "release", envHash: hashEnv({}) },
      "udid-A",
    );
    writeFileSync(join(dir, "README.md"), "dirty");
    const decision = await decideCache(specFor(), "release", "udid-A");
    expect(decision.use).toBe(false);
    expect(decision.reason).toBe("dirty-tree");
  });

  it("returns cache-disabled when spec opts out", async () => {
    const decision = await decideCache(specFor({ cache: false }), "release", "udid-A");
    expect(decision.use).toBe(false);
    expect(decision.reason).toBe("cache-disabled");
  });

  it("scopes cache by device UDID", async () => {
    const head = await gitHead(dir);
    recordSuccessfulBuild(
      { cwd: dir, head, platform: "ios", variant: "release", envHash: hashEnv({}) },
      "udid-A",
    );
    const decision = await decideCache(specFor(), "release", "udid-B");
    expect(decision.use).toBe(false);
    expect(decision.reason).toBe("no-prior-build");
  });
});
