import type { DeviceConfig } from "@maestroq/core";
import { cleanupIosLeftovers } from "./cleanup-ios.js";
import type { MetroHandle } from "./metro.js";

export interface TeardownOptions {
  device: DeviceConfig;
  metroHandle?: MetroHandle;
  logSink: (line: string) => void;
}

export async function teardownJob(opts: TeardownOptions): Promise<void> {
  const { device, metroHandle, logSink } = opts;
  if (metroHandle) {
    logSink(`[teardown] releasing metro on port ${metroHandle.lease.port}`);
    await metroHandle.stop();
  }
  if (device.platform === "ios") {
    await cleanupIosLeftovers(device.udid, logSink);
  }
}
