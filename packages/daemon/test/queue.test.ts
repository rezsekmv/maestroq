import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobQueue } from "../src/queue.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-queue-"));
  path = join(dir, "queue.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const spec = (overrides: Partial<{ priority: number; platform: "ios" | "android" }> = {}) =>
  JobSpecSchema.parse({
    cwd: "/tmp/x",
    flows: ["a.yaml"],
    platform: overrides.platform ?? "ios",
    priority: overrides.priority,
  });

describe("JobQueue", () => {
  it("persists added jobs and reloads them", () => {
    const q = new JobQueue(path);
    q.load();
    const a = q.add(spec());
    expect(existsSync(path)).toBe(true);

    const q2 = new JobQueue(path);
    q2.load();
    expect(q2.get(a.id)?.id).toBe(a.id);
    expect(q2.all()).toHaveLength(1);
  });

  it("returns FIFO order with priority override", () => {
    const q = new JobQueue(path);
    q.load();
    const first = q.add(spec({ priority: 0 }));
    const second = q.add(spec({ priority: 5 }));
    const third = q.add(spec({ priority: 0 }));

    const next = q.nextQueued("ios");
    expect(next?.id).toBe(second.id);

    q.update(second.id, { status: "running" });
    const after = q.nextQueued("ios");
    expect(after?.id).toBe(first.id);

    q.update(first.id, { status: "running" });
    const third2 = q.nextQueued("ios");
    expect(third2?.id).toBe(third.id);
  });

  it("filters next-queued by platform", () => {
    const q = new JobQueue(path);
    q.load();
    const a = q.add(spec({ platform: "ios" }));
    const b = q.add(spec({ platform: "android" }));
    expect(q.nextQueued("android")?.id).toBe(b.id);
    expect(q.nextQueued("ios")?.id).toBe(a.id);
  });

  it("finalizeInterrupted marks active jobs failed and persists", () => {
    const q = new JobQueue(path);
    q.load();
    const a = q.add(spec());
    q.update(a.id, { status: "running", pgid: 99999 });
    const b = q.add(spec());

    const interrupted = q.finalizeInterrupted("daemon-crash");
    expect(interrupted.map((j) => j.id)).toEqual([a.id]);
    // finalizeInterrupted now marks interrupted jobs as `error` (setup-side
    // problem — daemon-crash recovery never reached a test verdict).
    expect(q.get(a.id)?.status).toBe("error");
    expect(q.get(a.id)?.failureReason).toBe("daemon-crash");
    expect(q.get(b.id)?.status).toBe("queued");

    const persisted = JSON.parse(readFileSync(path, "utf8")) as {
      jobs: Array<{ id: string; status: string }>;
    };
    expect(persisted.jobs.find((j) => j.id === a.id)?.status).toBe("error");
  });
});
