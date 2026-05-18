import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobQueue } from "../src/queue.js";
import { sweepStaleProcessGroups } from "../src/recovery.js";

let dir: string;
let queuePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-recovery-"));
  queuePath = join(dir, "queue.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const spec = () =>
  JobSpecSchema.parse({
    cwd: "/tmp/x",
    flows: ["a.yaml"],
    platform: "ios",
  });

function spawnSleeper(): Promise<{ pid: number; wait: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      if (!child.pid) {
        reject(new Error("no pid"));
        return;
      }
      const pid = child.pid;
      const wait = (): Promise<void> =>
        new Promise((res) => {
          child.once("exit", () => res());
        });
      resolve({ pid, wait });
    });
  });
}

describe("sweepStaleProcessGroups", () => {
  it("SIGKILLs tracked process groups and marks jobs failed", async () => {
    const q = new JobQueue(queuePath);
    q.load();
    const job = q.add(spec());
    const child = await spawnSleeper();
    q.update(job.id, { status: "running", pgid: child.pid });

    const result = sweepStaleProcessGroups(q);
    expect(result.failedJobIds).toContain(job.id);
    expect(result.killed).toContain(child.pid);

    await child.wait();
    expect(q.get(job.id)?.status).toBe("failed");
    expect(q.get(job.id)?.failureReason).toBe("daemon-crash");
  });

  it("does nothing when no active jobs exist", () => {
    const q = new JobQueue(queuePath);
    q.load();
    q.add(spec()); // queued, not active

    const result = sweepStaleProcessGroups(q);
    expect(result.killed).toHaveLength(0);
    expect(result.failedJobIds).toHaveLength(0);
  });

  it("survives an already-dead pgid (ESRCH)", () => {
    const q = new JobQueue(queuePath);
    q.load();
    const job = q.add(spec());
    q.update(job.id, { status: "running", pgid: 999999 });

    expect(() => sweepStaleProcessGroups(q)).not.toThrow();
    expect(q.get(job.id)?.status).toBe("failed");
  });
});
