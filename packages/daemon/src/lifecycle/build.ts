import type { DeviceConfig, JobSpec, Variant } from "@maestroq/core";
import { execa, type ResultPromise } from "execa";
import { withMetroCacheRoot } from "./metro-cache.js";

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

  // `expo run:{ios,android} --device <…>` requires the *name* Expo recognises,
  // which differs from the adb serial / simctl UDID maestroq uses internally.
  //   - emulators / simulators: udid usually works (e.g. `emulator-5554`)
  //   - Android emulators with an AVD: `avdName` is the canonical Expo name
  //   - physical phones: neither works — Expo wants the device's model name
  //     (e.g. `CPH2307`). The user supplies it via `expoDeviceName`.
  const expoIdentifier =
    device.expoDeviceName ??
    (device.platform === "android" ? device.avdName : undefined) ??
    device.udid;

  const args: string[] =
    device.platform === "ios"
      ? ["expo", "run:ios", "--device", expoIdentifier, "--configuration", flag(variant)]
      : ["expo", "run:android", "--device", expoIdentifier, "--variant", variant];
  if (variant === "release") args.push("--no-bundler");
  logSink(`[build] npx ${args.join(" ")}`);

  const env = withMetroCacheRoot({ ...process.env, ...spec.env }, device.udid, logSink);
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
