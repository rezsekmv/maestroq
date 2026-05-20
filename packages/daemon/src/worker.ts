import { EventEmitter } from "node:events";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Config, DeviceConfig, JobRecord, JobStatus } from "@maestroq/core";
import { expandHome } from "@maestroq/core";
import { decideCache, gitHead, hashEnv, recordSuccessfulBuild } from "./build-cache.js";
import { bootDevice } from "./lifecycle/boot.js";
import { buildApp } from "./lifecycle/build.js";
import { runMaestro } from "./lifecycle/maestro.js";
import { type MetroHandle, startMetro } from "./lifecycle/metro.js";
import { teardownJob } from "./lifecycle/teardown.js";
import { logger } from "./logger.js";
import type { MetroPortPool } from "./metro-pool.js";
import type { JobQueue } from "./queue.js";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export type WorkerEvent =
  | { kind: "status"; jobId: string; status: JobStatus; exitCode?: number; failureReason?: string }
  | { kind: "log"; jobId: string; line: string }
  | { kind: "idle"; deviceUdid: string };

// Quarantine cool-down sequence after N consecutive `error` outcomes.
// Doubles roughly each step, capped at 1h. Reset by any non-error terminal.
const QUARANTINE_BACKOFF_MS = [30_000, 5 * 60_000, 30 * 60_000, 60 * 60_000];
const QUARANTINE_THRESHOLD = 3;

export class Worker extends EventEmitter {
  private busy = false;
  private cancelled = new Set<string>();
  private activePgid?: number;
  private abortController?: AbortController;
  private readonly cancelGraceMs: number;
  // Failure-aware dispatch. After QUARANTINE_THRESHOLD consecutive `error`
  // outcomes (boot/build/install/recovery — *not* test-level `failed`),
  // skip this worker until `quarantinedUntil`. Resets on any non-error
  // terminal status. Lets the dispatcher route around a flaky worker
  // without manual config edits.
  private consecutiveErrors = 0;
  private quarantineLevel = 0;
  private quarantinedUntil?: number;

  constructor(
    private readonly device: DeviceConfig,
    private readonly queue: JobQueue,
    private readonly metroPool: MetroPortPool,
    private readonly config: Config,
  ) {
    super();
    this.cancelGraceMs = config.defaults.cancel_grace_ms;
  }

  get udid(): string {
    return this.device.udid;
  }

  get platform(): DeviceConfig["platform"] {
    return this.device.platform;
  }

  isBusy(): boolean {
    return this.busy;
  }

  cancel(jobId: string): boolean {
    if (this.queue.isTerminal(jobId)) return false;
    this.cancelled.add(jobId);
    this.abortController?.abort();
    const pgid = this.activePgid;
    if (!pgid || typeof pgid !== "number") return false;
    try {
      process.kill(-pgid, "SIGTERM");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ESRCH") logger.warn({ err, pgid }, "cancel: SIGTERM failed");
      return false;
    }
    const escalation = setTimeout(() => {
      if (this.activePgid !== pgid) return;
      try {
        process.kill(-pgid, 0);
      } catch {
        return;
      }
      try {
        process.kill(-pgid, "SIGKILL");
        logger.warn({ pgid }, "cancel: escalated to SIGKILL after grace");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ESRCH") logger.warn({ err, pgid }, "cancel: SIGKILL failed");
      }
    }, this.cancelGraceMs);
    escalation.unref();
    return true;
  }

  // True while the worker is quarantined — the dispatcher should skip it.
  // Quarantine auto-expires when `Date.now() >= quarantinedUntil`.
  isQuarantined(now: number = Date.now()): boolean {
    return this.quarantinedUntil !== undefined && this.quarantinedUntil > now;
  }

  // Exposed for `maestroq devices` so users can see *why* a worker is idle.
  getQuarantinedUntil(): number | undefined {
    return this.isQuarantined() ? this.quarantinedUntil : undefined;
  }

