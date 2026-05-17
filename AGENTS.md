# AGENTS.md

Onboarding for AI coding agents (and humans) working on this repo. Read this top-to-bottom before making non-trivial changes — it captures invariants and known sharp edges that the code alone won't tell you.

---

## What `maestroq` is

A local job queue + daemon that owns a pool of simulators/emulators on one machine and dispatches Maestro test runs to them. Built so multiple AI agents working in parallel git worktrees of a React Native / Expo app can share the same Mac without racing the simulator.

The original design plan is `/Users/vencel/.claude/plans/hello-here-is-a-federated-goblet.md` — it's the source of truth for scope and intent. If you're about to change something architectural, read that first.

---

## Repo layout

```
packages/core/    @maestroq/core    — types, JobSpec zod schema, config loader, paths, RPC schema
packages/daemon/  @maestroq/daemon  — the long-running server (queue, workers, lifecycle, RPC)
packages/cli/     maestroq          — the `maestroq` binary (citty); `bin.maestroq` → dist/index.js
examples/         spec YAMLs for darts26 and a vanilla RN project
docs/             architecture / ai-agents / launchd
.github/workflows ci.yml + release.yml
```

Monorepo via **npm workspaces**. ESM (`"type": "module"`), Node 22+, TypeScript strict with `noUncheckedIndexedAccess` on.

Three packages, three `tsconfig.json` files extending `tsconfig.base.json`. Daemon and cli reference core via project references; the root `tsconfig.json` references all three.

---

## Commands you'll actually use

```bash
npm install                  # install everything; npm 11+ handles workspaces
npm run typecheck            # tsc -b (project references)
npm test                     # vitest run, 20 tests today
npm run build                # build all dist/

# manual / live testing
npm link -w packages/cli     # puts `maestroq` on PATH (uses dist/index.js)
maestroq daemon start &            # foreground daemon (logs to stdout/pino)
maestroq devices                   # confirms config + workers
maestroq run path/to/spec.yaml     # blocks, streams logs, exits with job code
maestroq daemon stop
```

Do **not** invoke `tsc` directly without `-b` — the project references won't resolve.

---

## State on disk (do not break these paths without thinking)

| Path                                          | Owner       | Purpose                                                  |
| --------------------------------------------- | ----------- | -------------------------------------------------------- |
| `~/.maestroq/config.yaml`                     | user        | Device list, port range, defaults.                       |
| `~/.maestroq/daemon.sock`                     | daemon      | RPC socket. `chmod 0600` after listen.                   |
| `~/.maestroq/daemon.pid`                      | daemon      | PID file.                                                |
| `~/.maestroq/queue.json`                      | daemon      | Authoritative job state. Atomic write via `.tmp` + rename. |
| `~/.local/share/maestroq/logs/<id>.log`       | daemon      | Per-job stdout/stderr.                                   |
| `~/.local/share/maestroq/artifacts/<id>/`     | daemon      | Maestro `--output` artifacts.                            |

All path constants live in `packages/core/src/paths.ts`. Anywhere you'd hard-code one of these, import the constant instead.

---

## Architecture in 60 seconds

```
maestroq CLI ─── unix socket (newline-JSON) ──▶ daemon ─── tick ──▶ Dispatcher ─── worker per device
                                            │                                    │
                                            └── persists queue.json              └── spawns external children
                                                                                    in their own process groups
                                                                                    (detached: true)
```

**Workers are in-process** (one instance per registered device, conceptually a state machine). The "process group isolation" the plan talks about lives at the level of each *external child* (`expo run`, `expo start`, `maestro`) — each is spawned with `detached: true`, so `pid === pgid` and `process.kill(-pgid, signal)` sweeps the child and all its descendants.

Job state machine (in `worker.ts`):
```
queued → building → installing → metro-starting? → running → tearing-down → succeeded|failed|cancelled
```

Status enum is in `packages/core/src/job-spec.ts` — `JobStatusSchema`, `ActiveStatuses`, `TerminalStatuses`.

---

## Invariants — break these and the daemon breaks

### 1. External children must be detached

Every long-running external command (`expo run:ios|android`, `expo start`, `maestro test`) is spawned with `execa(... , { detached: true })`. This is what makes `process.kill(-pid, signal)` work to sweep the whole tree (xcodebuild, gradle, JVM child threads). If you add a new lifecycle stage, follow the same pattern. See `lifecycle/build.ts`, `lifecycle/metro.ts`, `lifecycle/maestro.ts`.

### 2. The worker stores the *currently active* child's pid as `pgid`

