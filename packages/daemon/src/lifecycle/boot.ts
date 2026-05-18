import type { DeviceConfig } from "@maestroq/core";
import { execa } from "execa";

export interface BootOptions {
  device: DeviceConfig;
  rebootSimBefore: boolean;
  logSink: (line: string) => void;
}

export async function bootDevice(opts: BootOptions): Promise<void> {
  const { device, rebootSimBefore, logSink } = opts;
  if (device.platform === "ios") {
    if (rebootSimBefore) {
      logSink(`[boot] simctl shutdown ${device.udid}`);
      await execa("xcrun", ["simctl", "shutdown", device.udid], { reject: false });
    }
    logSink(`[boot] simctl bootstatus ${device.udid}`);
    await execa("xcrun", ["simctl", "bootstatus", device.udid, "-b"]);
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
