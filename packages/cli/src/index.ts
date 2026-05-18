#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  CancelResponseSchema,
  DevicesResponseSchema,
  PID_PATH,
  SOCKET_PATH,
  StatusResponseSchema,
  SubmitResponseSchema,
} from "@maestroq/core";
import { defineCommand, runMain } from "citty";
import type { ZodTypeAny, z } from "zod";
import { resolveUseColor } from "./color.js";
import { colorMode } from "./color-mode.js";
import { defaultConfigPath, initConfig } from "./init.js";
import { loadSpec } from "./load-spec.js";
import { parseWatchInterval } from "./parse-interval.js";
import { printDevices, printEvent, printJobs } from "./render.js";
import { connect, DaemonNotRunningError } from "./rpc-client.js";
import { DEFAULT_LIMIT, filterJobs, parseDuration, parseLimit, parseSince } from "./since.js";
import { VERSION } from "./version.js";

async function callOnce(req: Parameters<Awaited<ReturnType<typeof connect>>["send"]>[0]): Promise<{
  payload?: unknown;
  error?: string;
}> {
  const client = await connect();
  try {
    for await (const ev of client.send(req)) {
      if (ev.kind === "ok") return { payload: ev.payload };
      if (ev.kind === "error") return { error: ev.message };
    }
    return {};
  } finally {
    client.close();
  }
}

function parsePayload<S extends ZodTypeAny>(schema: S, payload: unknown, op: string): z.infer<S> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    process.stderr.write(
      `[maestroq] daemon ${op} response failed validation: ${parsed.error.message}\n`,
    );
    process.exit(1);
  }
  return parsed.data;
}

const daemonStart = defineCommand({
  meta: { name: "start", description: "Start the maestroq daemon in the foreground" },
  args: {
    config: { type: "string", description: "Path to config.yaml", required: false },
  },
  async run({ args }) {
    const { startDaemon } = await import("@maestroq/daemon");
    await startDaemon({ configPath: args.config });
  },
});

