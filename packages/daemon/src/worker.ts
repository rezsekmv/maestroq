import { EventEmitter } from "node:events";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
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

export type WorkerEvent =
  | { kind: "status"; jobId: string; status: JobStatus; exitCode?: number; failureReason?: string }
  | { kind: "log"; jobId: string; line: string }
  | { kind: "idle"; deviceUdid: string };

export class Worker extends EventEmitter {
  private busy = false;
  private cancelled = new Set<string>();
  private activePgid?: number;
  private readonly cancelGraceMs = 5_000;

  constructor(
    private readonly device: DeviceConfig,
    private readonly queue: JobQueue,
    private readonly metroPool: MetroPortPool,
    private readonly config: Config,
  ) {
    super();
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
    this.cancelled.add(jobId);
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

  tryStart(): boolean {
    if (this.busy) return false;
    const next = this.queue.nextQueued(this.device.platform);
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
    const logDir = expandHome(this.config.log_dir);
    const artifactDir = expandHome(this.config.artifact_dir);
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `${job.id}.log`);
    mkdirSync(dirname(logPath), { recursive: true });
    const logStream = createWriteStream(logPath, { flags: "a" });

    const sink = (line: string): void => {
      logStream.write(`${line}\n`);
      this.emit("event", { kind: "log", jobId: job.id, line } satisfies WorkerEvent);
    };

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
      if (this.cancelledCheck(job.id, sink, logStream)) return;

      await bootDevice({
        device: this.device,
        rebootSimBefore: job.spec.rebootSimBefore || this.config.defaults.reboot_sim_before,
        logSink: sink,
      });

      if (this.cancelledCheck(job.id, sink, logStream)) return;

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
      if (this.cancelledCheck(job.id, sink, logStream)) return;

      if (variant === "debug" && job.spec.metro !== "skip") {
        this.setStatus(job.id, "metro-starting");
        metroHandle = await startMetro({
          spec: job.spec,
          pool: this.metroPool,
          worktreeKey,
          reuse: job.spec.metro.reuse,
          logSink: sink,
        });
      }

      this.setStatus(job.id, "running");
      if (this.cancelledCheck(job.id, sink, logStream)) return;

      const jobArtifactDir = join(artifactDir, job.id);
      mkdirSync(jobArtifactDir, { recursive: true });
      const result = await runMaestro({
        spec: job.spec,
        device: this.device,
        runner: this.config.defaults.runner,
        artifactDir: jobArtifactDir,
        logSink: sink,
        onChildStart: trackChild,
      });

      this.setStatus(job.id, "tearing-down");
      await teardownJob({
        device: this.device,
        runner: this.config.defaults.runner,
        metroHandle,
        logSink: sink,
      });

      if (this.cancelled.has(job.id)) {
        this.queue.update(job.id, { finishedAt: Date.now(), exitCode: result.exitCode });
        this.setStatus(job.id, "cancelled", { exitCode: result.exitCode });
      } else if (result.exitCode === 0) {
        this.queue.update(job.id, { finishedAt: Date.now(), exitCode: 0 });
        this.setStatus(job.id, "succeeded", { exitCode: 0 });
      } else {
        this.queue.update(job.id, {
          finishedAt: Date.now(),
          exitCode: result.exitCode,
          failureReason: `maestro exit ${result.exitCode}`,
        });
        this.setStatus(job.id, "failed", {
          exitCode: result.exitCode,
          failureReason: `maestro exit ${result.exitCode}`,
        });
      }
    } catch (err) {
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
      this.setStatus(job.id, this.cancelled.has(job.id) ? "cancelled" : "failed", {
        failureReason: message,
      });
    } finally {
      this.cancelled.delete(job.id);
      logStream.end();
    }
  }

  private cancelledCheck(
    jobId: string,
    sink: (l: string) => void,
    logStream: WriteStream,
  ): boolean {
    if (!this.cancelled.has(jobId)) return false;
    sink("[cancel] requested before stage advanced");
    this.queue.update(jobId, { finishedAt: Date.now(), failureReason: "cancelled" });
    this.setStatus(jobId, "cancelled");
    logStream.end();
    return true;
  }

  private setStatus(
    jobId: string,
    status: JobStatus,
    extra?: { exitCode?: number; failureReason?: string },
  ): void {
    this.queue.update(jobId, { status, ...(extra ?? {}) });
    this.emit("event", { kind: "status", jobId, status, ...(extra ?? {}) } satisfies WorkerEvent);
  }
}
