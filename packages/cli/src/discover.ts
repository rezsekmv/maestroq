import { spawnSync } from "node:child_process";

export interface DiscoveredDevice {
  udid: string;
  platform: "ios" | "android";
  label?: string;
  avdName?: string;
}

export interface DiscoverDeps {
  run?: (cmd: string, args: readonly string[]) => { stdout: string; status: number | null };
}

const defaultRun = (cmd: string, args: readonly string[]): { stdout: string; status: number | null } => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { stdout: r.stdout ?? "", status: r.status };
};

export function discoverIosSimulators(deps: DiscoverDeps = {}): DiscoveredDevice[] {
  const run = deps.run ?? defaultRun;
  const r = run("xcrun", ["simctl", "list", "devices", "booted", "--json"]);
  if (r.status !== 0 || !r.stdout) return [];
  let parsed: { devices?: Record<string, Array<{ udid: string; name: string; state: string }>> };
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return [];
  }
  const out: DiscoveredDevice[] = [];
  for (const list of Object.values(parsed.devices ?? {})) {
    for (const d of list) {
      if (d.state === "Booted") {
        out.push({ udid: d.udid, platform: "ios", label: d.name });
      }
    }
  }
  return out;
}

export function discoverAndroidEmulators(deps: DiscoverDeps = {}): DiscoveredDevice[] {
  const run = deps.run ?? defaultRun;
  const r = run("adb", ["devices"]);
  if (r.status !== 0 || !r.stdout) return [];
  const out: DiscoveredDevice[] = [];
  for (const line of r.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("List of devices")) continue;
    const [udid, state] = trimmed.split(/\s+/);
    if (!udid || state !== "device") continue;
    const avd = avdNameFor(udid, deps);
    out.push({
      udid,
      platform: "android",
      ...(avd ? { label: avd, avdName: avd } : { label: udid }),
    });
  }
  return out;
}

function avdNameFor(udid: string, deps: DiscoverDeps): string | undefined {
  const run = deps.run ?? defaultRun;
  const r = run("adb", ["-s", udid, "emu", "avd", "name"]);
  if (r.status !== 0 || !r.stdout) return undefined;
  const first = r.stdout.split("\n").map((l) => l.trim()).find((l) => l && l !== "OK");
  return first || undefined;
}

export function discoverAllDevices(deps: DiscoverDeps = {}): DiscoveredDevice[] {
  return [...discoverIosSimulators(deps), ...discoverAndroidEmulators(deps)];
}
