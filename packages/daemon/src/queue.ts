import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ActiveStatuses,
  type JobRecord,
  type JobSpec,
  type JobStatus,
  TerminalStatuses,
} from "@maestroq/core";

export interface QueueState {
  jobs: JobRecord[];
}

export class JobQueue {
  private state: QueueState = { jobs: [] };

  constructor(private readonly path: string) {}

  load(): void {
    try {
      const raw = readFileSync(this.path, "utf8");
      this.state = JSON.parse(raw) as QueueState;
      if (!Array.isArray(this.state.jobs)) this.state = { jobs: [] };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
      this.state = { jobs: [] };
    }
  }

  persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.path);
  }

  all(): JobRecord[] {
    return [...this.state.jobs];
  }

  get(jobId: string): JobRecord | undefined {
    return this.state.jobs.find((j) => j.id === jobId);
  }

  add(spec: JobSpec): JobRecord {
    const record: JobRecord = {
      id: randomUUID(),
      spec,
      status: "queued",
      createdAt: Date.now(),
    };
    this.state.jobs.push(record);
    this.persist();
    return record;
  }

  update(jobId: string, patch: Partial<JobRecord>): JobRecord {
    const job = this.get(jobId);
    if (!job) throw new Error(`unknown job: ${jobId}`);
    Object.assign(job, patch);
    this.persist();
    return job;
  }

  nextQueued(platform?: JobRecord["spec"]["platform"]): JobRecord | undefined {
    const candidates = this.state.jobs
      .filter((j) => j.status === "queued")
      .filter((j) => (platform ? j.spec.platform === platform : true))
      .sort((a, b) => {
        const pri = b.spec.priority - a.spec.priority;
        if (pri !== 0) return pri;
        return a.createdAt - b.createdAt;
      });
    return candidates[0];
  }

  activeJobs(): JobRecord[] {
    return this.state.jobs.filter((j) => ActiveStatuses.has(j.status));
  }

  finalizeInterrupted(reason: string): JobRecord[] {
    const interrupted: JobRecord[] = [];
    for (const job of this.state.jobs) {
      if (ActiveStatuses.has(job.status)) {
        job.status = "failed" satisfies JobStatus;
        job.failureReason = reason;
        job.finishedAt = Date.now();
        interrupted.push(job);
      }
    }
    if (interrupted.length > 0) this.persist();
    return interrupted;
  }

  isTerminal(jobId: string): boolean {
    const job = this.get(jobId);
    return job ? TerminalStatuses.has(job.status) : false;
  }
}
