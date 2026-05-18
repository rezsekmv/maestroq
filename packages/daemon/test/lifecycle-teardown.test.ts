import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { teardownJob } from "../src/lifecycle/teardown.js";

let dir: string;
let oldPath: string | undefined;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-teardown-"));
  oldPath = process.env.PATH;
  logPath = join(dir, "pkill.log");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (oldPath !== undefined) process.env.PATH = oldPath;
});

function installFakePkill(exitCode: number): void {
  const path = join(dir, "pkill");
  writeFileSync(path, `#!/bin/sh\necho "$@" >> ${logPath}\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
}

describe("teardownJob iOS pkill scoping by runner", () => {
  it("under runner=maestro, invokes pkill with both UDID-scoped patterns", async () => {
    installFakePkill(1);
    await teardownJob({
      device: { udid: "udid-aaa", platform: "ios" },
      runner: "maestro",
      logSink: () => undefined,
    });
    const calls = readFileSync(logPath, "utf8").trim().split("\n");
    expect(calls).toEqual([
      "-f maestro-driver-iosUITests-Runner.*udid-aaa",
      "-f xcodebuild.*udid-aaa",
    ]);
  });

  it("under runner=maestro-runner, pkill is NOT invoked (sweep skipped per AGENTS.md)", async () => {
    installFakePkill(1);
    await teardownJob({
      device: { udid: "udid-bbb", platform: "ios" },
      runner: "maestro-runner",
      logSink: () => undefined,
    });
    expect(existsSync(logPath)).toBe(false);
  });

  it("under android, pkill is NOT invoked regardless of runner", async () => {
    installFakePkill(1);
    await teardownJob({
      device: { udid: "emulator-5554", platform: "android" },
      runner: "maestro",
      logSink: () => undefined,
    });
    expect(existsSync(logPath)).toBe(false);
  });
});
