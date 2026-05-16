import { execa, type ResultPromise } from "execa";
import type { JobSpec } from "@maestroq/core";
import type { MetroLease, MetroPortPool } from "../metro-pool.js";

export interface MetroHandle {
  lease: MetroLease;
  pid?: number;
  stop: () => Promise<void>;
}

const liveMetros = new Map<number, { child: ResultPromise }>();

export interface StartMetroOptions {
  spec: JobSpec;
  pool: MetroPortPool;
  worktreeKey: string;
  reuse: boolean;
  logSink: (line: string) => void;
}

export async function startMetro(opts: StartMetroOptions): Promise<MetroHandle> {
  const { spec, pool, worktreeKey, reuse, logSink } = opts;
  const lease = pool.acquire(worktreeKey, reuse);
  const existing = liveMetros.get(lease.port);
  if (existing) {
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

  const args = ["expo", "start", "--port", String(lease.port), "--dev-client"];
  logSink(`[metro] npx ${args.join(" ")}`);
  const child = execa("npx", args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    all: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  liveMetros.set(lease.port, { child });
  if (child.pid) pool.attachPid(lease.port, child.pid);
  child.all?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) if (line) logSink(`[metro:${lease.port}] ${line}`);
  });
  child.catch(() => undefined);

  await waitForMetroReady(lease.port);

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

async function waitForMetroReady(port: number, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      if (res.ok) {
        const text = await res.text();
        if (text.includes("packager-status:running")) return;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`metro: did not become ready on port ${port} within ${timeoutMs}ms`);
}