const daemonStop = defineCommand({
  meta: { name: "stop", description: "Stop the running daemon" },
  async run() {
    try {
      const r = await callOnce({ op: "shutdown" });
      if (r.error) {
        process.stderr.write(`${r.error}\n`);
        process.exit(1);
      }
      for (let i = 0; i < 50; i++) {
        if (!existsSync(SOCKET_PATH)) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      if (existsSync(SOCKET_PATH)) {
        process.stderr.write("daemon stop signalled but socket still present after 5s\n");
      } else {
        process.stdout.write("daemon stopped\n");
      }
    } catch (err) {
      if (err instanceof DaemonNotRunningError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(2);
      }
      throw err;
    }
  },
});

const daemonStatus = defineCommand({
  meta: { name: "status", description: "Check whether the daemon is running" },
  async run() {
    if (!existsSync(SOCKET_PATH)) {
      process.stdout.write("not running\n");
      process.exit(1);
    }
    try {
      const r = await callOnce({ op: "ping" });
      if (r.error) {
        process.stderr.write(`${r.error}\n`);
        process.exit(1);
      }
      const pid = existsSync(PID_PATH) ? readFileSync(PID_PATH, "utf8").trim() : "?";
      process.stdout.write(`running (pid ${pid})\n`);
    } catch (err) {
      if (err instanceof DaemonNotRunningError) {
        process.stderr.write(`${err.message}\n`);
        process.exit(2);
      }
      throw err;
    }
  },
});

const daemon = defineCommand({
  meta: { name: "daemon", description: "Daemon lifecycle commands" },
  subCommands: { start: daemonStart, stop: daemonStop, status: daemonStatus },
});

const devices = defineCommand({
  meta: { name: "devices", description: "List configured devices and their busy state" },
  args: {
    json: { type: "boolean", description: "Emit JSON" },
    color: { type: "string", description: "auto (default) | always | never" },
  },
  async run({ args }) {
    const r = await guard(() => callOnce({ op: "devices" }));
    const payload = parsePayload(DevicesResponseSchema, r.payload, "devices");
    if (args.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    const useColor = resolveUseColor(colorMode(args.color));
    printDevices(payload, { color: useColor });
  },
});

const submit = defineCommand({
  meta: { name: "submit", description: "Submit a job spec; print the job id and return" },
  args: { spec: { type: "positional", description: "Path to spec.yaml", required: true } },
  async run({ args }) {
    const spec = loadSpec(args.spec);
    const r = await guard(() => callOnce({ op: "submit", spec }));
    const { jobId } = parsePayload(SubmitResponseSchema, r.payload, "submit");
    process.stdout.write(`${jobId}\n`);
  },
});

const status = defineCommand({
  meta: { name: "status", description: "Show status of all jobs or one" },
  args: {
    jobId: { type: "positional", description: "Job id (optional)", required: false },
    json: { type: "boolean", description: "Emit JSON" },
    header: { type: "boolean", alias: "H", description: "Prepend a column header row" },
    long: {
      type: "boolean",
      alias: "l",
      description: "Detailed view: adds WORKTREE, CREATED, STARTED, EXIT columns",
    },
    since: {
      type: "string",
      description: "Show jobs created within this duration (default 1h). Examples: 30m, 2h, 1d.",
    },
    limit: {
      type: "string",
      alias: "n",
      description: `Cap to the most recent N jobs (default ${DEFAULT_LIMIT}).`,
    },
    all: {
      type: "boolean",
      alias: "a",
      description: "Show all jobs (overrides --since and --limit)",
    },
    watch: {
      type: "boolean",
      alias: "w",
      description: "Re-render every --interval seconds (default 2). Ctrl-C to exit.",
    },
    interval: {
      type: "string",
      description: "Refresh interval in seconds when --watch is on (default 2).",
    },
    color: { type: "string", description: "auto (default) | always | never" },
  },
  async run({ args }) {
    const filterOpts =
      args.jobId || args.all
        ? { sinceMs: null, maxCount: null }
        : { sinceMs: parseSince(args.since), maxCount: parseLimit(args.limit) };

    const useColor = resolveUseColor(colorMode(args.color));

    const fetchOnce = async (): Promise<z.infer<typeof StatusResponseSchema>> => {
      const r = await guard(() =>
        callOnce({ op: "status", ...(args.jobId ? { jobId: args.jobId } : {}) }),
      );
      const payload = parsePayload(StatusResponseSchema, r.payload, "status");
      if (filterOpts.sinceMs == null && filterOpts.maxCount == null) return payload;
      return filterJobs(payload, filterOpts) as z.infer<typeof StatusResponseSchema>;
    };

    const renderOnce = (payload: z.infer<typeof StatusResponseSchema>): void => {
      if (args.json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      }
      printJobs(payload, {
        header: Boolean(args.header),
        long: Boolean(args.long),
        color: useColor,
      });
    };

    if (!args.watch) {
      const payload = await fetchOnce();
      renderOnce(payload);
      return;
    }

    const intervalMs = parseWatchInterval(args.interval);
    const useAnsi = process.stdout.isTTY && !args.json;
    process.on("SIGINT", () => {
      process.stdout.write("\n");
      process.exit(0);
    });
    for (;;) {
      const payload = await fetchOnce();
      if (useAnsi) process.stdout.write("\x1b[2J\x1b[H");
      if (useAnsi) {
        process.stdout.write(
          `maestroq — ${new Date().toLocaleTimeString()} (refresh ${intervalMs / 1000}s, Ctrl-C to exit)\n\n`,
        );
      }
      renderOnce(payload);
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  },
});

const logs = defineCommand({
  meta: { name: "logs", description: "Print logs for a job; -f to follow" },
  args: {
    jobId: { type: "positional", required: true, description: "Job id" },
    follow: { type: "boolean", alias: "f", description: "Follow the log stream" },
    tail: {
      type: "string",
      description: "Show only the last N lines from the existing log",
    },
  },
  async run({ args }) {
    let tailLines: number | undefined;
    if (args.tail !== undefined && args.tail !== "") {
      const n = Number(args.tail);
      if (!Number.isInteger(n) || n <= 0) {
        process.stderr.write(`[maestroq] invalid --tail "${args.tail}"\n`);
        process.exit(1);
      }
      tailLines = n;
    }
    const client = await guardClient();
    try {
      const req = {
        op: "logs" as const,
        jobId: args.jobId,
        follow: Boolean(args.follow),
        ...(tailLines !== undefined ? { tailLines } : {}),
      };
      for await (const ev of client.send(req)) {
        printEvent(ev);
        if (ev.kind === "error") process.exitCode = 1;
      }
    } finally {
      client.close();
    }
  },
});

const cancel = defineCommand({
  meta: { name: "cancel", description: "Cancel a job" },
  args: { jobId: { type: "positional", required: true, description: "Job id" } },
  async run({ args }) {
    const r = await guard(() => callOnce({ op: "cancel", jobId: args.jobId }));
    const { cancelled } = parsePayload(CancelResponseSchema, r.payload, "cancel");
    process.stdout.write(`cancelled: ${cancelled}\n`);
  },
});

const run = defineCommand({
  meta: { name: "run", description: "Submit a job, stream logs, exit with the job's code" },
  args: { spec: { type: "positional", description: "Path to spec.yaml", required: true } },
  async run({ args }) {
    const spec = loadSpec(args.spec);
    const submission = await guard(() => callOnce({ op: "submit", spec }));
    const { jobId } = parsePayload(SubmitResponseSchema, submission.payload, "submit");
    process.stderr.write(`[maestroq] submitted ${jobId}\n`);

    const client = await guardClient();
    let exitCode = 0;
    let done = false;
    try {
      const iter = client.send({ op: "logs", jobId, follow: true });
      for await (const ev of iter) {
        printEvent(ev);
        if (ev.kind === "status" && ev.jobId === jobId) {
          if (ev.status === "succeeded") {
            exitCode = ev.exitCode ?? 0;
            done = true;
            break;
          }
          if (ev.status === "failed" || ev.status === "cancelled") {
            exitCode = ev.exitCode ?? 1;
            done = true;
            break;
          }
        }
      }
    } finally {
      client.close();
    }
    if (!done) exitCode = 1;
    process.exit(exitCode);
  },
});

const init = defineCommand({
  meta: { name: "init", description: "Create ~/.maestroq/config.yaml" },
  args: {
    "from-package-json": {
      type: "boolean",
      description: "Fall back to seeding placeholder devices from package.json scripts",
    },
    "no-discover": {
      type: "boolean",
      description: "Skip auto-discovering booted simulators/emulators on the host",
    },
    "no-specs": {
      type: "boolean",
      description: "Skip scaffolding maestroq/smoke-<platform>.yaml when .maestro/ exists",
    },
  },
  async run({ args }) {
    const result = initConfig({
      cwd: process.cwd(),
      fromPackageJson: Boolean(args["from-package-json"]),
      configPath: defaultConfigPath(),
      skipDiscover: Boolean(args["no-discover"]),
      skipSpecs: Boolean(args["no-specs"]),
    });
    process.stdout.write(`${result.message}\n`);
    for (const d of result.discovered) {
      process.stdout.write(`  - ${d.platform.padEnd(8)} ${d.udid}  ${d.label ?? ""}\n`);
    }
    for (const s of result.specsWritten) {
      process.stdout.write(`  + spec ${s}\n`);
    }
  },
});

const configEdit = defineCommand({
  meta: { name: "edit", description: "Open ~/.maestroq/config.yaml in $EDITOR" },
  async run() {
    const editor = process.env.EDITOR ?? "vi";
    const child = spawn(editor, [defaultConfigPath()], { stdio: "inherit" });
    await new Promise<void>((resolve, reject) => {
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`editor exit ${code}`)),
      );
      child.on("error", reject);
    });
  },
});

