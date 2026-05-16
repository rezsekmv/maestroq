import { logger } from "./logger.js";
import type { JobQueue } from "./queue.js";

export interface RecoveryResult {
  killed: number[];
  failedJobIds: string[];
}

export function sweepStaleProcessGroups(queue: JobQueue): RecoveryResult {
  const active = queue.activeJobs();
  const killed: number[] = [];

  for (const job of active) {
    if (typeof job.pgid === "number" && job.pgid > 1) {
      try {
        process.kill(-job.pgid, "SIGKILL");
        killed.push(job.pgid);
        logger.warn({ jobId: job.id, pgid: job.pgid }, "killed stale process group");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ESRCH") {
          logger.error({ jobId: job.id, pgid: job.pgid, err }, "failed to kill process group");
        }
      }
    }
  }

  const finalized = queue.finalizeInterrupted("daemon-crash");
  return { killed, failedJobIds: finalized.map((j) => j.id) };
}
