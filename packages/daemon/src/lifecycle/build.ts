import type { DeviceConfig, JobSpec, Variant } from "@maestroq/core";
import { execa, type ResultPromise } from "execa";

export interface BuildOptions {
  spec: JobSpec;
  device: DeviceConfig;
  variant: Variant;
  logSink: (line: string) => void;
  onChildStart: (pid: number) => void;
}

function flag(variant: Variant): string {
  return variant === "release" ? "Release" : "Debug";
}

export async function buildApp(opts: BuildOptions): Promise<void> {
  const { spec, device, variant, logSink, onChildStart } = opts;
  const env = { ...process.env, ...spec.env };

  const args: string[] =
    device.platform === "ios"
      ? ["expo", "run:ios", "--device", device.udid, "--configuration", flag(variant)]
      : ["expo", "run:android", "--device", device.avdName ?? device.udid, "--variant", variant];
  if (variant === "release") args.push("--no-bundler");
  logSink(`[build] npx ${args.join(" ")}`);

  const child: ResultPromise = execa("npx", args, {
    cwd: spec.cwd,
    env,
    all: true,
    detached: true,
  });
  if (child.pid) onChildStart(child.pid);
  child.all?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) if (line) logSink(line);
  });
  await child;
}
