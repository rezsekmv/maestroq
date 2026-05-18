const DEFAULT_SINCE_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_LIMIT = 10;

export function parseSince(raw: string | undefined): number {
  if (!raw) return DEFAULT_SINCE_MS;
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/.exec(raw.trim());
  if (!m) {
    process.stderr.write(`[maestroq] invalid --since "${raw}", using default 1h\n`);
    return DEFAULT_SINCE_MS;
  }
  const value = Number(m[1]);
  const unit = m[2] ?? "s";
  const factor =
    unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return Math.max(0, value * factor);
}

export function parseDuration(raw: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/.exec(raw.trim());
  if (!m) return undefined;
  const value = Number(m[1]);
  const unit = m[2] ?? "s";
  const factor =
    unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return Math.max(0, Math.floor(value * factor));
}

export function parseLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    process.stderr.write(`[maestroq] invalid --limit "${raw}", using default ${DEFAULT_LIMIT}\n`);
    return DEFAULT_LIMIT;
  }
  return n;
}

interface JobLike {
  createdAt: number;
}
interface JobsPayload {
  jobs: JobLike[] | JobLike | undefined;
}

export interface FilterOptions {
  sinceMs: number | null; // null = no time filter
  maxCount: number | null; // null = no count cap
}

export function filterJobs(payload: unknown, opts: FilterOptions): unknown {
  const p = payload as JobsPayload;
  const jobs = p.jobs;
  if (!jobs) return p;
  if (!Array.isArray(jobs)) {
    if (opts.sinceMs == null) return p;
    return jobs.createdAt >= Date.now() - opts.sinceMs ? p : { ...p, jobs: [] };
  }
  let kept = jobs;
  if (opts.sinceMs != null) {
    const cutoff = Date.now() - opts.sinceMs;
    kept = kept.filter((j) => j.createdAt >= cutoff);
  }
  if (opts.maxCount != null && kept.length > opts.maxCount) {
    kept = [...kept].sort((a, b) => b.createdAt - a.createdAt).slice(0, opts.maxCount);
    kept.sort((a, b) => a.createdAt - b.createdAt);
  }
  return { ...p, jobs: kept };
}
