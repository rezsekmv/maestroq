import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { PlatformSchema } from "./job-spec.js";

export const DeviceConfigSchema = z.object({
  udid: z.string().min(1),
  platform: PlatformSchema,
  label: z.string().optional(),
  avdName: z.string().optional(),
});
export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;

export const RunnerSchema = z.enum(["maestro-runner", "maestro"]);
export type Runner = z.infer<typeof RunnerSchema>;

export const ConfigSchema = z.object({
  devices: z.array(DeviceConfigSchema).default([]),
  metro: z
    .object({
      port_range: z
        .tuple([z.number().int().positive(), z.number().int().positive()])
        .default([8081, 8089]),
    })
    .default({ port_range: [8081, 8089] }),
  defaults: z
    .object({
      runner: RunnerSchema.default("maestro-runner"),
      reboot_sim_before: z.boolean().default(false),
      build_cache: z.boolean().default(true),
      max_concurrent_ios: z.number().int().positive().default(1),
      cancel_grace_ms: z.number().int().positive().default(5_000),
      metro_ready_timeout_ms: z.number().int().positive().default(60_000),
      maestro_finalize_timeout_ms: z.number().int().positive().default(30_000),
    })
    .default({
      runner: "maestro-runner",
      reboot_sim_before: false,
      build_cache: true,
      max_concurrent_ios: 1,
      cancel_grace_ms: 5_000,
      metro_ready_timeout_ms: 60_000,
      maestro_finalize_timeout_ms: 30_000,
    }),
  log_dir: z.string().default("~/.local/share/maestroq/logs"),
  artifact_dir: z.string().default("~/.local/share/maestroq/artifacts"),
});
export type Config = z.infer<typeof ConfigSchema>;

export function expandHome(p: string): string {
  if (p.startsWith("~/")) return `${homedir()}/${p.slice(2)}`;
  if (p === "~") return homedir();
  return p;
}

export function loadConfig(path: string): Config {
  const raw = readFileSync(path, "utf8");
  const parsed = parseYaml(raw) ?? {};
  return ConfigSchema.parse(parsed);
}
