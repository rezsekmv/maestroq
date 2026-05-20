import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootDevice } from "../src/lifecycle/boot.js";

let dir: string;
let oldPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-boot-android-"));
  oldPath = process.env.PATH;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (oldPath !== undefined) process.env.PATH = oldPath;
});

function installFake(name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
}

describe("bootDevice: Android emulator launch failure", () => {
  it("does NOT crash the daemon (no unhandled rejection) when `emulator` exits non-zero", async () => {
    // adb says the device is not visible → enter the emulator-spawn path.
    installFake("adb", `exit 1`);
    // emulator immediately exits with code 1 — simulating a missing AVD name.
    installFake("emulator", `echo "PANIC: Unknown AVD name [bogus]" >&2; exit 1`);

    // Track unhandled rejections during the test — there must be none.
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      await expect(
        bootDevice({
          device: { udid: "emulator-5554", platform: "android", avdName: "bogus" },
          rebootSimBefore: false,
          logSink: () => undefined,
          // Short timeout — once emulator dies, `adb wait-for-device` (also our
          // fake, exit 1) returns immediately and we hit the error path fast.
          bootstatusTimeoutMs: 1_500,
        }),
      ).rejects.toThrow(/adb wait-for-device/);
    } finally {
      // Give any pending unhandled rejections a tick to surface, then assert.
      await new Promise((r) => setImmediate(r));
      process.off("unhandledRejection", onUnhandled);
    }

    expect(rejections).toEqual([]);
  }, 10_000);
});
