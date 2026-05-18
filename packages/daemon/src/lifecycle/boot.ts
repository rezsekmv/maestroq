import type { DeviceConfig } from "@maestroq/core";
import { execa } from "execa";

export interface BootOptions {
  device: DeviceConfig;
  rebootSimBefore: boolean;
  logSink: (line: string) => void;
  bootstatusTimeoutMs?: number;
}

export const DEFAULT_BOOTSTATUS_TIMEOUT_MS = 60_000;

export async function bootDevice(opts: BootOptions): Promise<void> {
  const { device, rebootSimBefore, logSink } = opts;
  const bootstatusTimeoutMs = opts.bootstatusTimeoutMs ?? DEFAULT_BOOTSTATUS_TIMEOUT_MS;
  if (device.platform === "ios") {
    if (rebootSimBefore) {
      logSink(`[boot] simctl shutdown ${device.udid}`);
      await execa("xcrun", ["simctl", "shutdown", device.udid], { reject: false });
    }
    logSink(`[boot] simctl bootstatus ${device.udid}`);
    try {
      await execa("xcrun", ["simctl", "bootstatus", device.udid, "-b"], {
        timeout: bootstatusTimeoutMs,
        killSignal: "SIGKILL",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[boot] simctl bootstatus timed out or failed: ${message}`);
    }
    return;
  }

  logSink(`[boot] adb -s ${device.udid} get-state`);
  const probe = await execa("adb", ["-s", device.udid, "get-state"], { reject: false });
  if (probe.exitCode === 0 && probe.stdout.includes("device")) return;

  const avd = device.avdName ?? device.udid;
  logSink(`[boot] emulator -avd ${avd}`);
  // emulator runs in background; we just wait for adb to see the device.
  // Spawn detached, don't await, then poll adb wait-for-device.
  const child = execa("emulator", ["-avd", avd, "-no-snapshot-load"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  await execa("adb", ["-s", device.udid, "wait-for-device"]);
}
