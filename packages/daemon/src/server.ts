import { createServer, type Server, type Socket } from "node:net";
import { chmodSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  encodeMessage,
  MAESTROQ_HOME,
  PID_PATH,
  RpcRequestSchema,
  SOCKET_PATH,
  type RpcEvent,
  type RpcRequest,
} from "@maestroq/core";
import { logger } from "./logger.js";
import type { JobQueue } from "./queue.js";
import type { Dispatcher } from "./dispatcher.js";

export interface DaemonServerOptions {
  queue: JobQueue;
  dispatcher: Dispatcher;
  socketPath?: string;
  pidPath?: string;
}

interface Client {
  socket: Socket;
  followingJobId?: string;
}

export function startDaemonServer(opts: DaemonServerOptions): Server {
  const socketPath = opts.socketPath ?? SOCKET_PATH;
  const pidPath = opts.pidPath ?? PID_PATH;
  mkdirSync(dirname(socketPath), { recursive: true });
  mkdirSync(MAESTROQ_HOME, { recursive: true });

  try {
    unlinkSync(socketPath);
  } catch {
    // ignore
  }

  const clients = new Set<Client>();

  const server = createServer((socket) => {
    const client: Client = { socket };
    clients.add(client);
    socket.on("close", () => clients.delete(client));
    socket.on("error", (err) => logger.warn({ err }, "client socket error"));

    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        handleLine(client, line, opts).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          send(socket, { kind: "error", message });
        });
      }
    });
  });

  server.listen(socketPath, () => {
    try {
      chmodSync(socketPath, 0o600);
    } catch (err) {
      logger.warn({ err }, "could not chmod socket");
    }
    writeFileSync(pidPath, String(process.pid));
    logger.info({ socketPath, pid: process.pid }, "daemon listening");
  });

  opts.dispatcher.on("event", (ev: RpcEvent) => {
    for (const c of clients) {
      if (ev.kind === "log") {
        if (c.followingJobId && "jobId" in ev && (ev as { jobId?: string }).jobId === c.followingJobId) {
          send(c.socket, ev);
        }
        continue;
      }
      send(c.socket, ev);
    }
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, "daemon shutting down");
    server.close();
    try {
      unlinkSync(socketPath);
    } catch {
      // ignore
    }
    try {
      unlinkSync(pidPath);
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return server;
}

function send(socket: Socket, ev: RpcEvent): void {
  if (socket.destroyed) return;
  socket.write(encodeMessage(ev));
}

async function handleLine(
  client: Client,
  line: string,
  opts: DaemonServerOptions,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    send(client.socket, { kind: "error", message: "invalid JSON" });
    return;
  }
  const req = RpcRequestSchema.safeParse(parsed);
  if (!req.success) {
    send(client.socket, { kind: "error", message: `invalid request: ${req.error.message}` });
    return;
  }
  await dispatchRequest(client, req.data, opts);
}

async function dispatchRequest(
  client: Client,
  req: RpcRequest,
  opts: DaemonServerOptions,
): Promise<void> {
  switch (req.op) {
    case "ping":
      send(client.socket, { kind: "ok", payload: { pong: true } });
      send(client.socket, { kind: "end" });
      return;

    case "devices": {
      const workers = opts.dispatcher.describeWorkers();
      send(client.socket, { kind: "ok", payload: { devices: workers } });
      send(client.socket, { kind: "end" });
      return;
    }

    case "submit": {
      const record = opts.queue.add(req.spec);
      opts.dispatcher.tick();
      send(client.socket, { kind: "ok", payload: { jobId: record.id } });
      send(client.socket, { kind: "end" });
      return;
    }

    case "status": {
      const data = req.jobId
        ? opts.queue.get(req.jobId)
        : opts.queue.all().sort((a, b) => a.createdAt - b.createdAt);
      send(client.socket, { kind: "ok", payload: { jobs: data } });
      send(client.socket, { kind: "end" });
      return;
    }

    case "logs": {
      const job = opts.queue.get(req.jobId);
      if (!job) {
        send(client.socket, { kind: "error", message: `unknown job: ${req.jobId}` });
        send(client.socket, { kind: "end" });
        return;
      }
      if (job.logPath) {
        try {
          const existing = readFileSync(job.logPath, "utf8");
          for (const line of existing.split("\n")) if (line) send(client.socket, { kind: "log", line });
        } catch {
          // file may not exist yet
        }
      }
      if (req.follow && job.status !== "succeeded" && job.status !== "failed" && job.status !== "cancelled") {
        client.followingJobId = job.id;
      } else {
        send(client.socket, { kind: "end" });
      }
      return;
    }

    case "cancel": {
      const ok = opts.dispatcher.cancel(req.jobId);
      send(client.socket, {
        kind: ok ? "ok" : "error",
        ...(ok ? { payload: { cancelled: req.jobId } } : { message: "could not cancel" }),
      } as RpcEvent);
      send(client.socket, { kind: "end" });
      return;
    }

    case "shutdown": {
      send(client.socket, { kind: "ok" });
      send(client.socket, { kind: "end" });
      setImmediate(() => process.kill(process.pid, "SIGTERM"));
      return;
    }

    default: {
      const _exhaustive: never = req;
      void _exhaustive;
    }
  }
}
