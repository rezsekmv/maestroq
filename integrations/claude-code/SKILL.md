---
name: maestroq
description: Submit Maestro UI test jobs (e2e / regression / smoke) through the local maestroq daemon instead of calling `maestro` directly. Use when running flows from `.maestro/` in a React Native / Expo project, or when the project has a `.maestro/*.yaml` spec, or when multiple parallel worktrees/agents share one simulator/emulator. Also use when the user asks to "run maestro", "run e2e", "run smoke tests", "run regression", or asks about the maestroq daemon / queue.
allowed-tools: Read, Grep, Glob, Bash
---

Help the user submit Maestro flows through the **maestroq** daemon and CLI. The daemon owns a pool of simulators/emulators and serializes per-device jobs so multiple agents/worktrees on the same Mac don't race.

Never invoke `maestro test` directly. Always go through `maestroq`.

## 1. Pre-flight: is the daemon up?

```bash
maestroq daemon status
```

- Exit `0` + "running (pid N)" → continue to step 2.
- Exit `1`/`2` + "not running" or "daemon not running; run `maestroq daemon start`" → tell the user. Do **not** auto-start. Suggest:
  ```
  maestroq daemon start &     # foreground; logs go to stdout
  ```
  or point at `~/gitRepos/_home/maestroq/docs/launchd.md` for the persistent setup.
- If `maestroq` is not on PATH at all, tell the user `npm i -g maestroq` (or, for local dev, `npm link -w packages/cli` from the `maestroq` repo).

## 2. Pick / build a job spec

A job spec is a small YAML file. Look in this order:

1. `<cwd>/.maestro/*.yaml` (excluding `maestroq.yaml`) — preferred location. If specs exist, list them and pick the one matching the user's request (smoke / regression / dev-client / etc.).
2. `<cwd>/.maestro/` exists with flow files but no spec → **offer to write one.** A minimal spec:

   ```yaml
   platform: ios            # or android
   flows:
     - .maestro/smoke.yaml  # one or more files, or a directory of flows
   build: skip              # or { variant: release, cache: true }
   label: "smoke iOS"
   ```

   Save it to `<cwd>/.maestro/<name>-<platform>.yaml`.

3. Legacy `<cwd>/maestroq/*.yaml` — older projects. Encourage migrating to `.maestro/`, but specs there still work if the path is passed explicitly.

If the user has two platforms (iOS + Android), prefer writing two specs and running them in parallel; the daemon will dispatch each to its own device worker (subject to the iOS cap below).

### Per-project defaults (optional)

If `.maestro/maestroq.yaml` exists, the CLI walks up from the spec to find it and merges its `defaults:` block into every job submitted from that project — spec fields always win. Good place to set `cwd`, default `rebootSimBefore`, default `build`, etc. so individual specs stay short.

```yaml
# .maestro/maestroq.yaml
defaults:
  rebootSimBefore: false   # default — pkill on teardown handles most port-7001 staleness
  build: { variant: release, cache: true }
```

### Regression (full-suite) specs

When the user asks for a full regression run (every flow under `.maestro/`, not just the smoke set), build a spec that references each flow directory explicitly. Example shape:

```yaml
platform: ios
flows:
  - .maestro/e2e/setup
  - .maestro/e2e/<feature-a>
  - .maestro/e2e/<feature-b>
  # …one entry per flow directory the project ships
build:
  variant: release
  cache: true
label: "regression iOS"
```

The same shape with `platform: android` for the Android side.

## 3. Submit the job

Two modes — pick based on what the user asked for:

**Synchronous (default — they want a green/red verdict now):**

```bash
maestroq run .maestro/<spec>.yaml      # or shorthand: maestroq run <spec>
```

`maestroq run` blocks, streams logs, and **exits with the underlying Maestro exit code**. Use this when the user wants results before continuing. The agent should branch on `$?`.

