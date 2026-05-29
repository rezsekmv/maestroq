import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { METRO_CACHE_DIR } from "@maestroq/core";

// Two `expo run`/`expo start` processes against the same checkout share Metro's
// default FileStore cache root and race on its startup `clear()` (rmSync), which
// throws `ENOTEMPTY` for whichever loses. We hand each job a cache root keyed to
// something unique-per-parallel-job (device udid for builds, metro port for the
// shared bundler) so parallel iOS + Android never touch the same dir, while a
// given device/port still reuses its own cache across runs.
function cacheRootFor(key: string): string {
  return join(METRO_CACHE_DIR, key.replace(/[^A-Za-z0-9._-]/g, "_"));
}

// Returns a copy of `env` with METRO_CACHE_ROOT pointed at a per-key dir,
// unless the caller (process env or spec.env) already pinned it. Creates the dir.
export function withMetroCacheRoot(
  env: NodeJS.ProcessEnv,
  key: string,
  logSink: (line: string) => void,
): NodeJS.ProcessEnv {
  if (env.METRO_CACHE_ROOT) return env;
  const root = cacheRootFor(key);
  mkdirSync(root, { recursive: true });
  logSink(`[metro] METRO_CACHE_ROOT=${root}`);
  return { ...env, METRO_CACHE_ROOT: root };
}
