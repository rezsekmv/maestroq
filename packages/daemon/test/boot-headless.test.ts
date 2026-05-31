import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootDevice } from "../src/lifecycle/boot.js";

let dir: string;
let argvFile: string;
let oldPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-boot-headless-"));
  argvFile = join(dir, "emulator.argv");
  oldPath = process.env.PATH;
  // adb get-state must say "not running" so bootDevice falls through to spawning
  // the emulator; then wait-for-device + the boot_completed loop + pm probe
  // must all succeed for the call to return.
  installFakeBin(
    "adb",
    `case "$*" in
       *"get-state"*) echo "error: device offline" 1>&2; exit 1 ;;
       *"wait-for-device"*) exit 0 ;;
       *"getprop sys.boot_completed"*) exit 0 ;;
       *"pm list packages android"*) echo "package:android"; exit 0 ;;
       *) exit 0 ;;
     esac`,
  );
  installFakeBin("emulator", `printf '%s\\n' "$@" > "${argvFile}"\nsleep 30`);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (oldPath !== undefined) process.env.PATH = oldPath;
});

function installFakeBin(name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
}

async function waitForArgv(timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = readFileSync(argvFile, "utf8");
      if (raw.length > 0) return raw.trim().split("\n");
    } catch {
      // file not yet written
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("emulator argv file never appeared");
}

describe("bootDevice Android headless flag", () => {
  it("passes -no-window -no-audio -no-boot-anim when headless: true", async () => {
    await bootDevice({
      device: {
        udid: "emulator-5554",
        platform: "android",
        avdName: "Pixel_7",
        headless: true,
      },
      rebootSimBefore: false,
      logSink: () => undefined,
      bootstatusTimeoutMs: 5_000,
    });
    const argv = await waitForArgv(2_000);
    expect(argv).toEqual([
      "-avd",
      "Pixel_7",
      "-no-snapshot-load",
      "-no-window",
      "-no-audio",
      "-no-boot-anim",
      "-gpu",
      "host",
    ]);
  });

  it("honors an explicit gpu mode without falling back", async () => {
    await bootDevice({
      device: {
        udid: "emulator-5554",
        platform: "android",
        avdName: "Pixel_7",
        headless: true,
        gpu: "swiftshader_indirect",
      },
      rebootSimBefore: false,
      logSink: () => undefined,
      bootstatusTimeoutMs: 5_000,
    });
    const argv = await waitForArgv(2_000);
    expect(argv).toEqual([
      "-avd",
      "Pixel_7",
      "-no-snapshot-load",
      "-no-window",
      "-no-audio",
      "-no-boot-anim",
      "-gpu",
      "swiftshader_indirect",
    ]);
  });

  it("omits headless flags when headless: false", async () => {
    await bootDevice({
      device: {
        udid: "emulator-5554",
        platform: "android",
        avdName: "Pixel_7",
        headless: false,
      },
      rebootSimBefore: false,
      logSink: () => undefined,
      bootstatusTimeoutMs: 5_000,
    });
    const argv = await waitForArgv(2_000);
    expect(argv).toEqual(["-avd", "Pixel_7", "-no-snapshot-load"]);
  });
});
