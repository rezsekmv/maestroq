import { describe, expect, it } from "vitest";
import {
  discoverAllDevices,
  discoverAndroidEmulators,
  discoverIosSimulators,
} from "../src/discover.js";

function fakeRun(map: Record<string, { stdout: string; status?: number }>) {
  return (cmd: string, args: readonly string[]): { stdout: string; status: number | null } => {
    const key = `${cmd} ${args.join(" ")}`;
    const hit = map[key];
    if (!hit) return { stdout: "", status: 1 };
    return { stdout: hit.stdout, status: hit.status ?? 0 };
  };
}

describe("discoverIosSimulators", () => {
  it("parses simctl booted devices JSON", () => {
    const run = fakeRun({
      "xcrun simctl list devices booted --json": {
        stdout: JSON.stringify({
          devices: {
            "com.apple.CoreSimulator.SimRuntime.iOS-26-3": [
              { udid: "AAA-1", name: "iPhone 16 Pro Max", state: "Booted" },
              { udid: "BBB-2", name: "iPhone 16", state: "Shutdown" },
            ],
          },
        }),
      },
    });
    const devices = discoverIosSimulators({ run });
    expect(devices).toEqual([{ udid: "AAA-1", platform: "ios", label: "iPhone 16 Pro Max" }]);
  });

  it("returns empty when simctl fails or is missing", () => {
    const run = fakeRun({});
    expect(discoverIosSimulators({ run })).toEqual([]);
  });

  it("returns empty on malformed JSON", () => {
    const run = fakeRun({
      "xcrun simctl list devices booted --json": { stdout: "{not json" },
    });
    expect(discoverIosSimulators({ run })).toEqual([]);
  });
});

describe("discoverAndroidEmulators", () => {
  it("parses `adb devices` and resolves AVD names", () => {
    const run = fakeRun({
      "adb devices": {
        stdout: "List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\n",
      },
      "adb -s emulator-5554 emu avd name": { stdout: "Pixel_7_API_36\nOK\n" },
    });
    const devices = discoverAndroidEmulators({ run });
    expect(devices).toEqual([
      {
        udid: "emulator-5554",
        platform: "android",
        label: "Pixel_7_API_36",
        avdName: "Pixel_7_API_36",
      },
    ]);
  });

  it("falls back to udid as label when AVD name probe fails", () => {
    const run = fakeRun({
      "adb devices": { stdout: "List of devices attached\nemulator-5554\tdevice\n" },
    });
    const devices = discoverAndroidEmulators({ run });
    expect(devices).toEqual([
      { udid: "emulator-5554", platform: "android", label: "emulator-5554" },
    ]);
  });
});

describe("discoverAllDevices", () => {
  it("combines iOS + Android", () => {
    const run = fakeRun({
      "xcrun simctl list devices booted --json": {
        stdout: JSON.stringify({
          devices: { ios: [{ udid: "AAA-1", name: "iPhone 16", state: "Booted" }] },
        }),
      },
      "adb devices": { stdout: "List of devices attached\nemulator-5554\tdevice\n" },
      "adb -s emulator-5554 emu avd name": { stdout: "Pixel_7_API_36\nOK\n" },
    });
    expect(discoverAllDevices({ run })).toHaveLength(2);
  });
});
