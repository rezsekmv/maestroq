import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";

describe("ConfigSchema defaults.runner", () => {
  it("defaults to maestro-runner when defaults block is absent", () => {
    const cfg = ConfigSchema.parse({});
    expect(cfg.defaults.runner).toBe("maestro-runner");
  });

  it("defaults to maestro-runner when defaults block is present but runner is omitted", () => {
    const cfg = ConfigSchema.parse({ defaults: { reboot_sim_before: true } });
    expect(cfg.defaults.runner).toBe("maestro-runner");
  });

  it("accepts explicit runner=maestro", () => {
    const cfg = ConfigSchema.parse({ defaults: { runner: "maestro" } });
    expect(cfg.defaults.runner).toBe("maestro");
  });

  it("rejects unknown runner values", () => {
    expect(() => ConfigSchema.parse({ defaults: { runner: "custom" } })).toThrow();
  });
});

describe("ConfigSchema timing defaults", () => {
  it("sets cancel/metro/maestro timeouts to their defaults", () => {
    const cfg = ConfigSchema.parse({});
    expect(cfg.defaults.cancel_grace_ms).toBe(5_000);
    expect(cfg.defaults.metro_ready_timeout_ms).toBe(60_000);
    expect(cfg.defaults.maestro_finalize_timeout_ms).toBe(30_000);
  });

  it("accepts user-supplied timeouts", () => {
    const cfg = ConfigSchema.parse({
      defaults: {
        cancel_grace_ms: 12_000,
        metro_ready_timeout_ms: 90_000,
        maestro_finalize_timeout_ms: 45_000,
      },
    });
    expect(cfg.defaults.cancel_grace_ms).toBe(12_000);
    expect(cfg.defaults.metro_ready_timeout_ms).toBe(90_000);
    expect(cfg.defaults.maestro_finalize_timeout_ms).toBe(45_000);
  });

  it("rejects non-positive timing values", () => {
    expect(() => ConfigSchema.parse({ defaults: { cancel_grace_ms: 0 } })).toThrow();
    expect(() => ConfigSchema.parse({ defaults: { metro_ready_timeout_ms: -1 } })).toThrow();
  });

  it("accepts zero retention days but rejects negative", () => {
    const cfg = ConfigSchema.parse({ defaults: { queue_retention_days: 0 } });
    expect(cfg.defaults.queue_retention_days).toBe(0);
    expect(() => ConfigSchema.parse({ defaults: { queue_retention_days: -1 } })).toThrow();
  });
});
