import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const DAEMON_DIST = resolve(REPO_ROOT, "packages/daemon/dist/index.js");

let tmpHome: string;
let configPath: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "mq-daemon-lock-"));
  mkdirSync(join(tmpHome, ".maestroq"), { recursive: true });
  configPath = join(tmpHome, ".maestroq", "config.yaml");
  // Malformed YAML — loadConfig will throw after the singleton lock is held.
  writeFileSync(configPath, "devices: [this is not :: valid yaml\n");
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("startDaemon: release the singleton lock when init fails", () => {
  it("releases the lock if loading the config throws", () => {
    // Spawn a fresh node process so HOME is picked up at module load time
    // (the path constants in @maestroq/core are computed eagerly from homedir()).
    const script = `
      import { startDaemon } from ${JSON.stringify(DAEMON_DIST)};
      import { check } from "proper-lockfile";
      import { LOCK_PATH } from "@maestroq/core";

      try {
        await startDaemon({ configPath: ${JSON.stringify(configPath)} });
        console.error("expected startDaemon to throw");
        process.exit(2);
      } catch {
        // expected
      }

      const locked = await check(LOCK_PATH, { realpath: false });
      if (locked) {
        console.error("lock was not released");
        process.exit(3);
      }
      process.exit(0);
    `;

    const r = spawnSync("node", ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: tmpHome, MAESTROQ_LOG_LEVEL: "silent" },
      encoding: "utf8",
      timeout: 10_000,
      cwd: REPO_ROOT,
    });

    if (r.status !== 0) {
      throw new Error(
        `subprocess failed (status=${r.status} signal=${r.signal})\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );
    }
  });
});
