import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/lifecycle/build.js";

let dir: string;
let argsFile: string;
let oldPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-build-"));
  argsFile = join(dir, "args.txt");
  oldPath = process.env.PATH;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (oldPath !== undefined) process.env.PATH = oldPath;
});

function installFakeNpx(body: string): void {
  const path = join(dir, "npx");
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\nprintf '%s' "$METRO_CACHE_ROOT" > "${join(dir, "metro_cache_root.txt")}"\n${body}\n`,
  );
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
}

describe("buildApp", () => {
  it("spawns npx detached so child pid === pgid (own process group)", async () => {
    installFakeNpx(`
echo "BUILD_MARKER_LINE"
sleep 0.5
exit 0
`);
    const spec = JobSpecSchema.parse({
      cwd: dir,
      flows: ["a.yaml"],
      platform: "ios",
      build: { variant: "debug", cache: false },
    });

    let observedPid: number | undefined;
    let pgidOfChild: number | undefined;
    const sink: string[] = [];

    await buildApp({
      spec,
      device: { udid: "fake-udid", platform: "ios" },
      variant: "debug",
      logSink: (l) => sink.push(l),
      onChildStart: (pid) => {
        observedPid = pid;
        try {
          pgidOfChild = process.getpgid(pid);
        } catch {
          // already exited
        }
      },
    });

    expect(observedPid).toBeDefined();
    if (observedPid !== undefined && pgidOfChild !== undefined) {
      expect(pgidOfChild).toBe(observedPid);
    }
    // Stdout forwarded to logSink
    expect(sink.some((l) => l.includes("BUILD_MARKER_LINE"))).toBe(true);
    // The first log line is the command echo
    expect(sink[0]).toMatch(/^\[build\] npx expo run:ios/);
  });

  it("forwards iOS args (expo run:ios --device <udid> --configuration Debug)", async () => {
    installFakeNpx(`exit 0`);
    const spec = JobSpecSchema.parse({
      cwd: dir,
      flows: ["a.yaml"],
      platform: "ios",
      build: { variant: "debug", cache: false },
    });
    await buildApp({
      spec,
      device: { udid: "UDID-XYZ", platform: "ios" },
      variant: "debug",
      logSink: () => undefined,
      onChildStart: () => undefined,
    });
    const recorded = readFileSync(argsFile, "utf8").trim().split("\n");
    expect(recorded).toEqual([
      "expo",
      "run:ios",
      "--device",
      "UDID-XYZ",
      "--configuration",
      "Debug",
    ]);
  });

  it("forwards Android args with --variant and the avdName when present", async () => {
    installFakeNpx(`exit 0`);
    const spec = JobSpecSchema.parse({
      cwd: dir,
      flows: ["a.yaml"],
      platform: "android",
      build: { variant: "release", cache: false },
    });
    await buildApp({
      spec,
      device: { udid: "emulator-5554", platform: "android", avdName: "Pixel_7" },
      variant: "release",
      logSink: () => undefined,
      onChildStart: () => undefined,
    });
    const recorded = readFileSync(argsFile, "utf8").trim().split("\n");
    expect(recorded).toEqual([
      "expo",
      "run:android",
      "--device",
      "Pixel_7",
      "--variant",
      "release",
      "--no-bundler",
    ]);
  });

  it("sets a per-device METRO_CACHE_ROOT so parallel builds don't race on the shared cache", async () => {
    installFakeNpx(`exit 0`);
    const spec = JobSpecSchema.parse({
      cwd: dir,
      flows: ["a.yaml"],
      platform: "ios",
      build: { variant: "debug", cache: false },
    });
    await buildApp({
      spec,
      device: { udid: "AB/CD 12", platform: "ios" },
      variant: "debug",
      logSink: () => undefined,
      onChildStart: () => undefined,
    });
    const root = readFileSync(join(dir, "metro_cache_root.txt"), "utf8");
    expect(root).toMatch(/metro-cache[/\\]AB_CD_12$/);
  });

  it("respects a caller-provided METRO_CACHE_ROOT (spec.env wins)", async () => {
    installFakeNpx(`exit 0`);
    const spec = JobSpecSchema.parse({
      cwd: dir,
      flows: ["a.yaml"],
      platform: "ios",
      build: { variant: "debug", cache: false },
      env: { METRO_CACHE_ROOT: "/tmp/pinned-cache" },
    });
    await buildApp({
      spec,
      device: { udid: "fake-udid", platform: "ios" },
      variant: "debug",
      logSink: () => undefined,
      onChildStart: () => undefined,
    });
    const root = readFileSync(join(dir, "metro_cache_root.txt"), "utf8");
    expect(root).toBe("/tmp/pinned-cache");
  });
});
