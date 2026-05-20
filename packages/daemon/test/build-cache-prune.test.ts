import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetCacheForTests,
  listCacheEntries,
  pruneCacheEntries,
  recordSuccessfulBuild,
} from "../src/build-cache.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-cache-prune-"));
  _resetCacheForTests(join(dir, "build-cache.json"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const A = {
  cwd: "/Users/a/proj",
  head: "aaaa1111",
  platform: "ios" as const,
  variant: "release" as const,
  envHash: "abc",
};
const B = {
  cwd: "/Users/a/proj",
  head: "aaaa1111",
  platform: "android" as const,
  variant: "release" as const,
  envHash: "abc",
};
const C = {
  cwd: "/Users/a/other",
  head: "bbbb2222",
  platform: "ios" as const,
  variant: "release" as const,
  envHash: "abc",
};

describe("listCacheEntries / pruneCacheEntries", () => {
  beforeEach(() => {
    recordSuccessfulBuild(A, "emulator-5554");
    recordSuccessfulBuild(B, "emulator-5554");
    recordSuccessfulBuild(C, "iphone-sim-x");
  });

  it("listCacheEntries returns every recorded entry with its device udid", () => {
    const list = listCacheEntries();
    expect(list).toHaveLength(3);
    const cwds = new Set(list.map((e) => e.key.cwd));
    expect(cwds).toEqual(new Set(["/Users/a/proj", "/Users/a/other"]));
    expect(list.every((e) => e.deviceUdid.length > 0)).toBe(true);
  });

  it("empty filter without `all` is a no-op (safety)", () => {
    const removed = pruneCacheEntries({});
    expect(removed).toHaveLength(0);
    expect(listCacheEntries()).toHaveLength(3);
  });

  it("all: true wipes everything", () => {
    const removed = pruneCacheEntries({}, { all: true });
    expect(removed).toHaveLength(3);
    expect(listCacheEntries()).toHaveLength(0);
  });

  it("filters by cwd", () => {
    const removed = pruneCacheEntries({ cwd: "/Users/a/proj" });
    expect(removed.map((e) => e.key.cwd)).toEqual(["/Users/a/proj", "/Users/a/proj"]);
    expect(listCacheEntries()).toHaveLength(1);
    expect(listCacheEntries()[0]?.key.cwd).toBe("/Users/a/other");
  });

  it("filters by platform", () => {
    const removed = pruneCacheEntries({ platform: "ios" });
    expect(removed).toHaveLength(2);
    expect(listCacheEntries()).toHaveLength(1);
    expect(listCacheEntries()[0]?.key.platform).toBe("android");
  });

  it("combines filters (AND)", () => {
    const removed = pruneCacheEntries({ cwd: "/Users/a/proj", platform: "ios" });
    expect(removed).toHaveLength(1);
    expect(removed[0]?.key.platform).toBe("ios");
    expect(removed[0]?.key.cwd).toBe("/Users/a/proj");
    expect(listCacheEntries()).toHaveLength(2);
  });

  it("dryRun reports matches but doesn't mutate", () => {
    const removed = pruneCacheEntries({ platform: "ios" }, { dryRun: true });
    expect(removed).toHaveLength(2);
    expect(listCacheEntries()).toHaveLength(3);
  });

  it("filters by deviceUdid", () => {
    const removed = pruneCacheEntries({ deviceUdid: "iphone-sim-x" });
    expect(removed).toHaveLength(1);
    expect(removed[0]?.deviceUdid).toBe("iphone-sim-x");
    expect(listCacheEntries()).toHaveLength(2);
  });
});
