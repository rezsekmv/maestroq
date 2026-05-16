import { execa } from "execa";
import type { DeviceConfig, JobSpec } from "@maestroq/core";

export interface MaestroOptions {
  spec: JobSpec;
  device: DeviceConfig;
  artifactDir: string;
  logSink: (line: string) => void;
  onChildStart: (pid: number) => void;
}

export interface MaestroResult {
  exitCode: number;
}

export async function runMaestro(opts: MaestroOptions): Promise<MaestroResult> {
  const { spec, device, artifactDir, logSink, onChildStart } = opts;
  const args = ["--udid", device.udid, "test", ...spec.flows, "--output", artifactDir];
  logSink(`[maestro] maestro ${args.join(" ")}`);
  const child = execa("maestro", args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    all: true,
    reject: false,
    detached: true,
  });
  if (child.pid) onChildStart(child.pid);
  child.all?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) if (line) logSink(line);
  });
  const result = await child;
  return { exitCode: result.exitCode ?? 1 };
}
