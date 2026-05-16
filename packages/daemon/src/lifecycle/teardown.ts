import type { MetroHandle } from "./metro.js";

export interface TeardownOptions {
  metroHandle?: MetroHandle;
  logSink: (line: string) => void;
}

export async function teardownJob(opts: TeardownOptions): Promise<void> {
  const { metroHandle, logSink } = opts;
  if (metroHandle) {
    logSink(`[teardown] releasing metro on port ${metroHandle.lease.port}`);
    await metroHandle.stop();
  }
}
