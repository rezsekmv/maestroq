import { EventEmitter } from "node:events";
import type { Config, DeviceConfig } from "@maestroq/core";
import type { JobQueue } from "./queue.js";
import type { MetroPortPool } from "./metro-pool.js";
import { Worker, type WorkerEvent } from "./worker.js";
import { logger } from "./logger.js";

export class Dispatcher extends EventEmitter {
  private readonly workers: Worker[];

  constructor(
    private readonly queue: JobQueue,
    metroPool: MetroPortPool,
    config: Config,
    devices: DeviceConfig[],
  ) {
    super();
    this.workers = devices.map((d) => {
      const w = new Worker(d, queue, metroPool, config);
      w.on("event", (ev: WorkerEvent) => {
        this.emit("event", ev);
        if (ev.kind === "idle") this.tick();
      });
      return w;
    });
  }

  start(): void {
    this.tick();
  }

  tick(): void {
    for (const w of this.workers) {
      if (!w.isBusy()) w.tryStart();
    }
  }

  cancel(jobId: string): boolean {
    const job = this.queue.get(jobId);
    if (!job) return false;
    if (job.status === "queued") {
      this.queue.update(jobId, { status: "cancelled", finishedAt: Date.now() });
      this.emit("event", { kind: "status", jobId, status: "cancelled" } satisfies WorkerEvent);
      return true;
    }
    const w = this.workers.find((x) => x.udid === job.deviceUdid);
    if (!w) {
      logger.warn({ jobId, udid: job.deviceUdid }, "cancel: no worker matches deviceUdid");
      return false;
    }
    return w.cancel(jobId);
  }

  describeWorkers(): Array<{ udid: string; platform: string; busy: boolean; label?: string }> {
    return this.workers.map((w) => ({
      udid: w.udid,
      platform: w.platform,
      busy: w.isBusy(),
      ...((): { label?: string } => {
        return {};
      })(),
    }));
  }
}