`worker.ts:trackChild(pid)` writes `queue.update(job.id, { pgid: pid })` *every time* a new external child starts. `queue.json` is then authoritative on disk, so `recovery.ts` can SIGKILL whichever child was alive when the daemon died.

If you add a new lifecycle stage that spawns a child, route its PID through `trackChild`.

### 3. Crash recovery sweeps process groups by negative PID

`recovery.ts:sweepStaleProcessGroups` runs on daemon startup. It reads every active job in `queue.json`, calls `process.kill(-job.pgid, "SIGKILL")`, and marks the job `failed (reason: daemon-crash)`. Don't change the sweep to `kill(job.pgid)` — you'll leak grandchildren.

### 4. Build cache: dirty tree always bypasses

`build-cache.ts:decideCache` calls `git status --porcelain` against `spec.cwd`. If anything comes back, the cache is bypassed and a `cache: bypassed (working tree dirty)` log line lands in the job log. This is **load-bearing** — agents iterating on `src/` would otherwise get served stale binaries.

Cache is in-memory only (a daemon restart clears it). Persisting it across restarts is a v0.2 candidate, not v0.1.

### 5. JobSpec is validated at the boundary, never trusted as plain data

Every request enters through `server.ts` → `RpcRequestSchema.safeParse(...)`. Every spec loaded from YAML in the CLI is `JobSpecSchema.parse(...)`. If you add a new field, add it to the zod schema and let TS infer the type; don't add fields to the interface separately.

### 6. RPC framing is newline-delimited JSON

One line in, one or more `RpcEvent` lines out, terminating with `{"kind":"end"}` — except `logs --follow` keeps streaming after `end` is suppressed. Anything more elaborate (length prefixes, msgpack) is overkill for v0.1.

---

## Known sharp edges (upstream bugs we mitigate)

### Maestro CLI debug-log race

Two `maestro test` invocations starting in the same second share `~/Library/Logs/maestro/<YYYY-MM-DD_HHMMSS>/`. The first to finish deletes the dir; the second one's `DebugLogStore.finalizeRun` throws `NoSuchFileException` from `FileUtils.zipDir` and the JVM hangs forever (non-daemon thread holds it open).

Observed twice on maestro 2.5.1, both during parallel iOS + Android runs from darts26.

**Mitigation** (already in `lifecycle/maestro.ts`): we scan stdout for `\b(\d+)/(\d+) Flows (Passed|Failed)\b`. When that sentinel lands, we start a 30 s finalize watchdog. If the child hasn't exited by then, we SIGKILL its pgid and resolve the run using the captured Passed/Failed outcome. `MaestroResult.killedAfterFinalize` reports this happened.

`--debug-output` does *not* fix the upstream bug (it controls a different artifact dir). Don't waste time on it.

If maestro upstream fixes this, the watchdog can become a no-op or be removed.

### iOS port 7001 staleness

After a `maestro test` run on iOS, the `maestro-driver-iosUITests-Runner` and `xcodebuild test-without-building` helpers can linger past the parent CLI exit. They hold port 7001 stale. The next iOS run dies during install with `Failed to connect to /127.0.0.1:7001`.

**Mitigation:** `JobSpec.rebootSimBefore: true` runs `simctl shutdown` + `bootstatus` (see `lifecycle/boot.ts`). Expensive (~30 s) but reliable. Document on regression specs that hit iOS repeatedly.

Future improvement: detect the lingering processes after teardown and `pkill -f maestro-driver-ios` automatically. Out of v0.1 scope.

### Cancel must escalate

Hung JVMs ignore SIGTERM. `worker.ts:cancel` sends SIGTERM, then schedules a 5 s SIGKILL fallback (gated by `process.kill(-pgid, 0)` to avoid killing a reused pid). Don't remove the escalation.

---

## Conventions

### Commits

Per `/Users/vencel/.claude/CLAUDE.md`: **never sign commits with a `Co-Authored-By: Claude …` line**. The user's git config identity is the only author.

For larger changes, the global rule says to run `coderabbit review --plain`. The user's call when to do that — don't volunteer.

### Code style

- No emojis in source or docs unless the user explicitly asks.
- Default to **no comments**. Only write a comment when the *why* is non-obvious (a hidden invariant, an upstream bug workaround). Don't narrate what the code does. The watchdog comment in `lifecycle/maestro.ts` is a good model: short, captures the *why* (upstream JVM hang), not the *what*.
- Don't add error handling for cases that can't happen. Trust framework guarantees. Validate at boundaries (`RpcRequestSchema`, `JobSpecSchema`, `ConfigSchema`); trust inside.
- No `console.log` in `packages/daemon/` — use the `logger` from `daemon/src/logger.ts` (pino).
- CLI uses `process.stdout.write` / `process.stderr.write` directly. Status messages → stderr, machine-readable output → stdout. Exit codes are part of the contract: `0` clean, `1` job failure, `2` daemon-not-running.

