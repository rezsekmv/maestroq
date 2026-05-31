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

// Confirms Android's PackageManager is responsive. A booted-but-broken
// emulator (e.g. system_server stuck on first run) keeps `adb get-state`
// happy but rejects `pm list packages` with `cmd: Can't find service: package`.
// Without this probe the worker drives a full release build before the
// failure surfaces at `adb install`.
async function assertPackageManagerHealthy(
  udid: string,
  logSink: (line: string) => void,
): Promise<void> {
  const r = await execa("adb", ["-s", udid, "shell", "pm", "list", "packages", "android"], {
    reject: false,
    timeout: 4_000,
    killSignal: "SIGKILL",
  });
  const stdout = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.exitCode === 0 && /^package:android$/m.test(stdout)) return;
  logSink(`[boot] pm probe failed: exit=${r.exitCode} out="${stdout.trim().slice(0, 120)}"`);
  throw new Error(
    `[boot] Android device ${udid} reachable via adb but PackageManager is unhealthy ` +
      "(`cmd: Can't find service: package` or no `android` package). Reboot the emulator/device and retry.",
  );
}

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
  if (probe.exitCode === 0 && probe.stdout.includes("device")) {
    // Device is reachable, but Android's PackageManager can be "dead" while
    // adb still answers (`cmd: Can't find service: package` from a hung
    // system_server). Without this probe the worker happily builds for
    // 20+ min then dies at `adb install`. A 4 s ping catches it before
    // we burn the build cycle.
    await assertPackageManagerHealthy(device.udid, logSink);
    return;
  }

  const avd = device.avdName ?? device.udid;

  // Headless `-no-window` makes the emulator silently fall back to software
  // rendering (swiftshader_indirect) regardless of the AVD's hw.gpu.mode. That
  // starves GPU-heavy RN/Flutter apps and makes Maestro's first `tapOn` miss
  // its deadline ("app launched but the first frame isn't ready"). Force host
  // GPU for headless boots; if that boot fails (older drivers / no working
  // OpenGL stack) retry once with swiftshader_indirect — unless the user
  // pinned a mode via `gpu:`, in which case we honor it and don't fall back.
  const pinned = device.gpu;
  const firstGpu = device.headless ? (pinned ?? "host") : undefined;

  try {
    await coldBootEmulator({ device, avd, gpuMode: firstGpu, bootstatusTimeoutMs, logSink });
  } catch (err) {
    const canFallback =
      device.headless &&
      pinned === undefined &&
      firstGpu === "host" &&
      !(err instanceof EmulatorFastExitError);
    if (!canFallback) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[boot] adb wait-for-device timed out or failed for AVD "${avd}" (udid ${device.udid}): ${message}`,
      );
    }
    logSink("[boot] host-GPU boot failed; retrying with -gpu swiftshader_indirect");
    try {
      await coldBootEmulator({
        device,
        avd,
        gpuMode: "swiftshader_indirect",
        bootstatusTimeoutMs,
        logSink,
      });
    } catch (err2) {
      const message = err2 instanceof Error ? err2.message : String(err2);
      throw new Error(
        `[boot] adb wait-for-device timed out or failed for AVD "${avd}" (udid ${device.udid}) ` +
          `after host + swiftshader_indirect GPU attempts: ${message}`,
      );
    }
  }
}

interface ColdBootOptions {
  device: DeviceConfig;
  avd: string;
  gpuMode: "host" | "swiftshader_indirect" | "auto" | undefined;
  bootstatusTimeoutMs: number;
  logSink: (line: string) => void;
}

// Sentinel error class so bootDevice can distinguish a fast emulator exit
// (bad config — wrong AVD name, missing binary) from a GPU driver failure
// that warrants a swiftshader_indirect retry.
export class EmulatorFastExitError extends Error {
  constructor(avd: string, exitCode: number | undefined) {
    super(
      `[boot] emulator for AVD "${avd}" exited immediately (exit ${exitCode ?? "?"}) — ` +
        "check that avdName is correct and `emulator` is on PATH",
    );
    this.name = "EmulatorFastExitError";
  }
}

// How quickly an emulator exit is treated as a hard config error rather
// than a driver/GPU failure. A healthy GPU boot takes ≥5 s to initialise
// rendering; anything that dies faster is almost certainly a bad AVD name
// or missing binary.
const EMULATOR_FAST_EXIT_WINDOW_MS = 3_000;

async function coldBootEmulator(opts: ColdBootOptions): Promise<void> {
  const { device, avd, gpuMode, bootstatusTimeoutMs, logSink } = opts;
  const emulatorArgs = ["-avd", avd, "-no-snapshot-load"];
  if (device.headless) {
    emulatorArgs.push("-no-window", "-no-audio", "-no-boot-anim");
  }
  if (gpuMode) emulatorArgs.push("-gpu", gpuMode);
  logSink(`[boot] emulator ${emulatorArgs.join(" ")}`);
  // emulator runs in background; we just wait for adb to see the device.
  // Spawn detached, don't await, then poll adb wait-for-device.
  const child = execa("emulator", emulatorArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // If the emulator dies non-zero within EMULATOR_FAST_EXIT_WINDOW_MS it's a
  // config error (bad AVD name, missing binary), not a GPU driver failure.
  // Throw EmulatorFastExitError immediately — bootDevice will not retry.
  // A zero exit within the window is the fake-emulator pattern used in tests
  // and is harmless (adb wait-for-device already resolved by then).
  const fastExitGuard = new Promise<never>((_, reject) => {
    child.then(
      () => {
        // exit 0 — not a config error
      },
      (err: unknown) => {
        const ms = (err as { durationMs?: number }).durationMs;
        const code = (err as { exitCode?: number }).exitCode;
        if (ms !== undefined && ms < EMULATOR_FAST_EXIT_WINDOW_MS) {
          reject(new EmulatorFastExitError(avd, code ?? undefined));
        }
      },
    );
  });

  try {
    await Promise.race([
      (async () => {
        await execa("adb", ["-s", device.udid, "wait-for-device"], {
          timeout: bootstatusTimeoutMs,
          killSignal: "SIGKILL",
        });
        // wait-for-device only proves adbd is listening; PackageManager comes
        // up later. Wait briefly (up to bootstatusTimeoutMs) for `sys.boot_completed`
        // then check PM is responsive — same rationale as the get-state path.
        await execa(
          "adb",
          [
            "-s",
            device.udid,
            "shell",
            'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 1; done',
          ],
          { timeout: bootstatusTimeoutMs, killSignal: "SIGKILL", reject: false },
        );
        await assertPackageManagerHealthy(device.udid, logSink);
      })(),
      fastExitGuard,
    ]);
  } catch (err) {
    // Kill the half-booted emulator's process group so a fallback attempt
    // gets a clean slate (it would otherwise hold the AVD lock / serial).
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    throw err;
  }
}
