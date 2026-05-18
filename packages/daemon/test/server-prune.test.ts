import { mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, encodeMessage, JobSpecSchema, type RpcEvent } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dispatcher } from "../src/dispatcher.js";
import { MetroPortPool } from "../src/metro-pool.js";
import { JobQueue } from "../src/queue.js";
import { startDaemonServer } from "../src/server.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-srv-prune-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readEvents(events: string): RpcEvent[] {
  const out: RpcEvent[] = [];
  for (const line of events.split("\n")) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line) as RpcEvent);
  }
  return out;
}

async function callRpc(socketPath: string, payload: string): Promise<RpcEvent[]> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const events = readEvents(buf);
      if (events.some((e) => e.kind === "end")) {
        socket.end();
        resolve(events);
      }
    });
    socket.on("error", reject);
    socket.once("connect", () => socket.write(payload));
  });
}

const spec = () => JobSpecSchema.parse({ cwd: "/tmp/x", flows: ["a.yaml"], platform: "ios" });

describe("daemon prune RPC", () => {
  it("returns { removed: N } and the queue reflects the deletion", async () => {
    const queue = new JobQueue(join(dir, "queue.json"));
    queue.load();
    const config = ConfigSchema.parse({});
    const pool = new MetroPortPool(config.metro.port_range);
    const dispatcher = new Dispatcher(queue, pool, config, []);
    const socketPath = join(dir, "daemon.sock");
    const pidPath = join(dir, "daemon.pid");
    const server = startDaemonServer({ queue, dispatcher, socketPath, pidPath });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));

    const queued = queue.add(spec());
    const succeeded = queue.add(spec());
    queue.update(succeeded.id, { status: "succeeded", finishedAt: Date.now(), exitCode: 0 });
    const failed = queue.add(spec());
    queue.update(failed.id, { status: "failed", finishedAt: Date.now(), failureReason: "x" });

    try {
      const events = await callRpc(socketPath, encodeMessage({ op: "prune", olderThanMs: 0 }));
      const ok = events.find((e) => e.kind === "ok");
      expect(ok).toBeDefined();
      expect((ok as { payload: { removed: number } }).payload.removed).toBe(2);
      expect(queue.get(queued.id)?.id).toBe(queued.id);
      expect(queue.get(succeeded.id)).toBeUndefined();
      expect(queue.get(failed.id)).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("filters by statuses list", async () => {
    const queue = new JobQueue(join(dir, "queue.json"));
    queue.load();
    const config = ConfigSchema.parse({});
    const pool = new MetroPortPool(config.metro.port_range);
    const dispatcher = new Dispatcher(queue, pool, config, []);
    const socketPath = join(dir, "daemon.sock");
    const pidPath = join(dir, "daemon.pid");
    const server = startDaemonServer({ queue, dispatcher, socketPath, pidPath });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));

    const okJob = queue.add(spec());
    queue.update(okJob.id, { status: "succeeded", finishedAt: Date.now(), exitCode: 0 });
    const koJob = queue.add(spec());
    queue.update(koJob.id, { status: "failed", finishedAt: Date.now(), failureReason: "x" });

    try {
      const events = await callRpc(
        socketPath,
        encodeMessage({ op: "prune", olderThanMs: 0, statuses: ["succeeded"] }),
      );
      const ok = events.find((e) => e.kind === "ok");
      expect((ok as { payload: { removed: number } }).payload.removed).toBe(1);
      expect(queue.get(okJob.id)).toBeUndefined();
      expect(queue.get(koJob.id)?.id).toBe(koJob.id);
    } finally {
      server.close();
    }
  });
});
