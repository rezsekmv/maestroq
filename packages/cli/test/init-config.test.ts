import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "@maestroq/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import type { DiscoverDeps } from "../src/discover.js";
import { initConfig } from "../src/init.js";

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mq-init-cfg-"));
  configPath = join(dir, "config.yaml");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const noopRun: DiscoverDeps["run"] = () => ({ stdout: "", status: 1 });

describe("initConfig generated YAML knobs", () => {
  it("explicitly sets runner: maestro-runner and includes a commented max_concurrent_ios line", () => {
    initConfig({
      cwd: dir,
      fromPackageJson: false,
      configPath,
      discoverDeps: { run: noopRun },
    });
    const raw = readFileSync(configPath, "utf8");
    expect(raw).toContain("runner: maestro-runner");
    expect(raw).toMatch(/^\s*#\s*max_concurrent_ios:\s*1\b/m);
    // Still parses as a valid config.
    const parsed = parseYaml(raw);
    expect(() => ConfigSchema.parse(parsed)).not.toThrow();
  });
});
