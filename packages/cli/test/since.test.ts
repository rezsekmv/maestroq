import { describe, expect, it, vi } from "vitest";
import { filterJobs, parseLimit, parseSince } from "../src/since.js";

describe("parseSince", () => {
  it("defaults to 1h when undefined or empty", () => {
    expect(parseSince(undefined)).toBe(3_600_000);
    expect(parseSince("")).toBe(3_600_000);
  });

  it("parses seconds, minutes, hours, days", () => {
    expect(parseSince("30s")).toBe(30_000);
    expect(parseSince("15m")).toBe(900_000);
    expect(parseSince("2h")).toBe(7_200_000);
    expect(parseSince("1d")).toBe(86_400_000);
  });

  it("treats a bare number as seconds", () => {
    expect(parseSince("90")).toBe(90_000);
  });

  it("accepts fractional values", () => {
    expect(parseSince("0.5h")).toBe(1_800_000);
  });

  it("falls back to 1h on garbage input and warns", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(parseSince("nonsense")).toBe(3_600_000);
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});

describe("filterJobs (since-only)", () => {
  const now = Date.now();

  it("keeps jobs newer than the cutoff", () => {
    const result = filterJobs(
      {
        jobs: [
          { createdAt: now - 5_000, id: "fresh" },
          { createdAt: now - 7_200_000, id: "old" },
        ],
      },
      { sinceMs: 3_600_000, maxCount: null },
    ) as { jobs: Array<{ id: string }> };
    expect(result.jobs.map((j) => j.id)).toEqual(["fresh"]);
  });

  it("keeps a single-job payload regardless of since (user asked for a specific id)", () => {
    const payload = { jobs: { createdAt: now - 7_200_000 } };
    const result = filterJobs(payload, { sinceMs: 3_600_000, maxCount: null });
    expect(result).toBe(payload);
  });

  it("keeps a single-job payload that is within the window", () => {
    const payload = { jobs: { createdAt: now - 5_000 } };
    const result = filterJobs(payload, { sinceMs: 3_600_000, maxCount: null });
    expect(result).toBe(payload);
  });

  it("always keeps active jobs even when their createdAt is older than --since", () => {
    const result = filterJobs(
      {
        jobs: [
          { id: "old-running", createdAt: now - 7_200_000, status: "running" },
          { id: "old-done", createdAt: now - 7_200_000, status: "succeeded" },
          { id: "new-done", createdAt: now - 5_000, status: "succeeded" },
        ],
      },
      { sinceMs: 3_600_000, maxCount: null },
    ) as { jobs: Array<{ id: string }> };
    // old-running survives despite being outside --since
    // old-done is correctly dropped
    expect(result.jobs.map((j) => j.id).sort()).toEqual(["new-done", "old-running"]);
  });

  it("active jobs are kept even when maxCount would otherwise drop them", () => {
    const result = filterJobs(
      {
        jobs: [
          { id: "running-1", createdAt: now - 7_000, status: "running" },
          { id: "running-2", createdAt: now - 6_000, status: "running" },
          { id: "done-1", createdAt: now - 5_000, status: "succeeded" },
          { id: "done-2", createdAt: now - 4_000, status: "succeeded" },
          { id: "done-3", createdAt: now - 3_000, status: "succeeded" },
        ],
      },
      { sinceMs: null, maxCount: 2 },
    ) as { jobs: Array<{ id: string }> };
    // 2 active + the 1 most-recent inactive (kept to fit the 2-cap budget after actives)
    // Actually: maxCount is 2, both running jobs are forced in, no inactive fits.
    expect(result.jobs.map((j) => j.id).sort()).toEqual(["running-1", "running-2"]);
  });
});

describe("parseLimit", () => {
  it("defaults to 10 when undefined or empty", () => {
    expect(parseLimit(undefined)).toBe(10);
    expect(parseLimit("")).toBe(10);
  });

  it("parses positive integers", () => {
    expect(parseLimit("5")).toBe(5);
    expect(parseLimit("25")).toBe(25);
  });

  it("falls back to 10 on garbage / non-positive and warns", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(parseLimit("nope")).toBe(10);
    expect(parseLimit("0")).toBe(10);
    expect(parseLimit("-3")).toBe(10);
    expect(parseLimit("1.5")).toBe(10);
    stderrSpy.mockRestore();
  });
});

describe("filterJobs (combined since + limit)", () => {
  const N = Date.now();
  const makeJobs = (count: number, stepMs = 1_000): Array<{ id: string; createdAt: number }> =>
    Array.from({ length: count }, (_, i) => ({ id: `j${i}`, createdAt: N - i * stepMs }));

  it("caps to maxCount most-recent when within window", () => {
    const jobs = makeJobs(25, 1_000);
    const result = filterJobs({ jobs }, { sinceMs: 3_600_000, maxCount: 10 }) as {
      jobs: Array<{ id: string }>;
    };
    expect(result.jobs).toHaveLength(10);
    const ids = result.jobs.map((j) => j.id);
    expect(ids).toContain("j0");
    expect(ids).toContain("j9");
    expect(ids).not.toContain("j10");
  });

  it("returns fewer than maxCount when window already trims them", () => {
    const jobs = [
      { id: "fresh-a", createdAt: N - 10_000 },
      { id: "fresh-b", createdAt: N - 20_000 },
      { id: "old", createdAt: N - 7_200_000 },
    ];
    const result = filterJobs({ jobs }, { sinceMs: 3_600_000, maxCount: 10 }) as {
      jobs: Array<{ id: string }>;
    };
    expect(result.jobs.map((j) => j.id).sort()).toEqual(["fresh-a", "fresh-b"]);
  });

  it("no filtering when both opts null (equivalent to --all)", () => {
    const jobs = makeJobs(30);
    const result = filterJobs({ jobs }, { sinceMs: null, maxCount: null }) as {
      jobs: unknown[];
    };
    expect(result.jobs).toHaveLength(30);
  });
});
