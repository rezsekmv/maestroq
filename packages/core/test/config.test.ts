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