`maestroq run <bare-name>` (no slash, no `.yaml`) resolves to `.maestro/<bare-name>.yaml` walking up from cwd — handy when you don't want to type the path.

**Async / fire-and-forget (they'll come back later, or you have other work to do):**

```bash
JOB=$(maestroq submit .maestro/<spec>.yaml)
echo "submitted $JOB"
# … other work …
maestroq logs "$JOB" -f   # blocks until terminal, exits with job code
```

### Running both platforms in parallel

```bash
maestroq run .maestro/smoke-ios.yaml & \
maestroq run .maestro/smoke-android.yaml & \
wait
```

Each `maestroq run` claims one device. The daemon dispatches them concurrently. If two jobs target the same platform from different worktrees, the second one queues and starts when the first finishes.

**iOS is capped at one concurrent job.** Upstream `maestro test` hardcodes the iOS driver host port, so two iOS sims can't run simultaneously. The dispatcher enforces this via `defaults.max_concurrent_ios` (default `1`) in `~/.maestroq/config.yaml` — extra iOS jobs queue instead of failing on port collisions. Android stays fully parallel.

## 4. Watching / inspecting

While jobs are in flight, useful commands:

```bash
maestroq status            # last 1h, max 10 most-recent, short view
maestroq status -H -l      # with column header + long view (WORKTREE, CREATED, STARTED, EXIT, LABEL)
maestroq status -w         # live re-render every 2s (Ctrl-C to exit). -w=5 for 5s.
maestroq status --all      # ignore the 1h / 10-job caps
maestroq status <jobId>    # one job
maestroq logs <jobId> -f   # follow a job's log
maestroq cancel <jobId>    # SIGTERM the worker's child group; escalates to SIGKILL after 5s
maestroq devices           # which devices are configured and which are busy
```

`--color=always|never|auto` (default auto) and `--json` are available on every command that has list output.

## 5. Interpreting results

- **Exit 0** → all flows passed.
- **Non-zero** → at least one flow failed. The per-job log at `~/.local/share/maestroq/logs/<jobId>.log` has the full Maestro stdout/stderr. Maestro artifacts (screenshots, videos) are at `~/.local/share/maestroq/artifacts/<jobId>/`.
- **`failed (reason: daemon-crash)`** → daemon was killed mid-run. Re-submit the job.
- **`cancelled` with exit 143** → cancellation propagated correctly (SIGTERM).

### Known sharp edges (already mitigated, but worth recognizing)

- **iOS "Failed to connect to /127.0.0.1:7001"** during install → leftover xctest-runners from a previous Maestro session. The daemon now `pkill`s these on teardown (scoped to the UDID), so this should be rare. If it still happens, fall back to `rebootSimBefore: true` on the spec — the older, more expensive (~30 s) mitigation.
- **Job stuck in `running` long after `N/N Flows Passed` shows in the log** → the daemon handles this via a 30 s finalize watchdog (SIGKILLs the JVM). If you see this without resolution, file an issue.
- **Two iOS jobs submitted but only one running** → expected. Upstream maestro can't parallel-iOS on one Mac; the cap serializes them.

## 6. When something is wrong

- **Daemon not running**: see step 1.
- **No devices configured**: `maestroq devices` is empty → user must edit `~/.maestroq/config.yaml`. Boot a sim/emulator first, then:
  - `xcrun simctl list devices booted` (iOS UDID)
  - `adb devices` (Android UDID, usually `emulator-5554`)
- **Wrong UDID after sim swap**: edit `~/.maestroq/config.yaml`, run `maestroq daemon stop && maestroq daemon start &` to reload.

## Don't do

- Don't call `maestro test` directly — bypasses the queue and races other agents.
- Don't run `npm run test:e2e:*` scripts from a project's `package.json` if those scripts call `maestro test` directly — they bypass the queue and race other agents. Convert them to call `maestroq run` instead.
- Don't auto-start the daemon — `maestroq` deliberately requires the user to start it (so they own its lifetime).
