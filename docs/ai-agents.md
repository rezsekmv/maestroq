# Wiring `maestroq` into AI coding agents

This is the workflow `maestroq` was built for. You have N AI agents (Claude Code, Cursor, Codex, your own) each working in its own git worktree of the same React Native / Expo app. Each one occasionally wants to run a Maestro flow to verify a change. The shared simulator can only serve one at a time.

## Wire-up (one-time)

```bash
npm i -g maestroq
maestroq daemon start &           # or install as a launchd job; see docs/launchd.md
$EDITOR ~/.maestroq/config.yaml
```

Restart the daemon after editing config.

## Per-worktree job specs

Drop a `maestroq/<flow>.yaml` into each worktree (or share one set in `examples/`). Keep `priority` at 0 unless one agent has user-facing urgency.

```yaml
platform: ios
flows:
  - .maestro/smoke.yaml
build:
  variant: release
  cache: true
label: "agent-A smoke"
```

## Telling the agent what to do

Add this to your project's `CLAUDE.md` (or your agent's equivalent):

> To run Maestro flows, submit them through `maestroq` rather than calling `maestro` directly:
>
> ```
> maestroq run maestroq/smoke-ios.yaml
> ```
>
> `maestroq run` blocks until the job finishes, streams logs, and exits with the underlying Maestro exit code — so `maestroq run … && next-step` works the way you'd expect. If the daemon isn't running, you'll see a one-line hint; ask the human to start it.

If you want the agent to be able to fire off long jobs and come back later:

```bash
JOB=$(maestroq submit maestroq/smoke-ios.yaml)
# ... agent does other work ...
maestroq logs "$JOB" -f
```

## Why this works

- One queue, FIFO, across every agent on the box — no more "did another agent's build clobber mine?"
- Each job's child processes live in their own process group, so an agent calling `maestroq cancel <id>` cleanly kills `maestro`, the in-flight `xcodebuild`/`gradle`, and any Metro instance unique to that job.
- The build cache is **off** while a working tree is dirty — agents iterating on changes never get served a stale binary.
- `maestroq status --json` and per-command `--json` flags give agents a structured surface to reason about.

## What `maestroq` does **not** do

- It doesn't sandbox agents from each other's worktrees — they share the same git checkouts on disk.
- It doesn't enforce that agents use the queue. A rogue `maestro test` from a script will still bypass it.
- It doesn't run multiple jobs on one simulator. That's a Maestro limitation.
