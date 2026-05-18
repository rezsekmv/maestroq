import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobQueue } from "../src/queue.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-prune-"));
  path = join(dir, "queue.json");
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

describe("JobQueue.prune", () => {
  it("removes terminal entries and leaves active/queued ones alone", () => {
    const q = new JobQueue(path);
    q.load();
    const queued = q.add(spec());
    const succeeded = q.add(spec());
    q.update(succeeded.id, { status: "succeeded", finishedAt: Date.now(), exitCode: 0 });
    const failed = q.add(spec());
    q.update(failed.id, { status: "failed", finishedAt: Date.now(), failureReason: "x" });
    const cancelled = q.add(spec());
    q.update(cancelled.id, { status: "cancelled", finishedAt: Date.now() });
    const running = q.add(spec());
    q.update(running.id, { status: "running" });

    const removed = q.prune({ olderThanMs: 0 });
    expect(removed).toBe(3);
    expect(q.get(queued.id)?.id).toBe(queued.id);
    expect(q.get(running.id)?.id).toBe(running.id);
    expect(q.get(succeeded.id)).toBeUndefined();
    expect(q.get(failed.id)).toBeUndefined();
    expect(q.get(cancelled.id)).toBeUndefined();
  });

  it("keeps terminal entries that are still within the retention window", () => {
    const q = new JobQueue(path);
    q.load();
    const recent = q.add(spec());
    q.update(recent.id, { status: "succeeded", finishedAt: Date.now(), exitCode: 0 });
    const old = q.add(spec());
    q.update(old.id, {
      status: "succeeded",
      finishedAt: Date.now() - 10 * 60_000,
      exitCode: 0,
    });

    const removed = q.prune({ olderThanMs: 5 * 60_000 });
    expect(removed).toBe(1);
    expect(q.get(recent.id)?.id).toBe(recent.id);
    expect(q.get(old.id)).toBeUndefined();
  });

  it("returns 0 and skips persist when nothing matches", () => {
    const q = new JobQueue(path);
    q.load();
    q.add(spec());
    expect(q.prune({ olderThanMs: 0 })).toBe(0);
    expect(q.all()).toHaveLength(1);
  });

  it("deletes recorded logs when deleteLogs is true", () => {
    const q = new JobQueue(path);
    q.load();
    const logPath = join(dir, "logs", "2026-01-01", "job.log");
    mkdirSync(join(dir, "logs", "2026-01-01"), { recursive: true });
    writeFileSync(logPath, "log content");
    const job = q.add(spec());
    q.update(job.id, {
      status: "succeeded",
      finishedAt: Date.now(),
      exitCode: 0,
      logPath,
    });

    expect(existsSync(logPath)).toBe(true);
    const removed = q.prune({ olderThanMs: 0, deleteLogs: true });
    expect(removed).toBe(1);
    expect(existsSync(logPath)).toBe(false);
  });

  it("recursively removes artifactDir when deleteArtifacts is true", () => {
    const q = new JobQueue(path);
    q.load();
    const artDir = join(dir, "artifacts", "job");
    mkdirSync(artDir, { recursive: true });
    writeFileSync(join(artDir, "out.txt"), "out");
    const job = q.add(spec());
    q.update(job.id, {
      status: "failed",
      finishedAt: Date.now(),
      failureReason: "x",
      artifactDir: artDir,
    });

    const removed = q.prune({ olderThanMs: 0, deleteArtifacts: true });
    expect(removed).toBe(1);
    expect(existsSync(artDir)).toBe(false);
  });

  it("filters by explicit statuses list", () => {
    const q = new JobQueue(path);
    q.load();
    const ok = q.add(spec());
    q.update(ok.id, { status: "succeeded", finishedAt: Date.now() });
    const ko = q.add(spec());
    q.update(ko.id, { status: "failed", finishedAt: Date.now() });

    const removed = q.prune({ olderThanMs: 0, statuses: ["succeeded"] });
    expect(removed).toBe(1);
    expect(q.get(ok.id)).toBeUndefined();
    expect(q.get(ko.id)?.id).toBe(ko.id);
  });
});
