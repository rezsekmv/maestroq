import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import {
  CONFIG_PATH,
  type Config,
  ConfigSchema,
  LOCK_PATH,
  loadConfig,
  MAESTROQ_HOME,
  QUEUE_PATH,
} from "@maestroq/core";
import { lock } from "proper-lockfile";
import { loadPersistedCache } from "./build-cache.js";
import { Dispatcher } from "./dispatcher.js";
import { logger } from "./logger.js";
import { MetroPortPool } from "./metro-pool.js";
import { JobQueue } from "./queue.js";
import { sweepStaleProcessGroups } from "./recovery.js";
import { startDaemonServer } from "./server.js";

export interface StartDaemonOptions {
  configPath?: string;
}

export async function startDaemon(opts: StartDaemonOptions = {}): Promise<void> {
  mkdirSync(MAESTROQ_HOME, { recursive: true });

  if (!existsSync(LOCK_PATH)) {
    closeSync(openSync(LOCK_PATH, "w"));
  }

  let release: () => Promise<void>;
  try {
    release = await lock(LOCK_PATH, { stale: 10_000, realpath: false });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOCKED") {
      process.stderr.write("daemon already running\n");
      process.exit(2);
    }
    throw err;
  }

  const configPath = opts.configPath ?? CONFIG_PATH;
  const config: Config = existsSync(configPath) ? loadConfig(configPath) : ConfigSchema.parse({});

  const queue = new JobQueue(QUEUE_PATH);
  queue.load();

  const recovery = sweepStaleProcessGroups(queue);
  if (recovery.failedJobIds.length > 0) {
    logger.warn(
      { killedPgids: recovery.killed, failedJobIds: recovery.failedJobIds },
      "recovery: marked interrupted jobs as failed",
    );
  }

  const retentionMs = config.defaults.queue_retention_days * 86_400_000;
  const pruned = queue.prune({
    olderThanMs: retentionMs,
    deleteLogs: true,
    deleteArtifacts: true,
  });
  if (pruned > 0) {
    logger.info(
      { pruned, retentionDays: config.defaults.queue_retention_days },
      "queue: pruned old terminal jobs",
    );
  }

  loadPersistedCache();

  const metroPool = new MetroPortPool(config.metro.port_range);
  const dispatcher = new Dispatcher(queue, metroPool, config, config.devices);

  startDaemonServer({ queue, dispatcher, onShutdown: release });
  dispatcher.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startDaemon().catch((err) => {
    logger.error({ err }, "daemon failed to start");
    process.exit(1);
  });
}

export * from "./build-cache.js";
export * from "./metro-pool.js";
export * from "./queue.js";
export * from "./recovery.js";
