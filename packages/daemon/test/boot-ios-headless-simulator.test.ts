import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetIosSimCacheForTests, bootDevice } from "../src/lifecycle/boot.js";

let dir: string;
let oldPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-ios-headless-"));
  oldPath = process.env.PATH;
  _resetIosSimCacheForTests();

  // xcrun: report SIM-UDID as a simulator, and let bootstatus succeed.
  installFakeBin(
    "xcrun",
    `case "$*" in
       *"simctl list -j devices"*) echo '{"devices":{"runtime":[{"udid":"SIM-UDID"}]}}' ;;
       *"bootstatus"*) exit 0 ;;
       *) exit 0 ;;
     esac`,
  );
  // pgrep -x Simulator: "running" until osascript drops the quit marker.
  installFakeBin("pgrep", `if [ -f "${dir}/quit.marker" ]; then exit 1; else exit 0; fi`);
  // osascript quit: record the call and mark Simulator as gone.
  installFakeBin("osascript", `printf 'quit\\n' >> "${dir}/osascript.calls"\ntouch "${dir}/quit.marker"\nexit 0`);
  installFakeBin("killall", `printf 'killall\\n' >> "${dir}/killall.calls"\nexit 0`);
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

describe("bootDevice iOS headless Simulator handling", () => {
  it("quits a running Simulator.app before booting when headless: true", async () => {
    await bootDevice({
      device: { udid: "SIM-UDID", platform: "ios", headless: true },
      rebootSimBefore: false,
      logSink: () => undefined,
      bootstatusTimeoutMs: 5_000,
    });
    expect(readFileSync(join(dir, "osascript.calls"), "utf8")).toContain("quit");
    expect(existsSync(join(dir, "killall.calls"))).toBe(false);
  });

  it("does not touch Simulator.app when headless: false", async () => {
    await bootDevice({
      device: { udid: "SIM-UDID", platform: "ios", headless: false },
      rebootSimBefore: false,
      logSink: () => undefined,
      bootstatusTimeoutMs: 5_000,
    });
    expect(existsSync(join(dir, "osascript.calls"))).toBe(false);
  });

  it("does nothing when Simulator.app is not running (headless: true)", async () => {
    // Pre-create the marker so pgrep reports Simulator as not running.
    writeFileSync(join(dir, "quit.marker"), "");
    await bootDevice({
      device: { udid: "SIM-UDID", platform: "ios", headless: true },
      rebootSimBefore: false,
      logSink: () => undefined,
      bootstatusTimeoutMs: 5_000,
    });
    expect(existsSync(join(dir, "osascript.calls"))).toBe(false);
  });
});
