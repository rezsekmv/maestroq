import { type JobRecord, JobSpecSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("printJobs short (default)", () => {
  it("emits the 5-col short view without a header by default", () => {
    printJobs({ jobs: [job()] });
    const lines = output
      .trimEnd()
      .split("\n")
      .map((l) => l.trimEnd());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^11111111\s+x\s+ios\s+queued\s+-$/);
  });

  it("short header is ID WORKTREE PLAT STATUS DUR (no CREATED/STARTED/EXIT/LABEL)", () => {
    printJobs({ jobs: [job()] }, { header: true });
    const lines = output
      .trimEnd()
      .split("\n")
      .map((l) => l.trimEnd());
    expect(lines[0]).toMatch(/^ID\s+WORKTREE\s+PLAT\s+STATUS\s+DUR$/);
    expect(lines[0]).not.toMatch(/CREATED|STARTED|EXIT|LABEL/);
  });
});

describe("printJobs long (-l/--long)", () => {
  it("includes WORKTREE, CREATED, STARTED, EXIT", () => {
    printJobs({ jobs: [job()] }, { header: true, long: true });
    const lines = output.trimEnd().split("\n");
    expect(lines[0]).toMatch(
      /^ID\s+WORKTREE\s+PLAT\s+STATUS\s+CREATED\s+STARTED\s+DUR\s+EXIT\s+LABEL$/,
    );
    expect(lines[1]).toMatch(/^11111111\s+x\s+ios\s+queued\s+\d+s\s+-\s+-\s+-\s+smoke iOS$/);
  });

  it("shows running duration for an in-flight job", () => {
    const startedAt = now - 12_000;
    printJobs({ jobs: [job({ status: "running", startedAt })] }, { long: true });
    expect(output).toMatch(/running\s+\d+s\s+\d+s\s+1[12]\.\ds/);
  });

  it("shows final duration and exit code for terminal jobs", () => {
    const startedAt = now - 90_000;
    const finishedAt = now - 5_000;
    printJobs(
      { jobs: [job({ status: "succeeded", startedAt, finishedAt, exitCode: 0 })] },
      { long: true },
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
    printJobs({ jobs: [{ ...job(), spec: longSpec }] }, { header: true, long: true });
    const lines = output.trimEnd().split("\n");
    expect(lines[1]).toMatch(/very-long-worktre…/);
  });
});

describe("printJobs colors", () => {
  it("wraps STATUS in green when succeeded + color:true", () => {
    printJobs(
      {
        jobs: [
          job({
            status: "succeeded",
            startedAt: now - 30_000,
            finishedAt: now - 5_000,
            exitCode: 0,
          }),
        ],
      },
      { long: true, color: true },
    );
    expect(output).toContain("\x1b[32msucceeded");
    expect(output).toMatch(/\x1b\[32m0/);
  });

  it("wraps STATUS in red for failed and EXIT in red for non-zero", () => {
    printJobs(
      {
        jobs: [
          job({ status: "failed", startedAt: now - 30_000, finishedAt: now - 5_000, exitCode: 1 }),
        ],
      },
      { long: true, color: true },
    );
    expect(output).toContain("\x1b[31mfailed");
    expect(output).toMatch(/\x1b\[31m1/);
  });

  it("emits no ANSI when color is off", () => {
    printJobs({ jobs: [job({ status: "succeeded" })] }, { long: true, color: false });
    expect(output).not.toContain("\x1b[");
  });

  it("never bolds any row", () => {
    printJobs(
      {
        jobs: [job({ status: "running", startedAt: now - 5_000 }), job({ status: "queued" })],
      },
      { color: true },
    );
    expect(output).not.toContain("\x1b[1m");
  });

  it("handles single job payload (maestroq status <id>)", () => {
    printJobs({ jobs: job() });
    const lines = output.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
  });

  it("prints a sentinel when there are no jobs", () => {
    printJobs({ jobs: [] });
    expect(output).toBe("(no jobs)\n");
  });
});
