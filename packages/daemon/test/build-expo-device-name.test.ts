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
  dir = mkdtempSync(join(tmpdir(), "maestroq-build-expodev-"));
  argsFile = join(dir, "args.txt");
  oldPath = process.env.PATH;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (oldPath !== undefined) process.env.PATH = oldPath;
});

function installFakeNpx(): void {
  // Record args, exit 0.
  const path = join(dir, "npx");
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\nexit 0\n`);
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
}

const spec = JobSpecSchema.parse({
  cwd: "/tmp",
  flows: ["a.yaml"],
  platform: "android",
  build: { variant: "release" },
});

describe("buildApp: --device identifier selection", () => {
  it("uses expoDeviceName when set (physical Android: serial != Expo name)", async () => {
    installFakeNpx();
    await buildApp({
      spec,
      device: {
        udid: "d90586bb",
        platform: "android",
        expoDeviceName: "CPH2307",
      },
      variant: "release",
      logSink: () => undefined,
      onChildStart: () => undefined,
    });
    const recorded = readFileSync(argsFile, "utf8").trim().split("\n");
    // shape: expo run:android --device CPH2307 --variant release --no-bundler
    expect(recorded).toContain("--device");
    const deviceIdx = recorded.indexOf("--device");
    expect(recorded[deviceIdx + 1]).toBe("CPH2307");
    expect(recorded).not.toContain("d90586bb");
  });

  it("falls back to avdName when expoDeviceName is unset (Android emulator)", async () => {
    installFakeNpx();
    await buildApp({
      spec,
      device: {
        udid: "emulator-5554",
        platform: "android",
        avdName: "Medium_Phone_API_36.1",
      },
      variant: "release",
      logSink: () => undefined,
      onChildStart: () => undefined,
    });
    const recorded = readFileSync(argsFile, "utf8").trim().split("\n");
    const deviceIdx = recorded.indexOf("--device");
    expect(recorded[deviceIdx + 1]).toBe("Medium_Phone_API_36.1");
  });

  it("falls back to udid when neither expoDeviceName nor avdName is set (iOS sim)", async () => {
    installFakeNpx();
    await buildApp({
      spec: JobSpecSchema.parse({
        cwd: "/tmp",
        flows: ["a.yaml"],
        platform: "ios",
        build: { variant: "debug" },
      }),
      device: { udid: "ABC-123", platform: "ios" },
      variant: "debug",
      logSink: () => undefined,
      onChildStart: () => undefined,
    });
    const recorded = readFileSync(argsFile, "utf8").trim().split("\n");
    const deviceIdx = recorded.indexOf("--device");
    expect(recorded[deviceIdx + 1]).toBe("ABC-123");
  });
});
