import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MetroPortPool } from "../src/metro-pool.js";
import { JobQueue } from "../src/queue.js";
import { Worker } from "../src/worker.js";

// Reach into the Worker's private setStatus via a typed cast so the test
// can drive the quarantine state machine without spinning up real children.
function setStatus(
  w: Worker,
  jobId: string,
  status: "succeeded" | "failed" | "error" | "cancelled",
): void {
  (w as unknown as { setStatus: (id: string, s: string) => void }).setStatus(jobId, status);
}

let dir: string;
let queue: JobQueue;
let worker: Worker;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-quarantine-"));
  queue = new JobQueue(join(dir, "queue.json"));
  queue.load();
  const config = ConfigSchema.parse({ log_dir: join(dir, "logs"), artifact_dir: join(dir, "art") });
  worker = new Worker(
    { udid: "emulator-5554", platform: "android" },
    queue,
    new MetroPortPool([8081, 8089]),
    config,
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeJob(): { id: string } {
  const j = queue.add(
    JobSpecSchema.parse({
      cwd: "/tmp",
      flows: ["a.yaml"],
      platform: "android",
      build: "skip",
    }),
  );
  // Persist a startedAt + status so setStatus doesn't error on missing fields.
  queue.update(j.id, { status: "building", startedAt: Date.now() });
  return j;
}

describe("Worker failure-aware quarantine", () => {
  it("does not quarantine after 1 or 2 consecutive errors", () => {
    setStatus(worker, makeJob().id, "error");
    expect(worker.isQuarantined()).toBe(false);
    setStatus(worker, makeJob().id, "error");
    expect(worker.isQuarantined()).toBe(false);
  });

  it("quarantines after 3 consecutive errors", () => {
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "error");
    expect(worker.isQuarantined()).toBe(true);
    expect(worker.getQuarantinedUntil()).toBeGreaterThan(Date.now());
  });

  it("`succeeded` resets the error counter and clears quarantine", () => {
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "error");
    expect(worker.isQuarantined()).toBe(true);

    setStatus(worker, makeJob().id, "succeeded");
    expect(worker.isQuarantined()).toBe(false);
    expect(worker.getQuarantinedUntil()).toBeUndefined();

    // After reset, it takes another 3 errors to quarantine again.
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "error");
    expect(worker.isQuarantined()).toBe(false);
    setStatus(worker, makeJob().id, "error");
    expect(worker.isQuarantined()).toBe(true);
  });

  it("`failed` (tests ran and failed — not a worker problem) also resets the counter", () => {
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "failed");
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "error");
    expect(worker.isQuarantined()).toBe(false);
  });

  it("`tryStart` refuses to pick up work while quarantined", () => {
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "error");
    expect(worker.isQuarantined()).toBe(true);

    // A new job in the queue — but the quarantined worker shouldn't grab it.
    makeJob();
    queue.update(queue.all()[3]?.id ?? "", { status: "queued" }); // make sure latest is queued
    expect(worker.tryStart()).toBe(false);
  });

  it("backoff escalates on repeated quarantine episodes", () => {
    // 3 errors → quarantine #1 (30s)
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "error");
    const t1 = worker.getQuarantinedUntil() ?? 0;

    // Reset via success, then 3 more errors → quarantine #2 (5m)
    setStatus(worker, makeJob().id, "succeeded");
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "error");
    setStatus(worker, makeJob().id, "error");
    const t2 = worker.getQuarantinedUntil() ?? 0;

    expect(t2 - Date.now()).toBeGreaterThan(t1 - Date.now() + 60_000);
  });
});
