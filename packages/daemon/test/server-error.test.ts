import { mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, encodeMessage, type RpcEvent } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dispatcher } from "../src/dispatcher.js";
import { MetroPortPool } from "../src/metro-pool.js";
import { JobQueue } from "../src/queue.js";
import { startDaemonServer } from "../src/server.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-server-err-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function collectResponse(socketPath: string, payload: string): Promise<RpcEvent[]> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const events: RpcEvent[] = [];
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line) as RpcEvent;
        events.push(ev);
        if (ev.kind === "end") {
          socket.end();
          resolve(events);
          return;
        }
      }
    });
    socket.on("error", reject);
    socket.once("connect", () => {
      socket.write(payload);
    });
  });
}

describe("daemon server error path", () => {
  it("emits error then end for malformed JSON", async () => {
    const queue = new JobQueue(join(dir, "queue.json"));
    queue.load();
    const config = ConfigSchema.parse({});
    const pool = new MetroPortPool(config.metro.port_range);
    const dispatcher = new Dispatcher(queue, pool, config, []);
    const socketPath = join(dir, "daemon.sock");
    const pidPath = join(dir, "daemon.pid");
    const server = startDaemonServer({ queue, dispatcher, socketPath, pidPath });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));

    try {
      const events = await collectResponse(socketPath, "not-json\n");
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]?.kind).toBe("error");
      expect(events[events.length - 1]?.kind).toBe("end");
    } finally {
      server.close();
    }
  });

  it("emits error then end for a request that fails RpcRequestSchema", async () => {
    const queue = new JobQueue(join(dir, "queue.json"));
    queue.load();
    const config = ConfigSchema.parse({});
    const pool = new MetroPortPool(config.metro.port_range);
    const dispatcher = new Dispatcher(queue, pool, config, []);
    const socketPath = join(dir, "daemon.sock");
    const pidPath = join(dir, "daemon.pid");
    const server = startDaemonServer({ queue, dispatcher, socketPath, pidPath });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));

    try {
      const events = await collectResponse(
        socketPath,
        encodeMessage({ op: "no-such-op", garbage: true }),
      );
      const errEv = events.find((e) => e.kind === "error");
      const endEv = events.find((e) => e.kind === "end");
      expect(errEv).toBeDefined();
      expect(endEv).toBeDefined();
    } finally {
      server.close();
    }
  });
});
