import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobSpecSchema } from "@maestroq/core";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetCacheForTests,
  decideCache,
  gitHead,
  hashEnv,
  loadPersistedCache,
  recordSuccessfulBuild,
} from "../src/build-cache.js";

let dir: string;
let cacheDir: string;
let cachePath: string;

async function initRepo(): Promise<void> {
  await execa("git", ["init", "-q"], { cwd: dir });
  await execa("git", ["config", "user.email", "t@t"], { cwd: dir });
  await execa("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "x");
  await execa("git", ["add", "."], { cwd: dir });
  await execa("git", ["commit", "-qm", "init"], { cwd: dir });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-cache-persist-"));
  cacheDir = mkdtempSync(join(tmpdir(), "maestroq-cache-store-"));
  cachePath = join(cacheDir, "build-cache.json");
  _resetCacheForTests(cachePath);
  await initRepo();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(cacheDir, { recursive: true, force: true });
});

const specFor = () =>
  JobSpecSchema.parse({
    cwd: dir,
    flows: ["a.yaml"],
    platform: "ios",
    build: { variant: "release", cache: true },
  });

describe("build cache persistence", () => {
  it("writes the cache file after recordSuccessfulBuild", async () => {
    const head = await gitHead(dir);
    recordSuccessfulBuild(
      { cwd: dir, head, platform: "ios", variant: "release", envHash: hashEnv({}) },
      "udid-A",
    );
    expect(existsSync(cachePath)).toBe(true);
  });

  it("decideCache returns clean-hit after reloading the persisted file", async () => {
    const head = await gitHead(dir);
    recordSuccessfulBuild(
      { cwd: dir, head, platform: "ios", variant: "release", envHash: hashEnv({}) },
      "udid-A",
    );

    _resetCacheForTests(cachePath);
    const decisionBefore = await decideCache(specFor(), "release", "udid-A");
    expect(decisionBefore.reason).toBe("no-prior-build");

    loadPersistedCache(cachePath);
    const decisionAfter = await decideCache(specFor(), "release", "udid-A");
    expect(decisionAfter.use).toBe(true);
    expect(decisionAfter.reason).toBe("clean-hit");
  });

  it("starts empty when the cache file does not exist", () => {
    loadPersistedCache(join(cacheDir, "does-not-exist.json"));
    expect(existsSync(join(cacheDir, "does-not-exist.json"))).toBe(false);
  });

  it("logs a warning and starts empty when the cache file is malformed", async () => {
    writeFileSync(cachePath, "{not json");
    loadPersistedCache(cachePath);
    const decision = await decideCache(specFor(), "release", "udid-A");
    expect(decision.reason).toBe("no-prior-build");
  });
});
