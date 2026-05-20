import type { DevicesResponse, EnrichedJobRecord, RpcEvent, StatusResponse } from "@maestroq/core";
import { colorExit, colorStatus, type PaintColor, paint } from "./color.js";

// Status table renders jobs as the server gave them, which always includes
// the `deviceLabel` enrichment. JobRecord is the persisted subset; use
// EnrichedJobRecord here so the column callbacks can read `deviceLabel`.
type JobRecord = EnrichedJobRecord;

export function printDevices(payload: DevicesResponse, opts: { color?: boolean } = {}): void {
  const { devices } = payload;
  if (!devices.length) {
    process.stdout.write("(no devices configured — edit ~/.maestroq/config.yaml)\n");
    return;
  }
  for (const d of devices) {
    const state = d.busy ? "busy" : "idle";
    const painted = opts.color ? paint(state, d.busy ? "yellow" : "green") : state;
    const labelPart = d.label ? `  ${d.label}` : "";
    process.stdout.write(`${d.platform.padEnd(8)} ${d.udid.padEnd(40)} ${painted}${labelPart}\n`);
  }
}

export interface PrintJobsOptions {
  header?: boolean;
  long?: boolean;
  color?: boolean;
}

interface Column {
  name: string;
  width: number;
  value: (j: JobRecord, now: number) => string;
  paint?: (j: JobRecord) => PaintColor | null;
}

const WORKTREE_WIDTH = 18;

const ID_COL: Column = { name: "ID", width: 8, value: (j) => j.id.slice(0, 8) };
const WORKTREE_COL: Column = {
  name: "WORKTREE",
  width: WORKTREE_WIDTH,
  value: (j) => truncate(worktreeName(j.spec.cwd), WORKTREE_WIDTH),
};
const PLAT_COL: Column = { name: "PLAT", width: 7, value: (j) => j.spec.platform };
const STATUS_COL: Column = {
  name: "STATUS",
  width: 14,
  // Render `failed (X/Y)` when the maestro phase emitted a TOTAL line, so
  // the user can tell "1 flow out of 30 failed" from "everything failed".
  // `error` and other statuses render as the bare status word.
  value: (j) => {
    if (j.status === "failed" && j.flowsTotal !== undefined) {
      return `failed ${j.flowsFailed ?? "?"}/${j.flowsTotal}`;
    }
    return j.status;
  },
  paint: (j) => colorStatus(j.status),
};
const CREATED_COL: Column = {
  name: "CREATED",
  width: 8,
  value: (j, now) => relTime(j.createdAt, now),
};
const STARTED_COL: Column = {
  name: "STARTED",
  width: 8,
  value: (j, now) => (j.startedAt ? relTime(j.startedAt, now) : "-"),
};
const DUR_COL: Column = {
  name: "DUR",
  width: 8,
  value: (j, now) => {
    if (j.startedAt && j.finishedAt) return `${((j.finishedAt - j.startedAt) / 1000).toFixed(1)}s`;
    if (j.startedAt) return `${((now - j.startedAt) / 1000).toFixed(1)}s`;
    return "-";
  },
};
const EXIT_COL: Column = {
  name: "EXIT",
  width: 5,
  value: (j) => (j.exitCode != null ? String(j.exitCode) : "-"),
  paint: (j) => colorExit(j.exitCode),
};
const DEVICE_COL: Column = {
  name: "DEVICE",
  width: 18,
  // Prefer the human-readable config label; fall back to the (truncated) udid.
  value: (j) => {
    const text = j.deviceLabel ?? j.deviceUdid ?? "";
    return truncate(text, 18);
  },
};
const LABEL_COL: Column = {
  name: "LABEL",
  width: 0,
  value: (j) => j.spec.label ?? j.spec.flows[0] ?? "",
};

const SHORT_COLUMNS: Column[] = [ID_COL, WORKTREE_COL, PLAT_COL, STATUS_COL, DUR_COL];
const LONG_COLUMNS: Column[] = [
  ID_COL,
  WORKTREE_COL,
  PLAT_COL,
  STATUS_COL,
  CREATED_COL,
  STARTED_COL,
  DUR_COL,
  EXIT_COL,
  DEVICE_COL,
  LABEL_COL,
];

function worktreeName(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function printJobs(payload: StatusResponse, opts: PrintJobsOptions = {}): void {
  const { jobs } = payload;
  const list = Array.isArray(jobs) ? jobs : jobs ? [jobs] : [];
  if (!list.length) {
    process.stdout.write("(no jobs)\n");
    return;
  }
  const cols = opts.long ? LONG_COLUMNS : SHORT_COLUMNS;
  const now = Date.now();
  if (opts.header) {
    process.stdout.write(
      `${cols.map((c) => (c.width ? c.name.padEnd(c.width) : c.name)).join(" ")}\n`,
    );
  }
  for (const j of list) {
    const row = cols
      .map((c) => {
        const v = c.value(j, now);
        const padded = c.width ? v.padEnd(c.width) : v;
        if (!opts.color || !c.paint) return padded;
        const tone = c.paint(j);
        return tone ? paint(padded, tone) : padded;
      })
      .join(" ");
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

export function printEvent(ev: RpcEvent, opts: { color?: boolean } = {}): void {
  switch (ev.kind) {
    case "log":
      process.stdout.write(`${ev.line}\n`);
      return;
    case "status": {
      const statusText = opts.color ? paint(ev.status, colorStatus(ev.status)) : ev.status;
      const exitPart = ev.exitCode != null ? ` (exit ${ev.exitCode})` : "";
      process.stderr.write(`[status] ${ev.jobId}: ${statusText}${exitPart}\n`);
      return;
    }
    case "error":
      process.stderr.write(`${opts.color ? paint("[error]", "red") : "[error]"} ${ev.message}\n`);
      return;
    default:
      return;
  }
}
