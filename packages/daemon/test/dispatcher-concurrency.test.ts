import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, type DeviceConfig, JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dispatcher } from "../src/dispatcher.js";
import { MetroPortPool } from "../src/metro-pool.js";
import { JobQueue } from "../src/queue.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-dispatch-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeSpec(platform: "ios" | "android"): unknown {
  return JobSpecSchema.parse({
    cwd: dir,
    flows: ["smoke.yaml"],
    platform,
    build: "skip",
  });
}

const iosA: DeviceConfig = { udid: "ios-a", platform: "ios" };
const iosB: DeviceConfig = { udid: "ios-b", platform: "ios" };
const droid: DeviceConfig = { udid: "droid-a", platform: "android" };

type StubbableWorker = {
  udid: string;
  platform: "ios" | "android";
  _busy?: boolean;
  isBusy: () => boolean;
  tryStart: () => boolean;
};

function stubWorkers(dispatcher: Dispatcher, queue: JobQueue): StubbableWorker[] {
  const workers = (dispatcher as unknown as { workers: StubbableWorker[] }).workers;
  for (const w of workers) {
    w._busy = false;
    w.isBusy = (): boolean => Boolean(w._busy);
    w.tryStart = (): boolean => {
      if (w._busy) return false;
      const next = queue.nextQueued(w.platform);
      if (!next) return false;
      queue.update(next.id, { status: "running", deviceUdid: w.udid });
      w._busy = true;
      return true;
    };
  }
  return workers;
}

describe("Dispatcher iOS concurrency cap", () => {
  it("starts only one iOS worker at a time under runner=maestro; Android runs concurrently", () => {
    const queue = new JobQueue(join(dir, "queue.json"));
    queue.load();
    const pool = new MetroPortPool([8081, 8089]);
    const config = ConfigSchema.parse({ defaults: { runner: "maestro" } });
    const dispatcher = new Dispatcher(queue, pool, config, [iosA, iosB, droid]);

    // Replace each worker's tryStart with a stub that just flips busy=true and
    // pulls one job off the queue, so we exercise the dispatcher's cap logic
    // without booting real sims.
    const workers = stubWorkers(dispatcher, queue);

    queue.add(makeSpec("ios") as never);
    queue.add(makeSpec("ios") as never);
    queue.add(makeSpec("android") as never);

    dispatcher.tick();

    const busy = workers
      .filter((w) => w.isBusy())
      .map((w) => w.udid)
      .sort();
    expect(busy.filter((u) => u.startsWith("ios-")).length).toBe(1);
    expect(busy).toContain("droid-a");
  });

  it("dispatches both iOS workers in parallel under runner=maestro-runner (default)", () => {
    const queue = new JobQueue(join(dir, "queue.json"));
    queue.load();
    const pool = new MetroPortPool([8081, 8089]);
    const config = ConfigSchema.parse({});
    expect(config.defaults.runner).toBe("maestro-runner");
    const dispatcher = new Dispatcher(queue, pool, config, [iosA, iosB, droid]);
    const workers = stubWorkers(dispatcher, queue);

    queue.add(makeSpec("ios") as never);
    queue.add(makeSpec("ios") as never);
    queue.add(makeSpec("android") as never);

    dispatcher.tick();

    const busy = workers
      .filter((w) => w.isBusy())
      .map((w) => w.udid)
      .sort();
    expect(busy).toEqual(["droid-a", "ios-a", "ios-b"]);
  });
});
