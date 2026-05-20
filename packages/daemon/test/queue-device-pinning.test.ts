import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobQueue } from "../src/queue.js";

let dir: string;
let queue: JobQueue;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-queue-pin-"));
  queue = new JobQueue(join(dir, "queue.json"));
  queue.load();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function spec(extra: Partial<Parameters<typeof JobSpecSchema.parse>[0]> = {}) {
  return JobSpecSchema.parse({
    cwd: "/tmp",
    flows: ["a.yaml"],
    platform: "android",
    build: "skip",
    ...extra,
  });
}

describe("JobQueue.nextQueued device pinning", () => {
  it("returns unpinned jobs to any worker of the right platform", () => {
    queue.add(spec());
    expect(queue.nextQueued("android", "emulator-5554")?.spec.deviceUdid).toBeUndefined();
    expect(queue.nextQueued("android", "d90586bb")?.spec.deviceUdid).toBeUndefined();
  });

  it("hides pinned jobs from workers whose udid doesn't match", () => {
    queue.add(spec({ deviceUdid: "emulator-5554" }));
    expect(queue.nextQueued("android", "d90586bb")).toBeUndefined();
    expect(queue.nextQueued("android", "emulator-5554")?.spec.deviceUdid).toBe("emulator-5554");
  });

  it("considers a pinned + an unpinned job; only the matching worker can take the pinned one", () => {
    const pinned = queue.add(spec({ deviceUdid: "d90586bb" }));
    const free = queue.add(spec());

    // OnePlus worker should prefer the pinned (FIFO by createdAt within priority)
    expect(queue.nextQueued("android", "d90586bb")?.id).toBe(pinned.id);

    // Emulator worker can't see the pinned job, falls through to the unpinned one
    expect(queue.nextQueued("android", "emulator-5554")?.id).toBe(free.id);
  });

  it("respects priority ahead of device pin (higher priority wins, modulo pin filter)", () => {
    // A high-priority pinned job + a normal-priority free job
    const hi = queue.add(spec({ deviceUdid: "emulator-5554", priority: 10 }));
    queue.add(spec());

    // OnePlus can't see the pinned high-priority job; it gets the free one
    expect(queue.nextQueued("android", "d90586bb")?.spec.deviceUdid).toBeUndefined();
    // Emulator sees both; high-priority pinned wins
    expect(queue.nextQueued("android", "emulator-5554")?.id).toBe(hi.id);
  });
});
