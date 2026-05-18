import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { type JobSpecInput, type ProjectConfig, ProjectConfigSchema } from "@maestroq/core";
import { parse as parseYaml } from "yaml";

const MAX_WALK = 16;

export interface FoundProjectConfig {
  path: string;
  dir: string;
  config: ProjectConfig;
}

export function findProjectConfig(startDir: string): FoundProjectConfig | null {
  let dir = resolve(startDir);
  for (let i = 0; i < MAX_WALK; i += 1) {
    const candidate = resolve(dir, ".maestro", "maestroq.yaml");
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, "utf8");
      const parsed = parseYaml(raw) ?? {};
      return { path: candidate, dir, config: ProjectConfigSchema.parse(parsed) };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// Merge project defaults into a raw spec object (the input to JobSpecSchema.parse).
// Spec values always win; project config only fills gaps. Relative `cwd` from the
// project config is resolved against the directory of the config file.
export function mergeProjectConfigIntoSpec(
  rawSpec: Record<string, unknown>,
  found: FoundProjectConfig,
): JobSpecInput {
  const merged: Record<string, unknown> = { ...rawSpec };
  const projectDefaults = found.config.defaults ?? {};

  if (merged.cwd === undefined) {
    const cfgCwd = found.config.cwd;
    if (cfgCwd !== undefined) {
      merged.cwd = isAbsolute(cfgCwd) ? cfgCwd : resolve(found.dir, cfgCwd);
    } else {
      merged.cwd = found.dir;
    }
  }
  for (const key of ["platform", "rebootSimBefore", "build", "metro", "priority"] as const) {
    if (merged[key] === undefined && projectDefaults[key] !== undefined) {
      merged[key] = projectDefaults[key];
    }
  }
  if (projectDefaults.env) {
    merged.env = {
      ...projectDefaults.env,
      ...((merged.env as Record<string, string> | undefined) ?? {}),
    };
  }
  return merged as JobSpecInput;
}

// Resolve a user-provided spec argument to a real path.
// - explicit relative or absolute path with .yaml/.yml extension or that exists: returned as-is
// - bare name (e.g. "smoke-ios"): looked up as `.maestro/<name>.yaml` walking up from cwd
export function resolveSpecPath(arg: string, cwd: string = process.cwd()): string {
  if (arg.includes("/") || arg.endsWith(".yaml") || arg.endsWith(".yml")) {
    return resolve(cwd, arg);
  }
  if (existsSync(resolve(cwd, arg))) return resolve(cwd, arg);
  let dir = resolve(cwd);
  for (let i = 0; i < MAX_WALK; i += 1) {
    const candidate = resolve(dir, ".maestro", `${arg}.yaml`);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(cwd, arg);
}
