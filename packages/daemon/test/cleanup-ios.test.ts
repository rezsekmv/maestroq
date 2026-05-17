import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupIosLeftovers } from "../src/lifecycle/cleanup-ios.js";

let dir: string;
let oldPath: string | undefined;
let logPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-cleanup-ios-"));
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

describe("cleanupIosLeftovers", () => {
  it("issues both UDID-scoped pkill patterns and tolerates exit code 1 (no matches)", async () => {
    installFakePkill(1);
    const sink: string[] = [];
    await cleanupIosLeftovers("fake-udid-abc", (l) => sink.push(l));
    const calls = readFileSync(logPath, "utf8").trim().split("\n");
    expect(calls).toEqual([
      "-f maestro-driver-iosUITests-Runner.*fake-udid-abc",
      "-f xcodebuild.*fake-udid-abc",
    ]);
    // exit=1 (no matches) should not produce log lines
    expect(sink).toEqual([]);
  });

  it("logs when pkill actually killed processes (exit 0)", async () => {
    installFakePkill(0);
    const sink: string[] = [];
    await cleanupIosLeftovers("udid-xyz", (l) => sink.push(l));
    expect(sink.length).toBe(2);
    expect(sink[0]).toContain("killed leftover");
    expect(sink[0]).toContain("udid-xyz");
  });
});
