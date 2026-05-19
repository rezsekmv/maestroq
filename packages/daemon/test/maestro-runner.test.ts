import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMaestro } from "../src/lifecycle/maestro.js";

let dir: string;
let argsFile: string;
let oldPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-runner-"));
  argsFile = join(dir, "args.txt");
  oldPath = process.env.PATH;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (oldPath !== undefined) process.env.PATH = oldPath;
});

function installFakeRunner(body: string): void {
  const path = join(dir, "maestro-runner");
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\n${body}\n`);
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
}

const spec = JobSpecSchema.parse({
  cwd: "/tmp",
  flows: ["a.yaml", "b.yaml"],
  platform: "ios",
});

describe("runMaestro under runner=maestro-runner", () => {
  it("places --platform/--device/--output before the `test` subcommand", async () => {
    installFakeRunner(`
echo "2/2 Flows Passed in 1s"
exit 0
`);
    const result = await runMaestro({
      spec,
      device: { udid: "ABC-123", platform: "ios" },
      runner: "maestro-runner",
      artifactDir: join(dir, "artifacts"),
      logSink: () => undefined,
      onChildStart: () => undefined,
      finalizeTimeoutMs: 500,
    });

    expect(result.exitCode).toBe(0);
    expect(result.killedAfterFinalize).toBe(false);

    // maestro-runner >=1.1.x: these are global options. Putting them after
    // `test` makes the binary exit with "flag provided but not defined: -device".
    const recorded = readFileSync(argsFile, "utf8").trim().split("\n");
    expect(recorded).toEqual([
      "--platform",
      "ios",
      "--device",
      "ABC-123",
      "--output",
      join(dir, "artifacts"),
      "test",
      "a.yaml",
      "b.yaml",
    ]);
  });

  it("does not arm the finalize watchdog when sentinel appears", async () => {
    installFakeRunner(`
echo "Waiting for flows to complete..."
echo "2/2 Flows Passed in 1s"
sleep 1.5
exit 0
`);
    const before = Date.now();
    const result = await runMaestro({
      spec,
      device: { udid: "fake", platform: "ios" },
      runner: "maestro-runner",
      artifactDir: join(dir, "artifacts"),
      logSink: () => undefined,
      onChildStart: () => undefined,
      finalizeTimeoutMs: 500,
    });
    const elapsed = Date.now() - before;

    expect(result.killedAfterFinalize).toBe(false);
    expect(result.exitCode).toBe(0);
    // If the watchdog had armed (500ms), the child would have been killed
    // before its 1.5s sleep completed. Elapsed >= 1.5s proves the watchdog
    // never fired.
    expect(elapsed).toBeGreaterThanOrEqual(1_400);
  });

  it("propagates non-zero exit code naturally", async () => {
    installFakeRunner(`
echo "1/2 Flows Failed"
exit 1
`);
    const result = await runMaestro({
      spec,
      device: { udid: "fake", platform: "ios" },
      runner: "maestro-runner",
      artifactDir: join(dir, "artifacts"),
      logSink: () => undefined,
      onChildStart: () => undefined,
      finalizeTimeoutMs: 30_000,
    });
    expect(result.killedAfterFinalize).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});
