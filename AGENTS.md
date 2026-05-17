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
examples/         spec YAMLs for a vanilla RN/Expo project
docs/             architecture / ai-agents / launchd
.github/workflows ci.yml + release.yml
```

Monorepo via **npm workspaces**. ESM (`"type": "module"`), Node 24+, TypeScript strict with `noUncheckedIndexedAccess` on.

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

### Runners

Two test engines are supported, selected by `defaults.runner` in `~/.maestroq/config.yaml`:

- **`maestro-runner`** (default) — [`devicelab-dev/maestro-runner`](https://github.com/devicelab-dev/maestro-runner). Single Go binary, per-UDID dynamic WDA ports (8100–9099, computed in their `pkg/driver/wda/runner.go`), Appium-vendored WebDriverAgent. Supports parallel iOS *and* parallel Android out of the box.
- **`maestro`** — the original [Maestro CLI](https://github.com/mobile-dev-inc/Maestro). JVM-based. Hardcodes the iOS driver host port 7001 → iOS is capped at one concurrent job; subject to the upstream DebugLogStore.finalizeRun race → needs the 30 s finalize watchdog in `lifecycle/maestro.ts`.

`lifecycle/maestro.ts` branches on the runner: maestro-runner gets `--device`/`--platform`/`--output` and skips the watchdog; maestro keeps the legacy `--udid`/`--debug-output` invocation + watchdog. The dispatcher's `max_concurrent_ios` cap is bypassed under `maestro-runner` and honored under `maestro`. `lifecycle/teardown.ts` only runs the iOS pkill sweep under `maestro` (the leftover xctest-runner process names are Maestro CLI-specific).

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

*Under `runner: maestro` only.* `maestro-runner` has no JVM and a different artifact layout, so this race does not exist there.

Two `maestro test` invocations starting in the same second share `~/Library/Logs/maestro/<YYYY-MM-DD_HHMMSS>/`. The first to finish deletes the dir; the second one's `DebugLogStore.finalizeRun` throws `NoSuchFileException` from `FileUtils.zipDir` and the JVM hangs forever (non-daemon thread holds it open).

Observed twice on maestro 2.5.1, both during parallel iOS + Android runs against a real RN/Expo project.

**Mitigation** (already in `lifecycle/maestro.ts`): we scan stdout for `\b(\d+)/(\d+) Flows (Passed|Failed)\b`. When that sentinel lands, we start a 30 s finalize watchdog. If the child hasn't exited by then, we SIGKILL its pgid and resolve the run using the captured Passed/Failed outcome. `MaestroResult.killedAfterFinalize` reports this happened.

`--debug-output` does *not* fix the upstream bug (it controls a different artifact dir). Don't waste time on it.

If maestro upstream fixes this, the watchdog can become a no-op or be removed.

### iOS port 7001 staleness

*Under `runner: maestro` only.* `maestro-runner` uses Appium's WebDriverAgent vendored in-tree and per-UDID dynamic ports — it doesn't spawn `maestro-driver-iosUITests-Runner` or `xcodebuild test-without-building`, so this staleness pattern doesn't apply. `teardown.ts` skips the iOS pkill sweep under `maestro-runner`.

After a `maestro test` run on iOS, the `maestro-driver-iosUITests-Runner` and `xcodebuild test-without-building` helpers can linger past the parent CLI exit. They hold port 7001 stale. The next iOS run dies during install with `Failed to connect to /127.0.0.1:7001`.

**Mitigation 1 (default):** `teardownJob` calls `cleanupIosLeftovers(udid, ...)` in `lifecycle/cleanup-ios.ts`, which `pkill -f`s the two leftover patterns scoped to the just-used UDID. Cheap, runs on every iOS job including the cancel path.

**Mitigation 2 (fallback):** `JobSpec.rebootSimBefore: true` runs `simctl shutdown` + `bootstatus` (see `lifecycle/boot.ts`). Expensive (~30 s) — keep as a knob for projects where the pkill isn't catching something, but it should no longer be the default.

### Parallel iOS is capped at one (under `runner: maestro`)

*Bypassed under the default `runner: maestro-runner` — the dispatcher's `tick()` treats `iosCap` as `Infinity` in that case.*

Upstream `maestro test` hardcodes the host driver port (7001) and the WDA port — two iOS sims on the same Mac will collide regardless of which UDIDs are configured. Under `runner: maestro`, the dispatcher honors `config.defaults.max_concurrent_ios` (default `1`) by counting busy iOS workers in `tick()` and skipping idle iOS workers when the cap is reached (`dispatcher.ts`). Android stays fully parallel. Under `runner: maestro-runner`, every configured iOS worker dispatches; `max_concurrent_ios` is ignored (a startup log line notes this when the user has set a non-default value).

### Cancel must escalate

Hung JVMs ignore SIGTERM. `worker.ts:cancel` sends SIGTERM, then schedules a 5 s SIGKILL fallback (gated by `process.kill(-pgid, 0)` to avoid killing a reused pid). Don't remove the escalation.

---

## Conventions

### Project layout (`.maestro/`)

Per-project specs and per-project config live under `.maestro/` at the project root, next to the project's existing Maestro flow files. The CLI walks up from the spec path to find an optional `.maestro/maestroq.yaml` and merges its `defaults:` block into the spec before submission (spec fields always win). A bare `maestroq run smoke-ios` resolves to `.maestro/smoke-ios.yaml` walking up from cwd.

`init.ts:writeStarterSpecs` scaffolds into `.maestro/`, and `examples/plain-rn/` demonstrates the convention. Anywhere docs mention spec paths, write `.maestro/<name>.yaml`, not `maestroq/<name>.yaml` — the latter is deprecated.

### Commits

- **Conventional Commits.** Subject: `<type>: <imperative summary>` (or `<type>(<scope>): …`). Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `build`, `ci`, `perf`. Bump level still comes from the `.changeset/*.md` file — the prefix is for readability, not versioning.
- **Keep it short.** Subject ≤ 60 chars. Body only when the *why* isn't obvious from the diff. No multi-paragraph rationale — that belongs in the changeset or PR description.
- **Never sign commits with a `Co-Authored-By: Claude …` line** (per `/Users/vencel/.claude/CLAUDE.md`). The user's git config identity is the only author.
- For larger changes, the global rule says to run `coderabbit review --plain`. The user's call when to do that — don't volunteer.

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

# 5. Submit specs from a real worktree.
cd ~/path/to/your-rn-app
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

## Releasing (Changesets)

This repo uses [Changesets](https://github.com/changesets/changesets) to manage versions and publish to npm. **Every user-facing change ships with a changeset file.**

### Adding a changeset to your PR

If your change affects any published package (`@maestroq/core`, `@maestroq/daemon`, or `maestroq`), run:

```bash
npx changeset
```

It asks which packages changed, picks a bump level (`patch` / `minor` / `major`), and prompts for a one-line description that ends up in the changelog. The result is a `.changeset/<random-name>.md` file. **Commit it with the code change in the same PR.**

If your change is internal only (tests, build config, docs, this file) — skip the changeset. The release workflow tolerates PRs without one.

### What happens after merge

The `.github/workflows/release.yml` workflow watches `main`:

1. **If pending changesets exist**, it opens (or updates) a "chore: version packages" PR that:
   - bumps the `version` field in every affected `package.json`,
   - regenerates `CHANGELOG.md` per package,
   - removes the consumed `.changeset/*.md` files.
2. **When the maintainer merges that PR**, the same workflow re-runs and this time runs `npx changeset publish` — which tags the commit, publishes each package to npm with `--provenance`, and creates a GitHub release.

You never tag or `npm publish` manually after v0.1.0.

### Configuration

`.changeset/config.json`:

- `fixed: [["@maestroq/core", "@maestroq/daemon", "maestroq"]]` — all three packages always bump to the same version. If you only touched core, daemon and cli still get the bump. This is deliberate: the three are co-versioned because the daemon/cli are tightly coupled.
- `access: "public"` — required for scoped packages on the npm free tier.
- `updateInternalDependencies: "patch"` — Changesets bumps the cross-package `"@maestroq/core": "^x.y.z"` entries automatically.

### When releasing breaks

- **"NPM_TOKEN not set"** — the secret is missing in repo settings. Generate a new automation token at npmjs.com → Access Tokens, set it as `NPM_TOKEN` under Settings → Secrets and variables → Actions.
- **"You cannot publish over the previously published versions"** — someone manually published the same version. Bump again and re-run.
- **The Version PR never opens** — there are no changesets in `.changeset/`. Did the merging PR include one?

### v0.1.0 is the seed

The very first release is published manually (see the README quick start of this repo's history) because there's nothing for Changesets to "bump" yet. From v0.1.1 onward, the flow above is the only path.

---

## When you hit something weird

1. Check `~/.maestroq/queue.json` — that's the source of truth for job state.
2. Check `~/.local/share/maestroq/logs/<job-id>.log` — every external child's output lands there.
3. Check the daemon's own log (wherever you redirected `maestroq daemon start` to). pino emits JSON; pipe through `pino-pretty` if you have it.
4. `pgrep -fl maestro` / `pgrep -fl xcodebuild` — leftover children are the most likely cause of "the next run fails inexplicably". The daemon does *not* yet pkill orphaned xctest-runners on teardown (see "iOS port 7001 staleness" above).

---

## Memory files

The user keeps long-lived facts at `~/.claude/projects/-Users-vencel-gitRepos--home-maestroq/memory/`. Check that directory for the current set — the index lives in `MEMORY.md` next to the entries. Topics covered so far include upstream maestro sharp edges, commit-message preferences, and OSS hygiene rules.

If you discover another upstream sharp edge or a non-obvious convention, save it as a memory rather than relying on AGENTS.md alone — memories persist across conversations and survive AGENTS.md rewrites.
