import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const MQ = resolve(REPO_ROOT, "packages/cli/dist/index.js");
const FAKE = resolve(HERE, "fixtures/fake-daemon.mjs");

interface Received {
  op: string;
  olderThanMs?: number;
  statuses?: string[];
  deleteLogs?: boolean;
  deleteArtifacts?: boolean;
}

async function startFake(
  socketPath: string,
  reply: object,
  capturePath: string,
): Promise<ChildProcess> {
  const child = spawn("node", [FAKE, socketPath, JSON.stringify(reply), capturePath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
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
let capturePath: string;
let fake: ChildProcess | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mq-prune-cli-"));
  mkdirSync(join(home, ".maestroq"), { recursive: true });
  socketPath = join(home, ".maestroq", "daemon.sock");
  capturePath = join(home, "captured.json");
});

afterEach(async () => {
  if (fake) {
    fake.kill("SIGTERM");
    await new Promise<void>((r) => fake?.once("exit", () => r()));
    fake = undefined;
  }
  rmSync(home, { recursive: true, force: true });
});

function captured(): Received {
  return JSON.parse(readFileSync(capturePath, "utf8")) as Received;
}

describe("maestroq prune CLI", () => {
  it("sends correct payload and prints the count", async () => {
    if (!existsSync(MQ)) throw new Error(`maestroq binary missing at ${MQ}. Run npm run build.`);
    fake = await startFake(socketPath, { removed: 3 }, capturePath);
    const r = spawnSync(
      "node",
      [MQ, "prune", "--older-than", "7d", "--statuses", "succeeded,failed"],
      { env: { ...process.env, HOME: home }, encoding: "utf8", timeout: 8_000 },
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("Pruned 3 jobs.");
    const req = captured();
    expect(req.op).toBe("prune");
    expect(req.olderThanMs).toBe(7 * 86_400_000);
    expect(req.statuses).toEqual(["succeeded", "failed"]);
    expect(req.deleteLogs).toBe(true);
    expect(req.deleteArtifacts).toBe(true);
  });

  it("--keep-logs and --keep-artifacts flip the flags", async () => {
    if (!existsSync(MQ)) throw new Error(`maestroq binary missing at ${MQ}. Run npm run build.`);
    fake = await startFake(socketPath, { removed: 0 }, capturePath);
    const r = spawnSync(
      "node",
      [MQ, "prune", "--older-than", "1h", "--keep-logs", "--keep-artifacts"],
      { env: { ...process.env, HOME: home }, encoding: "utf8", timeout: 8_000 },
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("Pruned 0 jobs.");
    const req = captured();
    expect(req.deleteLogs).toBe(false);
    expect(req.deleteArtifacts).toBe(false);
    expect(req.olderThanMs).toBe(3_600_000);
  });
});
