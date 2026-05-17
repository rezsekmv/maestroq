import type { DeviceConfig, Runner } from "@maestroq/core";
import { cleanupIosLeftovers } from "./cleanup-ios.js";
import type { MetroHandle } from "./metro.js";

export interface TeardownOptions {
  device: DeviceConfig;
  runner: Runner;
  metroHandle?: MetroHandle;
  logSink: (line: string) => void;
}

export async function teardownJob(opts: TeardownOptions): Promise<void> {
  const { device, runner, metroHandle, logSink } = opts;
  if (metroHandle) {
    logSink(`[teardown] releasing metro on port ${metroHandle.lease.port}`);
    await metroHandle.stop();
  }
  // cleanup-ios pkill patterns target Maestro CLI-specific helper processes
  // (maestro-driver-iosUITests-Runner, xcodebuild test-without-building).
  // maestro-runner uses Appium WebDriverAgent vendored in-tree and does not
  // spawn them, so skip the sweep under that runner.
  if (device.platform === "ios" && runner === "maestro") {
    await cleanupIosLeftovers(device.udid, logSink);
  }
}
