import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const MQ = resolve(REPO_ROOT, "packages/cli/dist/index.js");

let HOME: string;
let daemonProc: ChildProcess | undefined;

interface MqResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

function mq(args: string[], timeoutMs = 8_000): MqResult {
  const r = spawnSync("node", [MQ, ...args], {
    env: { ...process.env, HOME, MAESTROQ_LOG_LEVEL: "silent" },
    encoding: "utf8",
    timeout: timeoutMs,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  if (!existsSync(MQ)) {
    throw new Error(`maestroq binary missing at ${MQ}. Run \`npm run build\` first.`);
  }
  HOME = mkdtempSync(join(tmpdir(), "mq-quickstart-"));
  mkdirSync(join(HOME, ".maestroq"), { recursive: true });
  writeFileSync(
    join(HOME, ".maestroq", "config.yaml"),
    `devices:
  - udid: "FAKE-IOS-UDID"
    platform: ios
    label: "Fake iPhone"
  - udid: "fake-emulator-5554"
    platform: android
    label: "Fake Android"
metro:
  port_range: [8081, 8089]
`,
  );
});

afterAll(async () => {
  if (daemonProc?.pid) {
    try {
      process.kill(daemonProc.pid, "SIGTERM");
    } catch {
      // already dead
    }
  }
  if (HOME) rmSync(HOME, { recursive: true, force: true });
});

describe("README quick start (integration)", () => {
  it("step 0 — daemon-not-running hint before any start", () => {
    const status = mq(["daemon", "status"]);
    expect(status.stdout).toMatch(/not running/);
    expect(status.status).toBe(1);

    const devices = mq(["devices"]);
    expect(devices.stderr).toMatch(/daemon not running/);
    expect(devices.status).toBe(2);
  });

  it("step 1 — `maestroq daemon start` brings the daemon up", async () => {
    daemonProc = spawn("node", [MQ, "daemon", "start"], {
      env: { ...process.env, HOME, MAESTROQ_LOG_LEVEL: "silent" },
      stdio: "ignore",
    });
    daemonProc.on("error", () => undefined);

    const sockPath = join(HOME, ".maestroq", "daemon.sock");
    await waitFor(() => existsSync(sockPath));

    const status = mq(["daemon", "status"]);
    expect(status.stdout).toMatch(/running \(pid \d+\)/);
    expect(status.status).toBe(0);
  });

  it("step 2 — `maestroq devices` lists everything in config.yaml", () => {
    const r = mq(["devices"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("FAKE-IOS-UDID");
    expect(r.stdout).toContain("fake-emulator-5554");
    expect(r.stdout).toMatch(/ios\s+FAKE-IOS-UDID\s+.*idle/);
    expect(r.stdout).toMatch(/android\s+fake-emulator-5554\s+.*idle/);
  });

  it("step 3 — `maestroq status` is empty on a fresh queue", () => {
    const r = mq(["status"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no jobs/);
  });

  it("step 3b — `maestroq status --json` returns structured empty output", () => {
    const r = mq(["status", "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as { jobs: unknown[] };
    expect(Array.isArray(parsed.jobs)).toBe(true);
    expect(parsed.jobs).toHaveLength(0);
  });

  it("step 4 — `maestroq daemon stop` tears it down cleanly", async () => {
    const stop = mq(["daemon", "stop"]);
    expect(stop.status).toBe(0);

    const sockPath = join(HOME, ".maestroq", "daemon.sock");
    await waitFor(() => !existsSync(sockPath), 5_000);

    const after = mq(["daemon", "status"]);
    expect(after.stdout).toMatch(/not running/);
    expect(after.status).toBe(1);
    daemonProc = undefined;
  });
});
