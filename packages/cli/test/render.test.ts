import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobSpecSchema, type JobRecord } from "@maestroq/core";
import { printJobs } from "../src/render.js";

let writeSpy: ReturnType<typeof vi.spyOn>;
let output: string;

beforeEach(() => {
  output = "";
  writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    output += String(chunk);
    return true;
  });
});

afterEach(() => {
  writeSpy.mockRestore();
});

const spec = JobSpecSchema.parse({
  cwd: "/tmp/x",
  flows: ["smoke.yaml"],
  platform: "ios",
  label: "smoke iOS",
});

const now = Date.now();

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    spec,
    status: "queued",
    createdAt: now - 30_000,
    ...overrides,
  };
}

describe("printJobs", () => {
  it("emits one row per job without a header by default", () => {
    printJobs({ jobs: [job()] });
    const lines = output.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^11111111\s+x\s+ios\s+queued/);
  });

  it("prepends a header row when header: true", () => {
    printJobs({ jobs: [job()] }, { header: true });
    const lines = output.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^ID\s+WORKTREE\s+PLAT\s+STATUS\s+CREATED\s+STARTED\s+DUR\s+EXIT\s+LABEL$/);
    expect(lines[1]).toMatch(/^11111111\s+x\s+ios\s+queued\s+\d+s\s+-\s+-\s+-\s+smoke iOS$/);
  });

  it("shows running duration for an in-flight job", () => {
    const startedAt = now - 12_000;
    printJobs({ jobs: [job({ status: "running", startedAt })] }, { header: false });
    expect(output).toMatch(/running\s+\d+s\s+\d+s\s+1[12]\.\ds/);
  });

  it("shows final duration and exit code for terminal jobs", () => {
    const startedAt = now - 90_000;
    const finishedAt = now - 5_000;
    printJobs(
      { jobs: [job({ status: "succeeded", startedAt, finishedAt, exitCode: 0 })] },
      { header: false },
    );
    expect(output).toMatch(/succeeded\s+\d+s\s+\d+m\d+s\s+85\.0s\s+0\s+smoke iOS/);
  });

  it("shows the worktree basename and truncates long ones", () => {
    const longCwd = "/Users/me/repos/some/very-long-worktree-name-that-overflows";
    const longSpec = JobSpecSchema.parse({
      cwd: longCwd,
      flows: ["a.yaml"],
      platform: "android",
      label: "x",
    });
    printJobs({ jobs: [{ ...job(), spec: longSpec }] }, { header: true });
    const lines = output.trimEnd().split("\n");
    expect(lines[1]).toMatch(/very-long-worktre…/);
  });

  it("handles single job payload (mq status <id>)", () => {
    printJobs({ jobs: job() });
    const lines = output.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
  });

  it("prints a sentinel when there are no jobs", () => {
    printJobs({ jobs: [] });
    expect(output).toBe("(no jobs)\n");
  });
});
