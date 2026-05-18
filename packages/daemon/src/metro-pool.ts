import { logger } from "./logger.js";

export interface MetroLease {
  port: number;
  worktreeKey: string;
  refCount: number;
  pid?: number;
}

export class MetroPortPool {
  private readonly inUse = new Map<number, MetroLease>();
  private readonly byWorktree = new Map<string, MetroLease>();

  constructor(private readonly range: [number, number]) {}

  acquire(worktreeKey: string, reuse: boolean): MetroLease {
    if (reuse) {
      const existing = this.byWorktree.get(worktreeKey);
      if (existing) {
        existing.refCount += 1;
        logger.debug(
          { worktreeKey, port: existing.port, refCount: existing.refCount },
          "metro: reused",
        );
        return existing;
      }
    }
    const [lo, hi] = this.range;
    for (let port = lo; port <= hi; port += 1) {
      if (!this.inUse.has(port)) {
        const lease: MetroLease = { port, worktreeKey, refCount: 1 };
        this.inUse.set(port, lease);
        this.byWorktree.set(worktreeKey, lease);
        logger.debug({ worktreeKey, port }, "metro: leased");
        return lease;
      }
    }
    throw new Error(`metro: no free port in range ${lo}-${hi}`);
  }

  attachPid(port: number, pid: number): void {
    const lease = this.inUse.get(port);
    if (lease) lease.pid = pid;
  }

  release(port: number): MetroLease | undefined {
    const lease = this.inUse.get(port);
    if (!lease) return undefined;
    lease.refCount -= 1;
    if (lease.refCount > 0) return lease;
    this.inUse.delete(port);
    this.byWorktree.delete(lease.worktreeKey);
    logger.debug({ worktreeKey: lease.worktreeKey, port }, "metro: released");
    return lease;
  }

  snapshot(): MetroLease[] {
    return [...this.inUse.values()];
  }
}
