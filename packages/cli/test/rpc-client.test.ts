import { mkdtempSync, rmSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeMessage } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEvents } from "../src/rpc-client.js";

let dir: string;
let server: Server | undefined;
let serverSocket: Socket | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-rpc-client-"));
});

afterEach(async () => {
  if (serverSocket) {
    serverSocket.destroy();
    serverSocket = undefined;
  }
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
  rmSync(dir, { recursive: true, force: true });
});

function startServer(socketPath: string, onConnection: (socket: Socket) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    server = createServer((socket) => {
      serverSocket = socket;
      onConnection(socket);
    });
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
}

function connectClient(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.once("error", reject);
    socket.once("connect", () => resolve(socket));
  });
}

describe("rpc-client readEvents", () => {
  it("removes data and close listeners when the consumer breaks early", async () => {
    const socketPath = join(dir, "test.sock");
    await startServer(socketPath, (socket) => {
      socket.on("data", () => {
        socket.write(encodeMessage({ kind: "ok", payload: { pong: true } }));
        socket.write(encodeMessage({ kind: "ok", payload: { extra: true } }));
      });
    });

    const socket = await connectClient(socketPath);
    socket.write(encodeMessage({ op: "ping" }));

    const iter = readEvents(socket);
    for await (const ev of iter) {
      expect(ev.kind).toBe("ok");
      break;
    }

    expect(socket.listenerCount("data")).toBe(0);
    expect(socket.listenerCount("close")).toBe(0);
    socket.destroy();
  });

  it("throws when a single line exceeds the 8MB limit without a newline", async () => {
    const socketPath = join(dir, "test-overflow.sock");
    await startServer(socketPath, (socket) => {
      socket.on("data", () => {
        const chunk = Buffer.alloc(1024 * 1024, 0x41);
        const sendChunk = (): void => {
          if (socket.destroyed) return;
          socket.write(chunk, () => {
            setImmediate(sendChunk);
          });
        };
        sendChunk();
      });
    });

    const socket = await connectClient(socketPath);
    socket.write(encodeMessage({ op: "ping" }));

    let err: unknown;
    try {
      for await (const _ev of readEvents(socket)) {
        // wait for overflow error
      }
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toMatch(/exceeded/i);
    socket.destroy();
  }, 15_000);
});
