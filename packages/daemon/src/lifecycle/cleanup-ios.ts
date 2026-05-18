import { execa } from "execa";

export type LogSink = (line: string) => void;

// Maestro's iOS test path spawns xctest helpers (`maestro-driver-iosUITests-Runner`,
// `xcodebuild test-without-building`) that occasionally outlive the maestro CLI
// and keep host port 7001 stale, causing the *next* iOS run to fail with
// "Failed to connect to /127.0.0.1:7001". The pgid-based teardown in the worker
// only kills processes we tracked; these grandchildren detach themselves.
export async function cleanupIosLeftovers(udid: string, logSink: LogSink): Promise<void> {
  const patterns = [`maestro-driver-iosUITests-Runner.*${udid}`, `xcodebuild.*${udid}`];
  for (const pattern of patterns) {
    const result = await execa("pkill", ["-f", pattern], { reject: false });
    // pkill exits 0 if it killed something, 1 if no matches. Anything else is unexpected.
    if (result.exitCode === 0) {
      logSink(`[cleanup-ios] pkill -f '${pattern}' killed leftover processes`);
    } else if (result.exitCode !== 1) {
      logSink(`[cleanup-ios] pkill -f '${pattern}' exit=${result.exitCode}`);
    }
  }
}
