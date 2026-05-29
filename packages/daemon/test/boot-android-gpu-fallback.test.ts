import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootDevice } from "../src/lifecycle/boot.js";

let dir: string;
let emulatorLog: string;
let oldPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-gpu-fallback-"));
  emulatorLog = join(dir, "emulator.log");
  oldPath = process.env.PATH;
  // emulator: record the gpu arg of each launch then exit immediately. adb is
  // faked, so the emulator need not stay alive; exiting before the failing
  // wait-for-device's SIGKILL keeps the log write deterministic under load.
  installFakeBin(
    "emulator",
    `gpu=""\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-gpu" ]; then gpu="$2"; fi; shift; done\nprintf '%s\\n' "$gpu" >> "${emulatorLog}"\nexit 0`,
  );
  // adb: offline (forces cold boot); wait-for-device fails the first time
  // (host attempt) and succeeds the second (swiftshader_indirect fallback).
  installFakeBin(
    "adb",
    `case "$*" in
       *"get-state"*) echo "error: device offline" 1>&2; exit 1 ;;
       *"wait-for-device"*)
         n=$(cat "${dir}/wfd.count" 2>/dev/null || echo 0)
         n=$((n+1)); echo "$n" > "${dir}/wfd.count"
         if [ "$n" = "1" ]; then
           # Block until the host-attempt emulator has recorded its line, so the
           # failure (and the SIGKILL that follows) can't race the log write.
           while [ ! -s "${emulatorLog}" ]; do sleep 0.05; done
           exit 1
         else exit 0; fi ;;
       *"getprop sys.boot_completed"*) exit 0 ;;
       *"pm list packages android"*) echo "package:android"; exit 0 ;;
       *) exit 0 ;;
     esac`,
  );
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

async function waitForLines(count: number, timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const lines = readFileSync(emulatorLog, "utf8").trim().split("\n").filter(Boolean);
      if (lines.length >= count) return lines;
    } catch {
      // not written yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`emulator.log never reached ${count} line(s)`);
}

describe("bootDevice Android headless GPU fallback", () => {
  it("retries with swiftshader_indirect after a host-GPU boot failure", async () => {
    await bootDevice({
      device: { udid: "emulator-5554", platform: "android", avdName: "Pixel_7", headless: true },
      rebootSimBefore: false,
      logSink: () => undefined,
      bootstatusTimeoutMs: 5_000,
    });
    const attempts = await waitForLines(2, 3_000);
    expect(attempts).toEqual(["host", "swiftshader_indirect"]);
  });

  it("does not fall back when the user pinned gpu: host", async () => {
    await expect(
      bootDevice({
        device: {
          udid: "emulator-5554",
          platform: "android",
          avdName: "Pixel_7",
          headless: true,
          gpu: "host",
        },
        rebootSimBefore: false,
        logSink: () => undefined,
        bootstatusTimeoutMs: 5_000,
      }),
    ).rejects.toThrow(/wait-for-device/);
    const attempts = await waitForLines(1, 3_000);
    expect(attempts).toEqual(["host"]);
  });
});
