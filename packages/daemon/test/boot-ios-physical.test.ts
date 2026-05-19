import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetIosSimCacheForTests, bootDevice } from "../src/lifecycle/boot.js";

let dir: string;
let callsFile: string;
let oldPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maestroq-boot-ios-phys-"));
  callsFile = join(dir, "xcrun-calls.txt");
  oldPath = process.env.PATH;
  _resetIosSimCacheForTests();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (oldPath !== undefined) process.env.PATH = oldPath;
});

function installFakeXcrun(body: string): void {
  const path = join(dir, "xcrun");
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${callsFile}"\n${body}\n`);
  chmodSync(path, 0o755);
  process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
}

const PHYS_UDID = "FC709E4A-D053-5166-82DE-75E387268B2E";

// xcrun fake:
//  - `simctl list -j devices` → empty device map (so our udid is treated as physical)
//  - `devicectl list devices --json-output <path>` → writes a JSON file with one device
//  - `simctl bootstatus` would hang — but it must NEVER be called for physical
const FAKE_PHYSICAL_XCRUN = `
case "$1 $2" in
  "simctl list")
    echo '{"devices":{}}'
    exit 0
    ;;
  "devicectl list")
    # The --json-output flag is arg 5; write the structured JSON there.
    JSON_PATH="$5"
    printf '{"result":{"devices":[{"identifier":"${PHYS_UDID}","connectionProperties":{"tunnelState":"connected"}}]}}' > "$JSON_PATH"
    exit 0
    ;;
  "simctl bootstatus")
    echo "PHYSICAL_PATH_BOOTSTATUS_LEAKED" >&2
    exit 99
    ;;
esac
exit 0
`;

describe("bootDevice: physical iOS device", () => {
  it("skips simctl bootstatus and verifies via devicectl when UDID is not a simulator", async () => {
    installFakeXcrun(FAKE_PHYSICAL_XCRUN);

    await expect(
      bootDevice({
        device: { udid: PHYS_UDID, platform: "ios" },
        rebootSimBefore: false,
        logSink: () => undefined,
      }),
    ).resolves.toBeUndefined();

    const calls = readFileSync(callsFile, "utf8");
    expect(calls).toContain("simctl list -j devices");
    expect(calls).toContain("devicectl list devices");
    expect(calls).not.toContain("simctl bootstatus");
    expect(calls).not.toContain("simctl shutdown");
  });

  it("throws a clear error when no physical device is paired", async () => {
    installFakeXcrun(`
case "$1 $2" in
  "simctl list") echo '{"devices":{}}'; exit 0 ;;
  "devicectl list")
    JSON_PATH="$5"
    printf '{"result":{"devices":[]}}' > "$JSON_PATH"
    exit 0
    ;;
esac
exit 0
`);

    await expect(
      bootDevice({
        device: { udid: PHYS_UDID, platform: "ios" },
        rebootSimBefore: false,
        logSink: () => undefined,
      }),
    ).rejects.toThrow(/no physical iOS device visible/);
  });
});
