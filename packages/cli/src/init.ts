import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { CONFIG_PATH, expandHome } from "@maestroq/core";

interface PackageJson {
  scripts?: Record<string, string>;
}

export interface InitOptions {
  cwd: string;
  fromPackageJson: boolean;
  configPath: string;
}

export function initConfig(opts: InitOptions): string {
  if (existsSync(opts.configPath)) {
    return `config already exists at ${opts.configPath}; not overwriting`;
  }
  mkdirSync(dirname(opts.configPath), { recursive: true });

  const devices: Array<Record<string, string>> = [];
  if (opts.fromPackageJson) {
    const pkgPath = join(opts.cwd, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
      const scripts = pkg.scripts ?? {};
      const hasIos = Object.keys(scripts).some((k) => /e2e.*ios|ios.*e2e/i.test(k));
      const hasAndroid = Object.keys(scripts).some((k) => /e2e.*android|android.*e2e/i.test(k));
      if (hasIos) {
        devices.push({
          udid: "REPLACE-WITH-IOS-SIM-UDID",
          platform: "ios",
          label: "iPhone (replace UDID)",
        });
      }
      if (hasAndroid) {
        devices.push({
          udid: "emulator-5554",
          platform: "android",
          label: "Android emulator (replace UDID/avdName)",
          avdName: "REPLACE-WITH-AVD-NAME",
        });
      }
    }
  }

  const config = {
    devices,
    metro: { port_range: [8081, 8089] as [number, number] },
    defaults: { reboot_sim_before: false, build_cache: true },
    log_dir: "~/.local/share/maestroq/logs",
    artifact_dir: "~/.local/share/maestroq/artifacts",
  };
  writeFileSync(opts.configPath, stringifyYaml(config));
  return `wrote ${opts.configPath}`;
}

export function defaultConfigPath(): string {
  return expandHome(CONFIG_PATH);
}
