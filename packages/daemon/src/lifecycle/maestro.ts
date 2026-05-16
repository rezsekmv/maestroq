import { execa } from "execa";
import type { DeviceConfig, JobSpec } from "@maestroq/core";

export interface MaestroOptions {
  spec: JobSpec;
  device: DeviceConfig;
  artifactDir: string;
  logSink: (line: string) => void;
  onChildStart: (pid: number) => void;
  finalizeTimeoutMs?: number;
}

export interface MaestroResult {
  exitCode: number;
  killedAfterFinalize: boolean;
}

const FLOWS_SENTINEL = /\b(\d+)\/(\d+) Flows (Passed|Failed)\b/;
const DEFAULT_FINALIZE_TIMEOUT_MS = 30_000;

export async function runMaestro(opts: MaestroOptions): Promise<MaestroResult> {
  const { spec, device, artifactDir, logSink, onChildStart } = opts;
  const finalizeTimeoutMs = opts.finalizeTimeoutMs ?? DEFAULT_FINALIZE_TIMEOUT_MS;
  const args = [
    "--udid",
    device.udid,
    "test",
    "--output",
    artifactDir,
    "--debug-output",
    `${artifactDir}/debug`,
    ...spec.flows,
  ];
  logSink(`[maestro] maestro ${args.join(" ")}`);
  const child = execa("maestro", args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    all: true,
    reject: false,
    detached: true,
  });
  if (child.pid) onChildStart(child.pid);

  let sentinelExitCode: number | undefined;
  let watchdogTimer: NodeJS.Timeout | undefined;
  let killedAfterFinalize = false;
  const pgid = child.pid;

  const armWatchdog = (passed: boolean): void => {
    if (watchdogTimer) return;
    sentinelExitCode = passed ? 0 : 1;
    watchdogTimer = setTimeout(() => {
      if (typeof pgid === "number") {
        try {
          process.kill(-pgid, "SIGKILL");
          killedAfterFinalize = true;
          logSink(`[maestro] watchdog: child did not exit ${finalizeTimeoutMs}ms after finalize, SIGKILLed`);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== "ESRCH") logSink(`[maestro] watchdog kill failed: ${String(err)}`);
        }
      }
    }, finalizeTimeoutMs);
    watchdogTimer.unref();
  };

  child.all?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      logSink(line);
      const m = FLOWS_SENTINEL.exec(line);
      if (m) armWatchdog(m[3] === "Passed");
    }
  });

  const result = await child;
  if (watchdogTimer) clearTimeout(watchdogTimer);

  let exitCode: number;
  if (killedAfterFinalize && sentinelExitCode != null) {
    exitCode = sentinelExitCode;
  } else {
    exitCode = result.exitCode ?? 1;
  }
  return { exitCode, killedAfterFinalize };
}
