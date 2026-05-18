import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import type { DiscoverDeps } from "../src/discover.js";
import { initConfig } from "../src/init.js";

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mq-init-"));
  configPath = join(dir, "config.yaml");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakeRun(map: Record<string, { stdout: string; status?: number }>): DiscoverDeps["run"] {
  return (cmd, args) => {
    const key = `${cmd} ${args.join(" ")}`;
    const hit = map[key];
    if (!hit) return { stdout: "", status: 1 };
    return { stdout: hit.stdout, status: hit.status ?? 0 };
  };
}

describe("initConfig with device discovery", () => {
  it("writes at most one iOS and one Android device, even if many are booted", () => {
    const run = fakeRun({
      "xcrun simctl list devices booted --json": {
        stdout: JSON.stringify({
          devices: {
            ios: [
              { udid: "AAA-1", name: "iPhone 16 Pro Max", state: "Booted" },
              { udid: "AAA-2", name: "iPhone 16", state: "Booted" },
            ],
          },
        }),
      },
      "adb devices": {
        stdout: "List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n",
      },
      "adb -s emulator-5554 emu avd name": { stdout: "Pixel_7_API_36\nOK\n" },
      "adb -s emulator-5556 emu avd name": { stdout: "Pixel_8_API_36\nOK\n" },
    });

    const result = initConfig({
      cwd: dir,
      fromPackageJson: false,
      configPath,
      discoverDeps: { run },
    });

    const cfg = parseYaml(readFileSync(configPath, "utf8")) as {
      devices: Array<{ udid: string; platform: string }>;
    };
    expect(cfg.devices).toHaveLength(2);
    expect(cfg.devices.map((d) => d.platform).sort()).toEqual(["android", "ios"]);
    expect(cfg.devices.find((d) => d.platform === "ios")?.udid).toBe("AAA-1");
    expect(cfg.devices.find((d) => d.platform === "android")?.udid).toBe("emulator-5554");
    expect(result.discovered).toHaveLength(2);
  });

  it("falls back to package.json placeholders when nothing is booted", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { "test:e2e:ios": "...", "test:e2e:android": "..." } }),
    );
    const run = fakeRun({}); // nothing booted
    const result = initConfig({
      cwd: dir,
      fromPackageJson: true,
      configPath,
      discoverDeps: { run },
    });
    const cfg = parseYaml(readFileSync(configPath, "utf8")) as {
      devices: Array<{ platform: string; udid: string }>;
    };
    expect(cfg.devices).toHaveLength(2);
    expect(cfg.devices.find((d) => d.platform === "ios")?.udid).toMatch(/REPLACE/);
    expect(result.discovered).toEqual([]);
  });

  it("writes an empty devices list when nothing is discoverable and no package.json hint", () => {
    const run = fakeRun({});
    const result = initConfig({
      cwd: dir,
      fromPackageJson: false,
      configPath,
      discoverDeps: { run },
    });
    const cfg = parseYaml(readFileSync(configPath, "utf8")) as { devices: unknown[] };
    expect(cfg.devices).toEqual([]);
    expect(result.message).toContain("no devices found");
  });

  it("does not overwrite an existing config", () => {
    writeFileSync(configPath, "existing: yes\n");
    const result = initConfig({
      cwd: dir,
      fromPackageJson: false,
      configPath,
      skipDiscover: true,
    });
    expect(result.message).toContain("already exists");
    expect(readFileSync(configPath, "utf8")).toBe("existing: yes\n");
  });
});

describe("initConfig starter specs", () => {
  it("writes .maestro/smoke-<platform>.yaml when .maestro/ exists and a device is discovered", () => {
    mkdirSync(join(dir, ".maestro"));
    const run: DiscoverDeps["run"] = (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`;
      if (key === "xcrun simctl list devices booted --json") {
        return {
          stdout: JSON.stringify({
            devices: { ios: [{ udid: "IOS-1", name: "iPhone 16", state: "Booted" }] },
          }),
          status: 0,
        };
      }
      return { stdout: "", status: 1 };
    };
    const result = initConfig({
      cwd: dir,
      fromPackageJson: false,
      configPath,
      discoverDeps: { run },
    });
    expect(result.specsWritten).toHaveLength(1);
    expect(existsSync(join(dir, ".maestro", "smoke-ios.yaml"))).toBe(true);
    const spec = readFileSync(join(dir, ".maestro", "smoke-ios.yaml"), "utf8");
    expect(spec).toContain("platform: ios");
    expect(spec).toContain("rebootSimBefore: true");
    expect(spec).toContain(".maestro");
  });

  it("does not scaffold specs when .maestro/ is absent", () => {
    const run: DiscoverDeps["run"] = (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`;
      if (key === "xcrun simctl list devices booted --json") {
        return {
          stdout: JSON.stringify({
            devices: { ios: [{ udid: "IOS-1", name: "iPhone 16", state: "Booted" }] },
          }),
          status: 0,
        };
      }
      return { stdout: "", status: 1 };
    };
    const result = initConfig({
      cwd: dir,
      fromPackageJson: false,
      configPath,
      discoverDeps: { run },
    });
    expect(result.specsWritten).toEqual([]);
  });

  it("skipSpecs disables spec scaffolding", () => {
    mkdirSync(join(dir, ".maestro"));
    const run: DiscoverDeps["run"] = (cmd, args) => {
      const key = `${cmd} ${args.join(" ")}`;
      if (key === "xcrun simctl list devices booted --json") {
        return {
          stdout: JSON.stringify({
            devices: { ios: [{ udid: "IOS-1", name: "iPhone 16", state: "Booted" }] },
          }),
          status: 0,
        };
      }
      return { stdout: "", status: 1 };
    };
    const result = initConfig({
      cwd: dir,
      fromPackageJson: false,
      configPath,
      discoverDeps: { run },
      skipSpecs: true,
    });
    expect(result.specsWritten).toEqual([]);
    expect(existsSync(join(dir, "maestroq", "smoke-ios.yaml"))).toBe(false);
  });
});
