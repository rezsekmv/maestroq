import type { JobSpec } from "@maestroq/core";
import { execa, type ResultPromise } from "execa";
import type { MetroLease, MetroPortPool } from "../metro-pool.js";

export interface MetroHandle {
  lease: MetroLease;
  pid?: number;
  stop: () => Promise<void>;
}

interface LiveMetro {
  child: ResultPromise;
  alive: boolean;
}

const liveMetros = new Map<number, LiveMetro>();

export interface StartMetroOptions {
  spec: JobSpec;
  pool: MetroPortPool;
  worktreeKey: string;
  reuse: boolean;
  logSink: (line: string) => void;
  signal?: AbortSignal;
}

export async function startMetro(opts: StartMetroOptions): Promise<MetroHandle> {
  const { spec, pool, worktreeKey, reuse, logSink, signal } = opts;
  const lease = pool.acquire(worktreeKey, reuse);
  const existing = liveMetros.get(lease.port);
  if (existing?.alive && existing.child.exitCode === null) {
    logSink(`[metro] reusing port ${lease.port}`);
    return {
      lease,
      pid: lease.pid,
      stop: async () => {
        const released = pool.release(lease.port);
        if (released && released.refCount <= 0) {
          await stopMetroProcess(lease.port);
        }
      },
    };
  }
  if (existing && !existing.alive) {
    liveMetros.delete(lease.port);
  }

  const args = ["expo", "start", "--port", String(lease.port), "--dev-client"];
  logSink(`[metro] npx ${args.join(" ")}`);
  const child = execa("npx", args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    all: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entry: LiveMetro = { child, alive: true };
  liveMetros.set(lease.port, entry);
  if (child.pid) pool.attachPid(lease.port, child.pid);
  const onData = (chunk: Buffer): void => {
    for (const line of chunk.toString("utf8").split(/\r?\n/))
      if (line) logSink(`[metro:${lease.port}] ${line}`);
  };
  child.all?.on("data", onData);
  child.on("exit", () => {
    entry.alive = false;
    child.all?.off("data", onData);
    if (liveMetros.get(lease.port) === entry) liveMetros.delete(lease.port);
  });
  child.catch(() => undefined);

  await waitForMetroReady(lease.port, undefined, signal);

  return {
    lease,
    pid: child.pid,
    stop: async () => {
      const released = pool.release(lease.port);
      if (released && released.refCount <= 0) {
        await stopMetroProcess(lease.port);
      }
    },
  };
}

async function stopMetroProcess(port: number): Promise<void> {
  const entry = liveMetros.get(port);
  if (!entry) return;
  liveMetros.delete(port);
  try {
    if (entry.child.pid) {
      try {
        process.kill(-entry.child.pid, "SIGTERM");
      } catch {
        try {
          entry.child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
    }
    await entry.child.catch(() => undefined);
  } catch {
    // ignore
  }
}

export async function waitForMetroReady(
  port: number,
  timeoutMs: number = 60_000,
  signal?: AbortSignal,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) throw new Error("metro: aborted while waiting for ready");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`, { signal });
      if (res.ok) {
        const text = await res.text();
        if (text.includes("packager-status:running")) return;
      }
    } catch {
      if (signal?.aborted) throw new Error("metro: aborted while waiting for ready");
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`metro: did not become ready on port ${port} within ${timeoutMs}ms`);
}

export function _resetLiveMetrosForTest(): void {
  liveMetros.clear();
}
