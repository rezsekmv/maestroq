import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BUILD_CACHE_PATH, type JobSpec, type Variant } from "@maestroq/core";
import { execa } from "execa";
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
let cachePath: string = BUILD_CACHE_PATH;

export function loadPersistedCache(path: string = BUILD_CACHE_PATH): void {
  cachePath = path;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("cache file is not an array");
    lastBuilds.clear();
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
        throw new Error("invalid cache entry format");
      }
      lastBuilds.set(entry[0] as string, entry[1] as CacheKey);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logger.warn({ err, path }, "build-cache: failed to load, starting empty");
    }
    lastBuilds.clear();
  }
}

function persistCache(): void {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    const tmp = `${cachePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(Array.from(lastBuilds.entries())));
    renameSync(tmp, cachePath);
  } catch (err) {
    logger.warn({ err, path: cachePath }, "build-cache: persist failed");
  }
}

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
  if (prior.head === key.head && prior.envHash === key.envHash && prior.variant === key.variant) {
    return { use: true, reason: "clean-hit", key };
  }
  return { use: false, reason: "key-mismatch", key };
}

export function recordSuccessfulBuild(key: CacheKey, deviceKey: string): void {
  lastBuilds.set(`${keyId(key)}::${deviceKey}`, key);
  persistCache();
}

export function _resetCacheForTests(path?: string): void {
  lastBuilds.clear();
  cachePath = path ?? BUILD_CACHE_PATH;
}
