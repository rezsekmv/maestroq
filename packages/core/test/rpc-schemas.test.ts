import { describe, expect, it } from "vitest";
import {
  CancelResponseSchema,
  DevicesResponseSchema,
  JobSpecSchema,
  StatusResponseSchema,
  SubmitResponseSchema,
} from "../src/index.js";

const job = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "11111111-2222-3333-4444-555555555555",
  spec: JobSpecSchema.parse({ cwd: "/tmp/x", flows: ["a.yaml"], platform: "ios" }),
  status: "queued",
  createdAt: Date.now(),
  ...overrides,
});

describe("SubmitResponseSchema", () => {
  it("round-trips a submit response", () => {
    const parsed = SubmitResponseSchema.safeParse({ jobId: "abc" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.jobId).toBe("abc");
  });

  it("rejects a payload missing jobId", () => {
    expect(SubmitResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("CancelResponseSchema", () => {
  it("round-trips a cancel response", () => {
    const parsed = CancelResponseSchema.safeParse({ cancelled: "abc" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.cancelled).toBe("abc");
  });

  it("rejects when cancelled is missing", () => {
    expect(CancelResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("DevicesResponseSchema", () => {
  it("accepts an empty device list", () => {
    const parsed = DevicesResponseSchema.safeParse({ devices: [] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.devices).toEqual([]);
  });

  it("round-trips devices with all fields", () => {
    const parsed = DevicesResponseSchema.safeParse({
      devices: [
        { udid: "u1", platform: "ios", busy: false },
        { udid: "u2", platform: "android", busy: true, label: "pixel" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown platforms", () => {
    expect(
      DevicesResponseSchema.safeParse({
        devices: [{ udid: "u1", platform: "wear", busy: false }],
      }).success,
    ).toBe(false);
  });
});

describe("StatusResponseSchema", () => {
  it("accepts an undefined jobs field", () => {
    const parsed = StatusResponseSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  it("accepts a single job record", () => {
    const parsed = StatusResponseSchema.safeParse({ jobs: job() });
    expect(parsed.success).toBe(true);
  });

  it("accepts an array of jobs", () => {
    const parsed = StatusResponseSchema.safeParse({ jobs: [job(), job({ status: "running" })] });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown status enum value", () => {
    const parsed = StatusResponseSchema.safeParse({ jobs: job({ status: "unknown" }) });
    expect(parsed.success).toBe(false);
  });
});
