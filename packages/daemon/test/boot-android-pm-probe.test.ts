import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootDevice } from "../src/lifecycle/boot.js";

let dir: string;
let oldPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-pm-probe-"));
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

describe("bootDevice: Android PackageManager health probe", () => {
  it("returns successfully when adb says device + pm list packages reports the android pkg", async () => {
    // adb get-state → device; adb shell pm list packages android → "package:android"
    installFake(
      "adb",
      `case "$3" in
  get-state) echo "device"; exit 0 ;;
  shell)
    case "$4 $5 $6 $7" in
      "pm list packages android") echo "package:android"; exit 0 ;;
    esac
    ;;
esac
exit 0`,
    );

    await expect(
      bootDevice({
        device: { udid: "emulator-5554", platform: "android" },
        rebootSimBefore: false,
        logSink: () => undefined,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws when PackageManager replies `Can't find service: package`", async () => {
    installFake(
      "adb",
      `case "$3" in
  get-state) echo "device"; exit 0 ;;
  shell)
    case "$4 $5 $6 $7" in
      "pm list packages android")
        echo "cmd: Can't find service: package" >&2
        exit 127
        ;;
    esac
    ;;
esac
exit 0`,
    );

    await expect(
      bootDevice({
        device: { udid: "emulator-5554", platform: "android" },
        rebootSimBefore: false,
        logSink: () => undefined,
      }),
    ).rejects.toThrow(/PackageManager is unhealthy/);
  });

  it("throws when pm runs but doesn't report the android package (very weird state)", async () => {
    installFake(
      "adb",
      `case "$3" in
  get-state) echo "device"; exit 0 ;;
  shell)
    case "$4 $5 $6 $7" in
      "pm list packages android") echo ""; exit 0 ;;
    esac
    ;;
esac
exit 0`,
    );

    await expect(
      bootDevice({
        device: { udid: "emulator-5554", platform: "android" },
        rebootSimBefore: false,
        logSink: () => undefined,
      }),
    ).rejects.toThrow(/PackageManager is unhealthy/);
  });
});
