import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMaestro } from "../src/lifecycle/maestro.js";

let dir: string;
let oldPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-watchdog-"));
  oldPath = process.env.PATH;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (oldPath !== undefined) process.env.PATH = oldPath;
});

function installFakeMaestro(body: string): void {
  const path = join(dir, "maestro");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
}

const spec = JobSpecSchema.parse({
  cwd: "/tmp",
  flows: ["a.yaml"],
  platform: "ios",
});

describe("runMaestro finalize watchdog", () => {
  it("SIGKILLs a child that prints the sentinel then hangs", async () => {
    installFakeMaestro(`
echo "Waiting for flows to complete..."
echo "[Passed] 01-configure (5s)"
echo "[Passed] 02-checkout (10s)"
echo "2/2 Flows Passed in 15s"
# Now hang forever — simulates maestro JVM stuck in finalizeRun
exec sleep 600
`);

    const before = Date.now();
    const result = await runMaestro({
      spec,
      device: { udid: "fake-udid", platform: "ios" },
      runner: "maestro",
      artifactDir: join(dir, "artifacts"),
      logSink: () => undefined,
      onChildStart: () => undefined,
      finalizeTimeoutMs: 500,
    });
    const elapsed = Date.now() - before;

    expect(result.killedAfterFinalize).toBe(true);
    expect(result.exitCode).toBe(0); // sentinel said Passed
    expect(elapsed).toBeLessThan(5_000);
  });

  it("uses sentinel-Failed exit code when killed after a failed run", async () => {
    installFakeMaestro(`
echo "1/2 Flows Failed"
exec sleep 600
`);
    const result = await runMaestro({
      spec,
      device: { udid: "fake-udid", platform: "ios" },
      runner: "maestro",
      artifactDir: join(dir, "artifacts"),
      logSink: () => undefined,
      onChildStart: () => undefined,
      finalizeTimeoutMs: 500,
    });
    expect(result.killedAfterFinalize).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it("uses the natural exit code when the child exits cleanly", async () => {
    installFakeMaestro(`
echo "2/2 Flows Passed in 1s"
exit 0
`);
    const result = await runMaestro({
      spec,
      device: { udid: "fake-udid", platform: "ios" },
      runner: "maestro",
      artifactDir: join(dir, "artifacts"),
      logSink: () => undefined,
      onChildStart: () => undefined,
      finalizeTimeoutMs: 30_000,
    });
    expect(result.killedAfterFinalize).toBe(false);
    expect(result.exitCode).toBe(0);
  });
});
