import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobQueue } from "../src/queue.js";

let dir: string;
let queuePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-autoprune-"));
  queuePath = join(dir, "queue.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("daemon startup auto-prune", () => {
  it("removes terminal jobs older than queue_retention_days from a pre-existing queue.json", () => {
    const config = ConfigSchema.parse({});
    const retentionMs = config.defaults.queue_retention_days * 86_400_000;
    const ancient = Date.now() - retentionMs - 60_000;

    const seed = {
      jobs: [
        {
          id: "old-success",
          spec: {
            cwd: "/tmp/x",
            flows: ["a.yaml"],
            platform: "ios",
            build: { variant: "release", cache: true },
            metro: "skip",
            env: {},
            priority: 0,
            rebootSimBefore: false,
          },
          status: "succeeded",
          createdAt: ancient,
          startedAt: ancient,
          finishedAt: ancient,
          exitCode: 0,
        },
        {
          id: "old-failed",
          spec: {
            cwd: "/tmp/x",
            flows: ["a.yaml"],
            platform: "ios",
            build: { variant: "release", cache: true },
            metro: "skip",
            env: {},
            priority: 0,
            rebootSimBefore: false,
          },
          status: "failed",
          createdAt: ancient,
          finishedAt: ancient,
          failureReason: "old",
        },
        {
          id: "fresh",
          spec: {
            cwd: "/tmp/x",
            flows: ["a.yaml"],
            platform: "ios",
            build: { variant: "release", cache: true },
            metro: "skip",
            env: {},
            priority: 0,
            rebootSimBefore: false,
          },
          status: "succeeded",
          createdAt: Date.now(),
          finishedAt: Date.now(),
          exitCode: 0,
        },
        {
          id: "queued",
          spec: {
            cwd: "/tmp/x",
            flows: ["a.yaml"],
            platform: "ios",
            build: { variant: "release", cache: true },
            metro: "skip",
            env: {},
            priority: 0,
            rebootSimBefore: false,
          },
          status: "queued",
          createdAt: ancient,
        },
      ],
    };
    writeFileSync(queuePath, JSON.stringify(seed));

    const queue = new JobQueue(queuePath);
    queue.load();
    const pruned = queue.prune({
      olderThanMs: retentionMs,
      deleteLogs: true,
      deleteArtifacts: true,
    });

    expect(pruned).toBe(2);
    expect(queue.get("old-success")).toBeUndefined();
    expect(queue.get("old-failed")).toBeUndefined();
    expect(queue.get("fresh")?.id).toBe("fresh");
    expect(queue.get("queued")?.id).toBe("queued");
  });
});
