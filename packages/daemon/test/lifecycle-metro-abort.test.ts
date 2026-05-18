import { describe, expect, it } from "vitest";
import { waitForMetroReady } from "../src/lifecycle/metro.js";

describe("waitForMetroReady abort", () => {
  it("rejects quickly when AbortSignal is already aborted (does not wait timeout)", async () => {
    const ac = new AbortController();
    ac.abort();
    const before = Date.now();
    // Use a port unlikely to be listening so fetch fails (or aborts immediately).
    await expect(waitForMetroReady(19999, 30_000, ac.signal)).rejects.toThrow(/aborted/);
    const elapsed = Date.now() - before;
    // Should reject in well under the 30s timeout.
    expect(elapsed).toBeLessThan(2_000);
  });
});
