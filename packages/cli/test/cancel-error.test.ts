import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const MQ = resolve(REPO_ROOT, "packages/cli/dist/index.js");
const FAKE = resolve(HERE, "fixtures/fake-error-daemon.mjs");

async function startFake(socketPath: string, message: string): Promise<ChildProcess> {
  const child = spawn("node", [FAKE, socketPath, message], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise<void>((res, rej) => {
    const timer = setTimeout(() => rej(new Error("fake daemon did not become ready")), 4_000);
    child.stdout?.on("data", (d) => {
      if (d.toString().includes("ready")) {
        clearTimeout(timer);
        res();
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      rej(new Error("fake daemon exited before ready"));
    });
  });
  return child;
}

let home: string;
let socketPath: string;
let fake: ChildProcess | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mq-cancel-error-"));
  mkdirSync(join(home, ".maestroq"), { recursive: true });
  socketPath = join(home, ".maestroq", "daemon.sock");
});

afterEach(async () => {
  if (fake?.pid) {
    fake.kill("SIGTERM");
    await new Promise<void>((res) => fake?.once("exit", () => res()));
    fake = undefined;
  }
  rmSync(home, { recursive: true, force: true });
});

describe("maestroq cancel", () => {
  it("prints the daemon's error message to stderr and exits 1 when the cancel is rejected", async () => {
    fake = await startFake(socketPath, "could not cancel");

    const r = spawnSync("node", [MQ, "cancel", "11111111-1111-1111-1111-111111111111"], {
      env: { ...process.env, HOME: home },
      encoding: "utf8",
      timeout: 5_000,
    });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("could not cancel");
    expect(r.stdout).not.toContain("cancelled:");
  });
});
