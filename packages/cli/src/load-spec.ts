import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type JobSpec, JobSpecSchema } from "@maestroq/core";
import { parse as parseYaml } from "yaml";
import {
  findProjectConfig,
  mergeProjectConfigIntoSpec,
  resolveSpecPath,
} from "./project-config-loader.js";

export function loadSpec(pathOrName: string): JobSpec {
  const abs = resolveSpecPath(pathOrName);
  const raw = readFileSync(abs, "utf8");
  const parsed = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const project = findProjectConfig(resolve(abs, ".."));
  let rawSpec: Record<string, unknown>;
  if (project) {
    rawSpec = mergeProjectConfigIntoSpec(parsed, project) as Record<string, unknown>;
  } else {
    rawSpec = { cwd: process.cwd(), ...parsed };
  }
  return JobSpecSchema.parse(rawSpec);
}