  // Called by `run` once a job reaches a terminal status. Tracks consecutive
  // `error` outcomes and arms / extends quarantine. Any other terminal
  // resets the counter — a worker that's producing real test verdicts
  // (`succeeded`, `failed`) or that just got a `cancelled` is healthy.
  private recordOutcome(status: JobStatus): void {
    if (status === "error") {
      this.consecutiveErrors += 1;
      if (this.consecutiveErrors >= QUARANTINE_THRESHOLD) {
        const idx = Math.min(this.quarantineLevel, QUARANTINE_BACKOFF_MS.length - 1);
        const backoff = QUARANTINE_BACKOFF_MS[idx] ?? 60 * 60_000;
        this.quarantinedUntil = Date.now() + backoff;
        this.quarantineLevel += 1;
        logger.warn(
          {
            udid: this.device.udid,
            consecutiveErrors: this.consecutiveErrors,
            backoffMs: backoff,
            quarantinedUntil: this.quarantinedUntil,
          },
          "worker: quarantined after consecutive errors",
        );
      }
    } else {
      // Any non-error terminal — including `failed` — clears the active
      // streak: the worker is producing real test verdicts again. Keep
      // `quarantineLevel` though — a worker that flakes, recovers for one
      // job, then flakes again should escalate (5m → 30m → 1h), not reset
      // to 30s every time. Level effectively persists for the daemon's
      // lifetime; restart wipes it.
      if (this.consecutiveErrors > 0 || this.quarantinedUntil !== undefined) {
        logger.info(
          { udid: this.device.udid, after: status, quarantineLevel: this.quarantineLevel },
          "worker: error counter + active quarantine cleared (level retained)",
        );
      }
      this.consecutiveErrors = 0;
      this.quarantinedUntil = undefined;
    }
  }

  tryStart(): boolean {
    if (this.busy) return false;
    if (this.isQuarantined()) return false;
    const next = this.queue.nextQueued(this.device.platform, this.device.udid);
    if (!next) return false;
    this.busy = true;
    void this.run(next).finally(() => {
      this.busy = false;
      this.activePgid = undefined;
      this.emit("event", { kind: "idle", deviceUdid: this.device.udid } satisfies WorkerEvent);
    });
    return true;
  }

  private async run(job: JobRecord): Promise<void> {
    this.abortController = new AbortController();
    const logDir = expandHome(this.config.log_dir);
    const artifactDir = expandHome(this.config.artifact_dir);
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, todayISO(), `${job.id}.log`);
    mkdirSync(dirname(logPath), { recursive: true });
    const logStream = createWriteStream(logPath, { flags: "a" });

    const sink = (line: string): void => {
      logStream.write(`${line}\n`);
      this.emit("event", { kind: "log", jobId: job.id, line } satisfies WorkerEvent);
    };

    // Flush + close the log before emitting a terminal status. Without this,
    // readers tailing logPath after seeing terminal can miss the final lines
    // because WriteStream.end is async.
    const closeLog = (): Promise<void> =>
      new Promise<void>((resolve) => {
        if (logStream.writableEnded) resolve();
        else logStream.end(resolve);
      });

    const trackChild = (pid: number): void => {
      this.activePgid = pid;
      this.queue.update(job.id, { pgid: pid });
    };

    this.queue.update(job.id, {
      deviceUdid: this.device.udid,
      startedAt: Date.now(),
      logPath,
    });

    this.setStatus(job.id, "building");
    let metroHandle: MetroHandle | undefined;
    const variant = job.spec.build === "skip" ? "release" : job.spec.build.variant;
    const worktreeKey = job.spec.cwd;

