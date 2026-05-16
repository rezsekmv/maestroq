import { createConnection, type Socket } from "node:net";
import { existsSync } from "node:fs";
import { SOCKET_PATH, type RpcEvent, type RpcRequest, encodeMessage } from "@maestroq/core";

export const DAEMON_HINT =
  "daemon not running; run `mq daemon start` (see docs/launchd.md to install as a service)";

export class DaemonNotRunningError extends Error {
  constructor() {
    super(DAEMON_HINT);
    this.name = "DaemonNotRunningError";
  }
}

export interface RpcClient {
  send(req: RpcRequest): AsyncIterable<RpcEvent>;
  close(): void;
}

export function connect(socketPath: string = SOCKET_PATH): Promise<RpcClient> {
  return new Promise((resolve, reject) => {
    if (!existsSync(socketPath)) {
      reject(new DaemonNotRunningError());
      return;
    }
    const socket = createConnection(socketPath);
    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
        reject(new DaemonNotRunningError());
        return;
      }
      reject(err);
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve(buildClient(socket));
    });
  });
}

function buildClient(socket: Socket): RpcClient {
  return {
    send(req): AsyncIterable<RpcEvent> {
      socket.write(encodeMessage(req));
      return readEvents(socket);
    },
    close(): void {
      socket.end();
    },
  };
}

async function* readEvents(socket: Socket): AsyncIterable<RpcEvent> {
  let buffer = "";
  let socketClosed = false;
  const queue: RpcEvent[] = [];
  let resolveWait: (() => void) | undefined;

  const wakeup = (): void => {
    if (resolveWait) {
      const r = resolveWait;
      resolveWait = undefined;
      r();
    }
  };

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        queue.push(JSON.parse(line) as RpcEvent);
      } catch {
        queue.push({ kind: "error", message: `bad line from daemon: ${line}` });
      }
    }
    wakeup();
  });
  socket.on("close", () => {
    socketClosed = true;
    wakeup();
  });

  while (true) {
    if (queue.length === 0) {
      if (socketClosed) return;
      await new Promise<void>((r) => {
        resolveWait = r;
      });
      continue;
    }
    const ev = queue.shift()!;
    yield ev;
    if (ev.kind === "end") return;
  }
}
