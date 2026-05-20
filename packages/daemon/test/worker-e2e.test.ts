import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MetroPortPool } from "../src/metro-pool.js";
import { JobQueue } from "../src/queue.js";
import { Worker, type WorkerEvent } from "../src/worker.js";

let dir: string;
let logDir: string;
let artifactDir: string;
let queuePath: string;
let oldPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-worker-e2e-"));
  logDir = join(dir, "logs");
  artifactDir = join(dir, "artifacts");
  queuePath = join(dir, "queue.json");
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
}

function waitForTerminal(worker: Worker): Promise<WorkerEvent> {
  return new Promise((resolve) => {
    worker.on("event", (ev: WorkerEvent) => {
      if (
        ev.kind === "status" &&
        (ev.status === "succeeded" || ev.status === "failed" || ev.status === "cancelled")
      ) {
        resolve(ev);
      }
    });
  });
}

describe("Worker end-to-end (fake binaries)", () => {
  it("drives a build:'skip' android job through building→running→succeeded", async () => {
    // adb get-state must return "device" so bootDevice short-circuits without
    // launching the emulator. The PackageManager probe (`pm list packages
    // android`) must also report `package:android` so bootDevice doesn't
    // throw on the new health check.
    installFake(
      "adb",
      `case "$3" in
  get-state) echo device; exit 0 ;;
  shell)
    case "$4 $5 $6 $7" in
      "pm list packages android") echo "package:android"; exit 0 ;;
    esac
    ;;
  *) exit 0 ;;
esac`,
    );
    // maestro-runner prints sentinel and exits 0.
    installFake(
      "maestro-runner",
      `echo "WORKER_E2E_MARKER"
echo "1/1 Flows Passed in 1s"
exit 0`,
    );
    process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;

    const queue = new JobQueue(queuePath);
    queue.load();
    const job = queue.add(
      JobSpecSchema.parse({
        cwd: dir,
        flows: ["smoke.yaml"],
        platform: "android",
        build: "skip",
      }),
    );

    const config = ConfigSchema.parse({
      log_dir: logDir,
      artifact_dir: artifactDir,
      defaults: { runner: "maestro-runner" },
    });
    const pool = new MetroPortPool([8081, 8089]);
    const worker = new Worker({ udid: "emulator-5554", platform: "android" }, queue, pool, config);

    const terminal = waitForTerminal(worker);
    expect(worker.tryStart()).toBe(true);
    const ev = await terminal;

    expect(ev.kind).toBe("status");
    if (ev.kind === "status") {
      expect(ev.status).toBe("succeeded");
      expect(ev.exitCode).toBe(0);
    }

    const final = queue.get(job.id);
    expect(final).toBeDefined();
    expect(final?.status).toBe("succeeded");
    expect(final?.exitCode).toBe(0);
    expect(final?.finishedAt).toBeDefined();
    expect(final?.logPath).toBeDefined();

    if (final?.logPath) {
      const contents = readFileSync(final.logPath, "utf8");
      expect(contents).toContain("WORKER_E2E_MARKER");
      expect(contents).toContain("[build] skipped");
    }
  }, 20_000);
});
