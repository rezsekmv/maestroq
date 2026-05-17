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
- If `maestroq` is not on PATH at all, tell the user `npm i -g maestroq` (or, for local dev, `npm link -w packages/cli` from the `maestroq` repo). The default test engine is `maestro-runner` — install it from [devicelab-dev/maestro-runner](https://github.com/devicelab-dev/maestro-runner) (or set `defaults.runner: maestro` in `~/.maestroq/config.yaml` to fall back to the original Maestro CLI).

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

If the user has two platforms (iOS + Android), prefer writing two specs and running them in parallel; the daemon will dispatch each to its own device worker.

### Per-project defaults (optional)

If `.maestro/maestroq.yaml` exists, the CLI walks up from the spec to find it and merges its `defaults:` block into every job submitted from that project — spec fields always win. Good place to set `cwd`, default `rebootSimBefore`, default `build`, etc. so individual specs stay short.

```yaml
# .maestro/maestroq.yaml
defaults:
  rebootSimBefore: false   # default — pkill on teardown handles most port-7001 staleness
  build: { variant: release, cache: true }
```

### Regression / full-suite specs

Reference every flow dir under `.maestro/`:

```yaml
platform: ios
flows:
  - .maestro/e2e/setup
  - .maestro/e2e/feature-a
  - .maestro/e2e/feature-b
  # …
build:
  variant: release
  cache: true
label: "regression iOS"
```

Same shape with `platform: android` for the Android side.

## 3. Submit the job

Two modes — pick based on what the user asked for:

**Synchronous (default — they want a green/red verdict now):**

```bash
maestroq run .maestro/smoke-ios.yaml   # or shorthand: maestroq run smoke-ios
```

`maestroq run` blocks, streams logs, and **exits with the underlying Maestro exit code**. Use this when the user wants results before continuing. The agent should branch on `$?`.

`maestroq run <bare-name>` (no slash, no `.yaml`) resolves to `.maestro/<bare-name>.yaml` walking up from cwd — handy when you don't want to type the path.

**Async / fire-and-forget (they'll come back later, or you have other work to do):**

```bash
JOB=$(maestroq submit .maestro/smoke-ios.yaml)
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

Each `maestroq run` claims one device. The daemon dispatches them concurrently. If two jobs target the same platform from different worktrees, the second one queues and starts when the first finishes (unless multiple devices of that platform are configured — see below).

By default maestroq uses the [`maestro-runner`](https://github.com/devicelab-dev/maestro-runner) engine, which supports parallel iOS *and* parallel Android — submit as many iOS specs as you have configured sims. If `defaults.runner: maestro` is set in `~/.maestroq/config.yaml` (the legacy [Maestro CLI](https://github.com/mobile-dev-inc/Maestro)), iOS is capped at one concurrent job because upstream `maestro test` hardcodes the iOS driver host port; extra iOS jobs queue.

### Multiple iOS devices in parallel

Configure N iOS sims in `~/.maestroq/config.yaml`. Under the default `runner: maestro-runner`, submit two iOS specs and both will reach `running` simultaneously. Under `runner: maestro`, only one runs at a time regardless of how many sims you list — extra iOS jobs queue until the first finishes.

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

- *Under `runner: maestro` only —* **iOS "Failed to connect to /127.0.0.1:7001"** during install → leftover xctest-runners from a previous Maestro session. The daemon `pkill`s these on teardown (scoped to the UDID), so this should be rare. If it still happens, fall back to `rebootSimBefore: true` on the spec — the older, more expensive (~30 s) mitigation. `maestro-runner` is unaffected (different driver architecture).
- *Under `runner: maestro` only —* **Job stuck in `running` long after `N/N Flows Passed` shows in the log** → the daemon handles this via a 30 s finalize watchdog (SIGKILLs the JVM). If you see this without resolution, file an issue. `maestro-runner` has no JVM and no such race.
- *Under `runner: maestro` only —* **Two iOS jobs submitted but only one running** → expected, upstream maestro can't parallel-iOS. Switch to `runner: maestro-runner` (the default) if you need parallel iOS.

## 6. When something is wrong

- **Daemon not running**: see step 1.
- **No devices configured**: `maestroq devices` is empty → user must edit `~/.maestroq/config.yaml`. Boot a sim/emulator first, then:
  - `xcrun simctl list devices booted` (iOS UDID)
  - `adb devices` (Android UDID, usually `emulator-5554`)
- **Wrong UDID after sim swap**: edit `~/.maestroq/config.yaml`, run `maestroq daemon stop && maestroq daemon start &` to reload.

## Don't do

- Don't call `maestro test` or `maestro-runner test` directly — bypasses the queue and races other agents.
- Don't run project-local `npm run test:e2e:*` scripts that predate `maestroq` and use ad-hoc lockfiles — submit through `maestroq` instead.
- Don't auto-start the daemon — `maestroq` deliberately requires the user to start it (so they own its lifetime).
