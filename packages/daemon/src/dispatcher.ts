import { EventEmitter } from "node:events";
import type { Config, DeviceConfig, WorkerInfo } from "@maestroq/core";
import { logger } from "./logger.js";
import type { MetroPortPool } from "./metro-pool.js";
import type { JobQueue } from "./queue.js";
import { Worker, type WorkerEvent } from "./worker.js";

export class Dispatcher extends EventEmitter {
  private readonly workers: Worker[];
  private readonly deviceByUdid: Map<string, DeviceConfig>;

  constructor(
    private readonly queue: JobQueue,
    metroPool: MetroPortPool,
    private readonly config: Config,
    devices: DeviceConfig[],
  ) {
    super();
    this.deviceByUdid = new Map(devices.map((d) => [d.udid, d]));
    this.workers = devices.map((d) => {
      const w = new Worker(d, queue, metroPool, config);
      w.on("event", (ev: WorkerEvent) => {
        this.emit("event", ev);
        if (ev.kind === "idle") this.tick();
      });
      return w;
    });
    if (
      this.config.defaults.runner === "maestro-runner" &&
      this.config.defaults.max_concurrent_ios !== 1
    ) {
      logger.info(
        { max_concurrent_ios: this.config.defaults.max_concurrent_ios },
        "max_concurrent_ios ignored under runner=maestro-runner (every configured iOS device runs in parallel)",
      );
    }
  }

  start(): void {
    this.tick();
  }

  tick(): void {
    // The iOS cap exists because the legacy `maestro` CLI hardcodes the iOS
    // driver host port (7001) — two `maestro test` invocations collide on
    // the same Mac regardless of UDID. maestro-runner uses per-UDID dynamic
    // WDA ports, so the cap is bypassed under that runner.
    const capIos = this.config.defaults.runner === "maestro";
    const iosCap = capIos ? this.config.defaults.max_concurrent_ios : Infinity;
    let iosBusy = this.workers.filter((w) => w.platform === "ios" && w.isBusy()).length;
    for (const w of this.workers) {
      if (w.isBusy()) continue;
      if (w.platform === "ios" && iosBusy >= iosCap) continue;
      if (w.tryStart() && w.platform === "ios") iosBusy += 1;
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

  describeWorkers(): WorkerInfo[] {
    return this.workers.map((w) => {
      const label = this.deviceByUdid.get(w.udid)?.label;
      return {
        udid: w.udid,
        platform: w.platform,
        busy: w.isBusy(),
        ...(label ? { label } : {}),
      };
    });
  }

  // Used by the status RPC to annotate jobs with the friendly device label
  // (read from the current `~/.maestroq/config.yaml`). Returns undefined if
  // the udid doesn't match a configured device or the device has no label.
  getDeviceLabel(udid: string): string | undefined {
    return this.deviceByUdid.get(udid)?.label;
  }
}
