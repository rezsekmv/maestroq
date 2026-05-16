#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineCommand, runMain } from "citty";
import { parse as parseYaml } from "yaml";
import {
  JobSpecSchema,
  PID_PATH,
  SOCKET_PATH,
  type JobSpec,
  type RpcEvent,
} from "@maestroq/core";
import {
  DaemonNotRunningError,
  connect,
} from "./rpc-client.js";
import { defaultConfigPath, initConfig } from "./init.js";
import { printDevices, printEvent, printJobs } from "./render.js";

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

function loadSpec(path: string): JobSpec {
  const abs = resolve(path);
  const raw = readFileSync(abs, "utf8");
  const parsed = parseYaml(raw) ?? {};
  const withCwd = { cwd: process.cwd(), ...parsed };
  return JobSpecSchema.parse(withCwd);
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
      process.stdout.write("daemon stop signalled\n");
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
  args: { json: { type: "boolean", description: "Emit JSON" } },
  async run({ args }) {
    const r = await guard(() => callOnce({ op: "devices" }));
    if (args.json) {
      process.stdout.write(`${JSON.stringify(r.payload, null, 2)}\n`);
      return;
    }
    printDevices(r.payload);
  },
});

const submit = defineCommand({
  meta: { name: "submit", description: "Submit a job spec; print the job id and return" },
  args: { spec: { type: "positional", description: "Path to spec.yaml", required: true } },
  async run({ args }) {
    const spec = loadSpec(args.spec);
    const r = await guard(() => callOnce({ op: "submit", spec }));
    const jobId = (r.payload as { jobId: string }).jobId;
    process.stdout.write(`${jobId}\n`);
  },
});

const status = defineCommand({
  meta: { name: "status", description: "Show status of all jobs or one" },
  args: {
    jobId: { type: "positional", description: "Job id (optional)", required: false },
    json: { type: "boolean", description: "Emit JSON" },
  },
  async run({ args }) {
    const r = await guard(() =>
      callOnce({ op: "status", ...(args.jobId ? { jobId: args.jobId } : {}) }),
    );
    if (args.json) {
      process.stdout.write(`${JSON.stringify(r.payload, null, 2)}\n`);
      return;
    }
    printJobs(r.payload);
  },
});

const logs = defineCommand({
  meta: { name: "logs", description: "Print logs for a job; -f to follow" },
  args: {
    jobId: { type: "positional", required: true, description: "Job id" },
    follow: { type: "boolean", alias: "f", description: "Follow the log stream" },
  },
  async run({ args }) {
    const client = await guardClient();
    try {
      for await (const ev of client.send({
        op: "logs",
        jobId: args.jobId,
        follow: Boolean(args.follow),
      })) {
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
    process.stdout.write(`cancelled: ${(r.payload as { cancelled: string }).cancelled}\n`);
  },
});

const run = defineCommand({
  meta: { name: "run", description: "Submit a job, stream logs, exit with the job's code" },
  args: { spec: { type: "positional", description: "Path to spec.yaml", required: true } },
  async run({ args }) {
    const spec = loadSpec(args.spec);
    const submission = await guard(() => callOnce({ op: "submit", spec }));
    const jobId = (submission.payload as { jobId: string }).jobId;
    process.stderr.write(`[mq] submitted ${jobId}\n`);

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
      description: "Seed devices from the current dir's package.json scripts",
    },
  },
  async run({ args }) {
    const message = initConfig({
      cwd: process.cwd(),
      fromPackageJson: Boolean(args["from-package-json"]),
      configPath: defaultConfigPath(),
    });
    process.stdout.write(`${message}\n`);
  },
});

const configEdit = defineCommand({
  meta: { name: "edit", description: "Open ~/.maestroq/config.yaml in $EDITOR" },
  async run() {
    const editor = process.env.EDITOR ?? "vi";
    const child = spawn(editor, [defaultConfigPath()], { stdio: "inherit" });
    await new Promise<void>((resolve, reject) => {
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`editor exit ${code}`))));
      child.on("error", reject);
    });
  },
});

const config = defineCommand({
  meta: { name: "config", description: "Config helpers" },
  subCommands: { edit: configEdit },
});

const main = defineCommand({
  meta: { name: "mq", description: "maestroq CLI client", version: "0.1.0" },
  subCommands: { daemon, devices, submit, status, logs, cancel, run, init, config },
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

// Silence unused-import warning during typecheck for the RpcEvent type
const _unused: RpcEvent | undefined = undefined;
void _unused;

runMain(main);
