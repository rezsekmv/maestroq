# Wiring `maestroq` into AI coding agents

The workflow `maestroq` was built for: N AI agents (Claude Code, Cursor, Codex, your own) each in its own git worktree of the same React Native / Expo app, all wanting to run Maestro flows on the shared simulator without racing each other.

## Setup

Follow the README's [Getting started](../README.md#getting-started) section. `maestroq init` discovers your booted devices and scaffolds a runnable spec — five lines later you're submitting jobs.

If you're using **Claude Code**, install the bundled skill so the agent invokes maestroq automatically:

```
# from this repo
cp integrations/claude-code/SKILL.md ~/.claude/skills/maestroq/SKILL.md
```

See [`integrations/claude-code/SKILL.md`](../integrations/claude-code/SKILL.md) for the full skill body (when to trigger, what specs to look for, how to interpret results).

## Telling other agents what to do

For agents without a skill system, add this to your project's `AGENTS.md` (or `CLAUDE.md`):

> To run Maestro flows, submit them through `maestroq` rather than calling `maestro` directly:
>
> ```
> maestroq run maestroq/smoke-ios.yaml
> ```
>
> `maestroq run` blocks until the job finishes, streams logs, and exits with the underlying Maestro exit code — so `maestroq run … && next-step` chains the way you'd expect. If the daemon isn't running, surface the one-line hint and ask the human to start it.

Async pattern when the agent has other work to do meanwhile:

```bash
JOB=$(maestroq submit maestroq/smoke-ios.yaml)
# ...do other work...
maestroq logs "$JOB" -f
```

## Why this works

- One FIFO queue per device across every agent on the box — no more "did another agent's build clobber mine?".
- Each job's child processes live in their own process group, so `maestroq cancel <id>` cleanly kills `maestro`, the in-flight `xcodebuild` / `gradle`, and any Metro instance unique to that job.
- The build cache auto-bypasses when the working tree is dirty — agents iterating on changes never get served a stale binary.
- `maestroq status --json` and per-command `--json` give agents a structured surface to reason about.

## What `maestroq` does *not* do

- It doesn't sandbox agents from each other's worktrees — they share git checkouts on disk.
- It doesn't enforce that agents use the queue. A rogue `maestro test` from a script will still bypass it.
- It doesn't run multiple jobs on one simulator. That's a Maestro limitation.