    try {
      if (await this.cancelledCheck(job.id, sink, closeLog)) return;

      await bootDevice({
        device: this.device,
        rebootSimBefore: job.spec.rebootSimBefore || this.config.defaults.reboot_sim_before,
        logSink: sink,
      });

      if (await this.cancelledCheck(job.id, sink, closeLog)) return;

      if (job.spec.build === "skip") {
        sink("[build] skipped (spec.build = 'skip')");
      } else {
        const decision = await decideCache(job.spec, variant, this.device.udid);
        sink(`[build] cache: ${decision.reason}${decision.use ? " (skipping build)" : ""}`);
        if (!decision.use) {
          await buildApp({
            spec: job.spec,
            device: this.device,
            variant,
            logSink: sink,
            onChildStart: trackChild,
          });
          const head = await gitHead(job.spec.cwd);
          recordSuccessfulBuild(
            {
              cwd: job.spec.cwd,
              head,
              platform: job.spec.platform,
              variant,
              envHash: hashEnv(job.spec.env),
            },
            this.device.udid,
          );
        }
      }

      this.setStatus(job.id, "installing");
      if (await this.cancelledCheck(job.id, sink, closeLog)) return;

      if (variant === "debug" && job.spec.metro !== "skip") {
        this.setStatus(job.id, "metro-starting");
        metroHandle = await startMetro({
          spec: job.spec,
          pool: this.metroPool,
          worktreeKey,
          reuse: job.spec.metro.reuse,
          logSink: sink,
          signal: this.abortController?.signal,
          readyTimeoutMs: this.config.defaults.metro_ready_timeout_ms,
        });
      }

      this.setStatus(job.id, "running");
      if (await this.cancelledCheck(job.id, sink, closeLog)) return;

      const jobArtifactDir = join(artifactDir, job.id);
      mkdirSync(jobArtifactDir, { recursive: true });
      this.queue.update(job.id, { artifactDir: jobArtifactDir });
      const result = await runMaestro({
        spec: job.spec,
        device: this.device,
        runner: this.config.defaults.runner,
        artifactDir: jobArtifactDir,
        logSink: sink,
        onChildStart: trackChild,
        finalizeTimeoutMs: this.config.defaults.maestro_finalize_timeout_ms,
      });

      this.setStatus(job.id, "tearing-down");
      await teardownJob({
        device: this.device,
        runner: this.config.defaults.runner,
        metroHandle,
        logSink: sink,
      });

      // Persist flow counts whenever the maestro phase emitted a TOTAL line,
      // regardless of pass/fail. Lets `status -l` show "failed 1/30" etc.
      const flowFields = {
        ...(result.flowsTotal !== undefined ? { flowsTotal: result.flowsTotal } : {}),
        ...(result.flowsFailed !== undefined ? { flowsFailed: result.flowsFailed } : {}),
      };

      if (this.cancelled.has(job.id)) {
        this.queue.update(job.id, {
          finishedAt: Date.now(),
          exitCode: result.exitCode,
          ...flowFields,
        });
        await closeLog();
        this.setStatus(job.id, "cancelled", { exitCode: result.exitCode });
      } else if (result.exitCode === 0) {
        this.queue.update(job.id, { finishedAt: Date.now(), exitCode: 0, ...flowFields });
        await closeLog();
        this.setStatus(job.id, "succeeded", { exitCode: 0 });
      } else {
        // Maestro ran but exited non-zero. If we have flow counts the failure
        // is "tests failed" (status: failed). If we don't, the runner itself
        // errored before producing a TOTAL — treat as setup error.
        const isFlowFailure = result.flowsTotal !== undefined && result.flowsTotal > 0;
        const terminalStatus: JobStatus = isFlowFailure ? "failed" : "error";
        const reason = isFlowFailure
          ? `${result.flowsFailed}/${result.flowsTotal} flows failed`
          : `maestro exit ${result.exitCode} before tests started`;
        this.queue.update(job.id, {
          finishedAt: Date.now(),
          exitCode: result.exitCode,
          failureReason: reason,
          ...flowFields,
        });
        await closeLog();
        this.setStatus(job.id, terminalStatus, {
          exitCode: result.exitCode,
          failureReason: reason,
        });
      }
    } catch (err) {
      // Reached only when bootDevice / buildApp / startMetro / runMaestro
      // (or anything in this try block) threw. That's a setup/infrastructure
      // problem, distinct from "tests ran and failed" — record as `error`.
      const message = err instanceof Error ? err.message : String(err);
      sink(`[error] ${message}`);
      try {
        await teardownJob({
          device: this.device,
          runner: this.config.defaults.runner,
          metroHandle,
          logSink: sink,
        });
      } catch (teardownErr) {
        const teardownMessage =
          teardownErr instanceof Error ? teardownErr.message : String(teardownErr);
        sink(`[teardown-error] ${teardownMessage}`);
      }
      this.queue.update(job.id, { finishedAt: Date.now(), failureReason: message });
      await closeLog();
      this.setStatus(job.id, this.cancelled.has(job.id) ? "cancelled" : "error", {
        failureReason: message,
      });
    } finally {
      this.cancelled.delete(job.id);
      this.abortController = undefined;
      if (!logStream.writableEnded) logStream.end();
    }
  }

  private async cancelledCheck(
    jobId: string,
    sink: (l: string) => void,
    closeLog: () => Promise<void>,
  ): Promise<boolean> {
    if (!this.cancelled.has(jobId)) return false;
    sink("[cancel] requested before stage advanced");
    this.queue.update(jobId, { finishedAt: Date.now(), failureReason: "cancelled" });
    await closeLog();
    this.setStatus(jobId, "cancelled");
    return true;
  }

  private setStatus(
    jobId: string,
    status: JobStatus,
    extra?: { exitCode?: number; failureReason?: string },
  ): void {
    this.queue.update(jobId, { status, ...(extra ?? {}) });
    this.emit("event", { kind: "status", jobId, status, ...(extra ?? {}) } satisfies WorkerEvent);
    // Track terminal outcomes for failure-aware dispatch. Non-terminal status
    // updates (queued, building, …) don't influence quarantine.
    if (
      status === "succeeded" ||
      status === "failed" ||
      status === "error" ||
      status === "cancelled"
    ) {
      this.recordOutcome(status);
    }
  }
}
