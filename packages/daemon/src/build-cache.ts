import { createHash } from "node:crypto";
import { execa } from "execa";
import type { JobSpec, Variant } from "@maestroq/core";
import { logger } from "./logger.js";

export interface CacheKey {
  cwd: string;
  head: string;
  platform: JobSpec["platform"];
  variant: Variant;
  envHash: string;
}

export interface CacheDecision {
  use: boolean;
  reason: "clean-hit" | "dirty-tree" | "cache-disabled" | "no-prior-build" | "key-mismatch";
  key?: CacheKey;
}

const lastBuilds = new Map<string, CacheKey>();

export async function gitHead(cwd: string): Promise<string> {
  const { stdout } = await execa("git", ["rev-parse", "HEAD"], { cwd });
  return stdout.trim();
}

export async function workingTreeDirty(cwd: string): Promise<boolean> {
  const { stdout } = await execa("git", ["status", "--porcelain"], { cwd });
  return stdout.trim().length > 0;
}

export function hashEnv(env: Record<string, string>): string {
  const sorted = Object.keys(env)
    .sort()
    .map((k) => `${k}=${env[k]}`)
    .join("\n");
  return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}

function keyId(key: CacheKey): string {
  return `${key.cwd}::${key.platform}::${key.variant}`;
}

export async function decideCache(
  spec: JobSpec,
  variant: Variant,
  deviceKey: string,
): Promise<CacheDecision> {
  if (spec.build === "skip") return { use: false, reason: "cache-disabled" };
  if (!spec.build.cache) return { use: false, reason: "cache-disabled" };

  const dirty = await workingTreeDirty(spec.cwd);
  if (dirty) {
    logger.info({ cwd: spec.cwd }, "cache: bypassed (working tree dirty)");
    return { use: false, reason: "dirty-tree" };
  }

  const head = await gitHead(spec.cwd);
  const envHash = hashEnv(spec.env);
  const key: CacheKey = { cwd: spec.cwd, head, platform: spec.platform, variant, envHash };
  const prior = lastBuilds.get(`${keyId(key)}::${deviceKey}`);
  if (!prior) return { use: false, reason: "no-prior-build", key };
  if (
    prior.head === key.head &&
    prior.envHash === key.envHash &&
    prior.variant === key.variant
  ) {
    return { use: true, reason: "clean-hit", key };
  }
  return { use: false, reason: "key-mismatch", key };
}

export function recordSuccessfulBuild(key: CacheKey, deviceKey: string): void {
  lastBuilds.set(`${keyId(key)}::${deviceKey}`, key);
}

export function _resetCacheForTests(): void {
  lastBuilds.clear();
}