### When `maestroq` can't reach the daemon

CLI must print the `DAEMON_HINT` string and exit `2`. This is wired through `guard()` / `guardClient()` in `packages/cli/src/index.ts` — every command goes through one of them. Don't add an auto-spawn path; the plan explicitly rejected it (revisit in v0.2).

### Tests

- Use **vitest**. Tests live next to each package under `test/`. `vitest.config.ts` at the root picks them up.
- Daemon tests (queue, recovery, build-cache, metro-pool, maestro-watchdog) **must work in a clean tmp dir**. Use `mkdtempSync` + `rmSync({ recursive: true, force: true })` in `beforeEach`/`afterEach`.
- The watchdog test installs a *fake* `maestro` shell script via `PATH` manipulation — see `packages/daemon/test/maestro-watchdog.test.ts`. Use the same pattern for any new lifecycle stage that shells out.
- The recovery test spawns a real `sleep 30` child to verify SIGKILL behavior. Don't mock `process.kill` — the value of that test is that it exercises the actual syscall.

20 tests today, all green. If you add a feature, add a test.

---

## Manual verification recipe

We have no real-device CI (Mac runners are paid). The recipe for verifying a change end-to-end:

```bash
# 1. Build, link, ensure maestroq is on PATH.
npm run build && npm link -w packages/cli

# 2. Start daemon fresh.
rm -rf ~/.maestroq ~/.local/share/maestroq
maestroq daemon start > /tmp/maestroq-daemon.log 2>&1 &
sleep 1 && maestroq daemon status

# 3. Seed config with real UDIDs from already-booted sims/emulators.
xcrun simctl list devices booted    # grab the iOS UDID
adb devices                          # grab the Android emulator id
$EDITOR ~/.maestroq/config.yaml

# 4. Restart so daemon picks up config.
maestroq daemon stop && sleep 1 && maestroq daemon start > /tmp/maestroq-daemon.log 2>&1 &
maestroq devices

# 5. Submit specs from a real worktree (darts26).
cd ~/gitRepos/_home/darts26
IOS=$(maestroq submit maestroq/smoke-ios.yaml)
AND=$(maestroq submit maestroq/smoke-android.yaml)
maestroq status --json | python3 -c '...'   # confirm both reach `running` simultaneously
```

The verification matrix in the plan file (`hello-here-is-a-federated-goblet.md`, "Verification (v0.1)") covers eleven scenarios — when in doubt, run those.

---

## Not in v0.1 (don't accidentally add)

- TCP transport. Unix socket only. The plan explicitly defers TCP to v1.0.
- Daemon auto-spawn. The CLI prints a hint and exits 2.
- Parallel runs on >1 iOS sim. v0.2 candidate.
- A `maestroq daemon install` command that writes launchd/systemd units. Documented in `docs/launchd.md` as user setup; revisit in v0.2.
- Persisting the build cache across restarts. In-memory is enough for v0.1.

If a user asks for one of these and it's genuinely needed, raise it and update the plan before implementing.

---

## When you hit something weird

1. Check `~/.maestroq/queue.json` — that's the source of truth for job state.
2. Check `~/.local/share/maestroq/logs/<job-id>.log` — every external child's output lands there.
3. Check the daemon's own log (wherever you redirected `maestroq daemon start` to). pino emits JSON; pipe through `pino-pretty` if you have it.
4. `pgrep -fl maestro` / `pgrep -fl xcodebuild` — leftover children are the most likely cause of "the next run fails inexplicably". The daemon does *not* yet pkill orphaned xctest-runners on teardown (see "iOS port 7001 staleness" above).

---

## Memory files

The user keeps long-lived facts at `~/.claude/projects/-Users-vencel-gitRepos--home-maestroq/memory/`. Today:

- `feedback-maestro-debug-log-race.md` — the parallel-maestro race + how we mitigate
- `feedback-maestro-ios-sim-reboot.md` — iOS port 7001 staleness, `rebootSimBefore` is the lever

If you discover another upstream sharp edge or a non-obvious convention, save it as a memory rather than relying on AGENTS.md alone — memories persist across conversations and survive AGENTS.md rewrites.
