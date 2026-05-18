import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetLiveMetrosForTest, startMetro } from "../src/lifecycle/metro.js";
import { MetroPortPool } from "../src/metro-pool.js";

let dir: string;
let oldPath: string | undefined;
let stub: Server | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-metro-exit-"));
  oldPath = process.env.PATH;
  _resetLiveMetrosForTest();
});

afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
  if (oldPath !== undefined) process.env.PATH = oldPath;
  _resetLiveMetrosForTest();
  if (stub) {
    await new Promise<void>((resolve) => stub?.close(() => resolve()));
    stub = undefined;
  }
});

function installFakeNpx(body: string): void {
  const path = join(dir, "npx");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
}

function startStatusStub(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    stub = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("packager-status:running");
    });
    stub.once("error", reject);
    stub.listen(port, "127.0.0.1", () => resolve());
  });
}

const spec = JobSpecSchema.parse({
  cwd: "/tmp",
  flows: ["a.yaml"],
  platform: "ios",
});

describe("startMetro on child exit", () => {
  it("clears liveMetros so the next acquire spawns a fresh child", async () => {
    const port = 18181;
    await startStatusStub(port);
    installFakeNpx(`exec sleep 30`);

    const pool = new MetroPortPool([port, port]);
    const handle1 = await startMetro({
      spec,
      pool,
      worktreeKey: "wt-a",
      reuse: false,
      logSink: () => undefined,
    });
    const pid1 = handle1.pid;
    expect(pid1).toBeDefined();
    if (pid1) {
      try {
        process.kill(-pid1, "SIGKILL");
      } catch {
        // ignore
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    await handle1.stop().catch(() => undefined);

    const handle2 = await startMetro({
      spec,
      pool,
      worktreeKey: "wt-b",
      reuse: false,
      logSink: () => undefined,
    });
    expect(handle2.pid).toBeDefined();
    expect(handle2.pid).not.toBe(pid1);

    if (handle2.pid) {
      try {
        process.kill(-handle2.pid, "SIGKILL");
      } catch {
        // ignore
      }
    }
    await handle2.stop().catch(() => undefined);
  }, 20_000);
});
