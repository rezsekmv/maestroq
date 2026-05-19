import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceConfig } from "@maestroq/core";
import { execa } from "execa";

export interface BootOptions {
  device: DeviceConfig;
  rebootSimBefore: boolean;
  logSink: (line: string) => void;
  bootstatusTimeoutMs?: number;
}

export const DEFAULT_BOOTSTATUS_TIMEOUT_MS = 60_000;

// Probe whether an iOS UDID points at a simulator. `xcrun simctl list -j devices`
// emits a JSON map of runtime → device[]; physical devices are absent.
// We cache the result for the lifetime of the daemon — a UDID's "is-simulator-ness"
// doesn't change at runtime.
const iosSimCache = new Map<string, boolean>();

async function isIosSimulator(udid: string): Promise<boolean> {
  const cached = iosSimCache.get(udid);
  if (cached !== undefined) return cached;
  let isSim = false;
  try {
    const r = await execa("xcrun", ["simctl", "list", "-j", "devices"], { reject: false });
    if (r.exitCode === 0) {
      const data = JSON.parse(r.stdout) as { devices: Record<string, { udid: string }[]> };
      for (const runtime of Object.values(data.devices ?? {})) {
        if (runtime.some((d) => d.udid === udid)) {
          isSim = true;
          break;
        }
      }
    }
  } catch {
    // simctl unavailable or unparseable — treat as non-simulator so we don't
    // hammer a physical iPhone with `simctl bootstatus`.
    isSim = false;
  }
  iosSimCache.set(udid, isSim);
  return isSim;
}

export function _resetIosSimCacheForTests(): void {
  iosSimCache.clear();
}

export async function bootDevice(opts: BootOptions): Promise<void> {
  const { device, rebootSimBefore, logSink } = opts;
  const bootstatusTimeoutMs = opts.bootstatusTimeoutMs ?? DEFAULT_BOOTSTATUS_TIMEOUT_MS;
  if (device.platform === "ios") {
    const isSim = await isIosSimulator(device.udid);
    if (!isSim) {
      // Physical iPhone/iPad. `simctl` only knows simulators and would exit
      // with `Invalid device`; rely on maestro-runner's Appium-vendored WDA
      // path to talk to the device.
      //
      // Note on UDIDs: Apple's tooling uses two identifiers for one device —
      // the CoreDevice UUID (`FC709E4A-…`) shown by `devicectl list devices`,
      // and the ECID (`00008030-…`) shown to xcodebuild. maestro-runner
      // forwards the configured udid to xcodebuild's `-destination id=`,
      // so the user must configure the ECID; the CoreDevice UUID will fail
      // the WDA build downstream. We don't try to translate between them
      // here — just verify *some* physical iOS device is paired so that an
      // unplugged phone fails fast.
      logSink(`[boot] devicectl list devices (physical) ${device.udid}`);
      // Use structured JSON output so detection is localization-agnostic and
      // covers all physical device types (iPhone, iPad, iPod touch, etc.).
      const jsonDir = mkdtempSync(join(tmpdir(), "maestroq-devicectl-"));
      const jsonPath = join(jsonDir, "devices.json");
      try {
        const probe = await execa(
          "xcrun",
          ["devicectl", "list", "devices", "--json-output", jsonPath],
          { reject: false },
        );
        if (probe.exitCode !== 0) {
          throw new Error(
            `[boot] xcrun devicectl failed (exit ${probe.exitCode}); is Xcode installed and the device paired?`,
          );
        }
        let deviceCount = 0;
        try {
          const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as {
            result?: { devices?: unknown[] };
          };
          deviceCount = parsed.result?.devices?.length ?? 0;
        } catch {
          // JSON unreadable → treat as no devices found
        }
        if (deviceCount === 0) {
          throw new Error(
            "[boot] no physical iOS device visible to devicectl; plug in and trust the phone, or pair it via Xcode > Devices",
          );
        }
      } finally {
        rmSync(jsonDir, { recursive: true, force: true });
      }
      return;
    }

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
