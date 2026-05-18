import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetroPortPool } from "../src/metro-pool.js";
import { JobQueue } from "../src/queue.js";
import { Worker } from "../src/worker.js";

let dir: string;
let queuePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-worker-cancel-"));
  queuePath = join(dir, "queue.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const spec = () =>
  JobSpecSchema.parse({
    cwd: "/tmp/x",
    flows: ["a.yaml"],
    platform: "ios",
  });

const config = ConfigSchema.parse({});

function makeWorker(queue: JobQueue): Worker {
  const pool = new MetroPortPool([8081, 8089]);
  return new Worker({ udid: "test-udid", platform: "ios" }, queue, pool, config);
}

describe("Worker.cancel", () => {
  it("returns false and sends no signals when the job is in a terminal status", () => {
    const q = new JobQueue(queuePath);
    q.load();
    const job = q.add(spec());
    q.update(job.id, { status: "succeeded", exitCode: 0, finishedAt: Date.now() });

    const killSpy = vi.spyOn(process, "kill");
    const worker = makeWorker(q);

    const result = worker.cancel(job.id);

    expect(result).toBe(false);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it("returns false for a failed job and sends no signals", () => {
    const q = new JobQueue(queuePath);
    q.load();
    const job = q.add(spec());
    q.update(job.id, { status: "failed", finishedAt: Date.now(), failureReason: "test" });

    const killSpy = vi.spyOn(process, "kill");
    const worker = makeWorker(q);

    expect(worker.cancel(job.id)).toBe(false);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it("returns false for an active job with no active pgid (no child to signal)", () => {
    const q = new JobQueue(queuePath);
    q.load();
    const job = q.add(spec());
    q.update(job.id, { status: "running" });

    const killSpy = vi.spyOn(process, "kill");
    const worker = makeWorker(q);

    expect(worker.cancel(job.id)).toBe(false);
    expect(killSpy).not.toHaveBeenCalled();
  });
});