const prune = defineCommand({
  meta: { name: "prune", description: "Remove old terminal jobs (and optionally logs/artifacts)" },
  args: {
    "older-than": {
      type: "string",
      description: "Duration (e.g. 7d, 2h, 30m, 0s). Required.",
      required: true,
    },
    statuses: {
      type: "string",
      description: "Comma-separated statuses (default: succeeded,failed,cancelled)",
    },
    "keep-logs": { type: "boolean", description: "Do not delete log files" },
    "keep-artifacts": { type: "boolean", description: "Do not delete artifact directories" },
  },
  async run({ args }) {
    const olderThanMs = parseDuration(String(args["older-than"]));
    if (olderThanMs === undefined) {
      process.stderr.write(`[maestroq] invalid --older-than "${args["older-than"]}"\n`);
      process.exit(1);
    }
    let statuses: JobStatus[] | undefined;
    if (args.statuses) {
      const allowed: ReadonlySet<JobStatus> = new Set<JobStatus>([
        "succeeded",
        "failed",
        "cancelled",
      ]);
      const parts = String(args.statuses)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const out: JobStatus[] = [];
      for (const p of parts) {
        if (!allowed.has(p as JobStatus)) {
          process.stderr.write(`[maestroq] invalid status "${p}"\n`);
          process.exit(1);
        }
        out.push(p as JobStatus);
      }
      statuses = out;
    }
    const req = {
      op: "prune" as const,
      olderThanMs,
      ...(statuses ? { statuses } : {}),
      deleteLogs: !args["keep-logs"],
      deleteArtifacts: !args["keep-artifacts"],
    };
    const r = await guard(() => callOnce(req));
    const removed = (r.payload as { removed: number } | undefined)?.removed ?? 0;
    process.stdout.write(`Pruned ${removed} job${removed === 1 ? "" : "s"}.\n`);
  },
});

const config = defineCommand({
  meta: { name: "config", description: "Config helpers" },
  subCommands: { edit: configEdit },
});

const main = defineCommand({
  meta: { name: "maestroq", description: "maestroq CLI client", version: VERSION },
  subCommands: { daemon, devices, submit, status, logs, cancel, run, prune, init, config },
});

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DaemonNotRunningError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
}

async function guardClient(): Promise<Awaited<ReturnType<typeof connect>>> {
  try {
    return await connect();
  } catch (err) {
    if (err instanceof DaemonNotRunningError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
}

runMain(main);
