import { describe, expect, it } from "vitest";
import { MetroPortPool } from "../src/metro-pool.js";

describe("MetroPortPool", () => {
  it("hands out unique ports within the range", () => {
    const pool = new MetroPortPool([8081, 8083]);
    const a = pool.acquire("worktree-a", false);
    const b = pool.acquire("worktree-b", false);
    const c = pool.acquire("worktree-c", false);
    expect([a.port, b.port, c.port]).toEqual([8081, 8082, 8083]);
  });

  it("reuses a lease when reuse=true and worktree matches", () => {
    const pool = new MetroPortPool([8081, 8089]);
    const a = pool.acquire("worktree-a", false);
    const a2 = pool.acquire("worktree-a", true);
    expect(a2.port).toBe(a.port);
    expect(a2.refCount).toBe(2);
  });

  it("does not reuse when reuse=false", () => {
    const pool = new MetroPortPool([8081, 8089]);
    const a = pool.acquire("worktree-a", false);
    const a2 = pool.acquire("worktree-a", false);
    expect(a2.port).not.toBe(a.port);
  });

  it("releases when refCount hits 0", () => {
    const pool = new MetroPortPool([8081, 8081]);
    const a = pool.acquire("w", true);
    const a2 = pool.acquire("w", true);
    expect(a2.refCount).toBe(2);
    pool.release(a.port);
    pool.release(a.port);
    expect(pool.snapshot()).toEqual([]);
    // Now the port can be re-leased
    const fresh = pool.acquire("w2", false);
    expect(fresh.port).toBe(8081);
  });

  it("throws when the range is exhausted", () => {
    const pool = new MetroPortPool([8081, 8081]);
    pool.acquire("w1", false);
    expect(() => pool.acquire("w2", false)).toThrow(/no free port/);
  });
});
