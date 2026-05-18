import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootDevice } from "../src/lifecycle/boot.js";

let dir: string;
let oldPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-boot-timeout-"));
  oldPath = process.env.PATH;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (oldPath !== undefined) process.env.PATH = oldPath;
});

function installFakeXcrun(body: string): void {
  const path = join(dir, "xcrun");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
}

describe("bootDevice simctl bootstatus timeout", () => {
  it("rejects within the configured timeout when bootstatus hangs", async () => {
    installFakeXcrun(`exec sleep 60`);

    const start = Date.now();
    await expect(
      bootDevice({
        device: { udid: "fake-udid", platform: "ios" },
        rebootSimBefore: false,
        logSink: () => undefined,
        bootstatusTimeoutMs: 800,
      }),
    ).rejects.toThrow(/bootstatus/i);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(4_000);
  }, 10_000);
});
