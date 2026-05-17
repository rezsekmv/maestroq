import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { CONFIG_PATH, expandHome } from "@maestroq/core";
import { discoverAllDevices, type DiscoverDeps, type DiscoveredDevice } from "./discover.js";

interface PackageJson {
  scripts?: Record<string, string>;
}

export interface InitOptions {
  cwd: string;
  fromPackageJson: boolean;
  configPath: string;
  discoverDeps?: DiscoverDeps;
  skipDiscover?: boolean;
  skipSpecs?: boolean;
}

export interface InitResult {
  message: string;
  discovered: DiscoveredDevice[];
  specsWritten: string[];
}

export function initConfig(opts: InitOptions): InitResult {
  if (existsSync(opts.configPath)) {
    return {
      message: `config already exists at ${opts.configPath}; not overwriting`,
      discovered: [],
      specsWritten: [],
    };
  }
  mkdirSync(dirname(opts.configPath), { recursive: true });

  const allDiscovered = opts.skipDiscover ? [] : discoverAllDevices(opts.discoverDeps);
  const discovered: DiscoveredDevice[] = [];
  for (const platform of ["ios", "android"] as const) {
    const first = allDiscovered.find((d) => d.platform === platform);
    if (first) discovered.push(first);
  }
  let devices: Array<Record<string, string>> = discovered.map((d) => {
    const entry: Record<string, string> = { udid: d.udid, platform: d.platform };
    if (d.label) entry.label = d.label;
    if (d.avdName) entry.avdName = d.avdName;
    return entry;
  });

  if (devices.length === 0 && opts.fromPackageJson) {
    devices = seedFromPackageJson(opts.cwd);
  }

  const config = {
    devices,
    metro: { port_range: [8081, 8089] as [number, number] },
    defaults: { reboot_sim_before: false, build_cache: true },
    log_dir: "~/.local/share/maestroq/logs",
    artifact_dir: "~/.local/share/maestroq/artifacts",
  };
  writeFileSync(opts.configPath, stringifyYaml(config));

  const specsWritten = opts.skipSpecs ? [] : writeStarterSpecs(opts.cwd, discovered);

  const parts = [`wrote ${opts.configPath}`];
  if (discovered.length > 0) {
    parts.push(`discovered ${discovered.length} device${discovered.length === 1 ? "" : "s"}`);
  } else if (devices.length > 0) {
    parts.push("seeded placeholder devices from package.json");
  } else {
    parts.push("no devices found — edit the file to add UDIDs");
  }
  if (specsWritten.length > 0) {
    parts.push(`scaffolded ${specsWritten.length} starter spec${specsWritten.length === 1 ? "" : "s"}`);
  }
  return { message: parts.join(" — "), discovered, specsWritten };
}

function writeStarterSpecs(cwd: string, devices: DiscoveredDevice[]): string[] {
  if (devices.length === 0) return [];
  const maestroDir = join(cwd, ".maestro");
  if (!existsSync(maestroDir)) return [];
  const specsDir = maestroDir;
  mkdirSync(specsDir, { recursive: true });

  const written: string[] = [];
  const projectName = cwd.split("/").filter(Boolean).pop() ?? "project";
  for (const d of devices) {
    const path = join(specsDir, `smoke-${d.platform}.yaml`);
    if (existsSync(path)) continue;
    const spec: Record<string, unknown> = {
      platform: d.platform,
      flows: [".maestro"],
      build: "skip",
      label: `${projectName} smoke ${d.platform}`,
    };
    if (d.platform === "ios") spec.rebootSimBefore = true;
    writeFileSync(path, stringifyYaml(spec));
    written.push(path);
  }
  return written;
}

function seedFromPackageJson(cwd: string): Array<Record<string, string>> {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return [];
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
  const scripts = pkg.scripts ?? {};
  const hasIos = Object.keys(scripts).some((k) => /e2e.*ios|ios.*e2e/i.test(k));
  const hasAndroid = Object.keys(scripts).some((k) => /e2e.*android|android.*e2e/i.test(k));
  const out: Array<Record<string, string>> = [];
  if (hasIos) {
    out.push({
      udid: "REPLACE-WITH-IOS-SIM-UDID",
      platform: "ios",
      label: "iPhone (replace UDID)",
    });
  }
  if (hasAndroid) {
    out.push({
      udid: "emulator-5554",
      platform: "android",
      label: "Android emulator (replace UDID/avdName)",
      avdName: "REPLACE-WITH-AVD-NAME",
    });
  }
  return out;
}

export function defaultConfigPath(): string {
  return expandHome(CONFIG_PATH);
}
