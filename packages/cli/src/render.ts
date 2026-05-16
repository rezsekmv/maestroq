import type { JobRecord, RpcEvent } from "@maestroq/core";

export function printDevices(payload: unknown): void {
  const devices = (payload as { devices: Array<{ udid: string; platform: string; busy: boolean }> }).devices;
  if (!devices.length) {
    process.stdout.write("(no devices configured — edit ~/.maestroq/config.yaml)\n");
    return;
  }
  for (const d of devices) {
    process.stdout.write(`${d.platform.padEnd(8)} ${d.udid.padEnd(40)} ${d.busy ? "busy" : "idle"}\n`);
  }
}

export interface PrintJobsOptions {
  header?: boolean;
}

interface Column {
  name: string;
  width: number;
  value: (j: JobRecord, now: number) => string;
}

const WORKTREE_WIDTH = 18;

const COLUMNS: Column[] = [
  { name: "ID", width: 8, value: (j) => j.id.slice(0, 8) },
  { name: "WORKTREE", width: WORKTREE_WIDTH, value: (j) => truncate(worktreeName(j.spec.cwd), WORKTREE_WIDTH) },
  { name: "PLAT", width: 7, value: (j) => j.spec.platform },
  { name: "STATUS", width: 14, value: (j) => j.status },
  { name: "CREATED", width: 8, value: (j, now) => relTime(j.createdAt, now) },
  { name: "STARTED", width: 8, value: (j, now) => (j.startedAt ? relTime(j.startedAt, now) : "-") },
  {
    name: "DUR",
    width: 8,
    value: (j, now) => {
      if (j.startedAt && j.finishedAt) return `${((j.finishedAt - j.startedAt) / 1000).toFixed(1)}s`;
      if (j.startedAt) return `${((now - j.startedAt) / 1000).toFixed(1)}s`;
      return "-";
    },
  },
  { name: "EXIT", width: 5, value: (j) => (j.exitCode != null ? String(j.exitCode) : "-") },
  { name: "LABEL", width: 0, value: (j) => j.spec.label ?? j.spec.flows[0] ?? "" },
];

function worktreeName(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function printJobs(payload: unknown, opts: PrintJobsOptions = {}): void {
  const jobs = (payload as { jobs: JobRecord | JobRecord[] | undefined }).jobs;
  const list = Array.isArray(jobs) ? jobs : jobs ? [jobs] : [];
  if (!list.length) {
    process.stdout.write("(no jobs)\n");
    return;
  }
  const now = Date.now();
  if (opts.header) {
    process.stdout.write(`${COLUMNS.map((c) => (c.width ? c.name.padEnd(c.width) : c.name)).join(" ")}\n`);
  }
  for (const j of list) {
    const row = COLUMNS.map((c) => {
      const v = c.value(j, now);
      return c.width ? v.padEnd(c.width) : v;
    }).join(" ");
    process.stdout.write(`${row}\n`);
  }
}

function relTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60}m`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

export function printEvent(ev: RpcEvent): void {
  switch (ev.kind) {
    case "log":
      process.stdout.write(`${ev.line}\n`);
      return;
    case "status":
      process.stderr.write(`[status] ${ev.jobId}: ${ev.status}${ev.exitCode != null ? ` (exit ${ev.exitCode})` : ""}\n`);
      return;
    case "error":
      process.stderr.write(`[error] ${ev.message}\n`);
      return;
    default:
      return;
  }
}
