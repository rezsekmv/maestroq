import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ConfigSchema, JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lifecycle/boot.js", () => ({ bootDevice: vi.fn(async () => {}) }));
vi.mock("../src/lifecycle/build.js", () => ({ buildApp: vi.fn(async () => {}) }));
vi.mock("../src/lifecycle/teardown.js", () => ({ teardownJob: vi.fn(async () => {}) }));
vi.mock("../src/lifecycle/metro.js", () => ({ startMetro: vi.fn(async () => ({ port: 0 })) }));
vi.mock("../src/lifecycle/maestro.js", () => ({
  runMaestro: vi.fn(async () => ({ exitCode: 0, killedAfterFinalize: false })),
}));
vi.mock("../src/build-cache.js", () => ({
  decideCache: vi.fn(async () => ({ use: true, reason: "clean-hit" })),
  gitHead: vi.fn(async () => "abc"),
  hashEnv: vi.fn(() => "h"),
  recordSuccessfulBuild: vi.fn(),
  loadPersistedCache: vi.fn(),
}));

import { MetroPortPool } from "../src/metro-pool.js";
import { JobQueue } from "../src/queue.js";
import { Worker } from "../src/worker.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-logpart-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("log path partitioning", () => {
  it("writes logs under <logDir>/YYYY-MM-DD/<id>.log", async () => {
    const logDir = join(dir, "logs");
    const artifactDir = join(dir, "artifacts");
    const config = ConfigSchema.parse({ log_dir: logDir, artifact_dir: artifactDir });

    const q = new JobQueue(join(dir, "queue.json"));
    q.load();
    const job = q.add(
      JobSpecSchema.parse({
        cwd: "/tmp/x",
        flows: ["a.yaml"],
        platform: "ios",
        build: "skip",
      }),
    );

    const pool = new MetroPortPool([8081, 8089]);
    const worker = new Worker({ udid: "test-udid", platform: "ios" }, q, pool, config);

    await new Promise<void>((resolve) => {
      worker.on("event", (ev) => {
        if (ev.kind === "idle") resolve();
      });
      worker.tryStart();
    });
    await new Promise((r) => setTimeout(r, 50));

    const updated = q.get(job.id);
    expect(updated?.logPath).toBeDefined();
    const expectedDay = new Date().toISOString().slice(0, 10);
    expect(updated?.logPath).toBe(join(logDir, expectedDay, `${job.id}.log`));
    expect(dirname(updated?.logPath ?? "")).toBe(join(logDir, expectedDay));
    const dayDir = readdirSync(join(logDir, expectedDay));
    expect(dayDir).toContain(`${job.id}.log`);
  });
});
