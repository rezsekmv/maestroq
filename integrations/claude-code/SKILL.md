---
name: maestroq
description: Submit Maestro UI test jobs (e2e / regression / smoke) through the local maestroq daemon instead of calling `maestro` directly. Use when running flows from `.maestro/` in a React Native / Expo project, or when the project has a `maestroq/*.yaml` spec, or when multiple parallel worktrees/agents share one simulator/emulator. Also use when the user asks to "run maestro", "run e2e", "run smoke tests", "run regression", or asks about the maestroq daemon / queue.
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

1. `<cwd>/maestroq/*.yaml` — preferred location. If specs exist, list them and pick the one matching the user's request (smoke / regression / dev-client / etc.).
2. `<cwd>/.maestro/` — flow files exist but no spec. **Offer to write one.** A minimal spec:

   ```yaml
   platform: ios            # or android
   flows:
     - .maestro/smoke.yaml  # one or more files, or a directory of flows
   build: skip              # or { variant: release, cache: true }
   label: "smoke iOS"
   ```

   Save it to `<cwd>/maestroq/<name>-<platform>.yaml`.

If the user has two platforms (iOS + Android), prefer writing two specs and running them in parallel; the daemon will dispatch each to its own device worker.

### darts26-specific notes

darts26 already ships specs at `maestroq/smoke-{ios,android}.yaml`. Use them as-is. For regression (the full suite), build a spec referencing every flow dir under `.maestro/e2e/`:

```yaml
platform: ios
flows:
  - .maestro/e2e/setup
  - .maestro/e2e/x01
  - .maestro/e2e/cricket
  - .maestro/e2e/progressive
  - .maestro/e2e/result
  - .maestro/e2e/players
  - .maestro/e2e/statistics
  - .maestro/e2e/settings
  - .maestro/e2e/celebrations
build:
  variant: release
  cache: true
rebootSimBefore: true       # mitigates iOS port-7001 staleness between runs
label: "darts26 regression iOS"
```

The same shape with `platform: android` for the Android side (omit `rebootSimBefore`).

## 3. Submit the job

Two modes — pick based on what the user asked for:

**Synchronous (default — they want a green/red verdict now):**

```bash
maestroq run maestroq/<spec>.yaml
```

`maestroq run` blocks, streams logs, and **exits with the underlying Maestro exit code**. Use this when the user wants results before continuing. The agent should branch on `$?`.

**Async / fire-and-forget (they'll come back later, or you have other work to do):**

```bash
JOB=$(maestroq submit maestroq/<spec>.yaml)
echo "submitted $JOB"
# … other work …
maestroq logs "$JOB" -f   # blocks until terminal, exits with job code
```

### Running both platforms in parallel

```bash
maestroq run maestroq/smoke-ios.yaml & \
maestroq run maestroq/smoke-android.yaml & \
wait
```

Each `maestroq run` claims one device. The daemon dispatches them concurrently. If two jobs target the same platform from different worktrees, the second one queues and starts when the first finishes.

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

- **iOS "Failed to connect to /127.0.0.1:7001"** during install → leftover xctest-runners from a previous Maestro session. Add `rebootSimBefore: true` to the spec. If specs in `maestroq/` lack it for iOS, suggest adding it.
- **Job stuck in `running` long after `N/N Flows Passed` shows in the log** → the in-build daemon already handles this via a 30s finalize watchdog (SIGKILLs the JVM). If you see this without resolution, file an issue.

## 6. When something is wrong

- **Daemon not running**: see step 1.
- **No devices configured**: `maestroq devices` is empty → user must edit `~/.maestroq/config.yaml`. Boot a sim/emulator first, then:
  - `xcrun simctl list devices booted` (iOS UDID)
  - `adb devices` (Android UDID, usually `emulator-5554`)
- **Wrong UDID after sim swap**: edit `~/.maestroq/config.yaml`, run `maestroq daemon stop && maestroq daemon start &` to reload.

## Don't do

- Don't call `maestro test` directly — bypasses the queue and races other agents.
- Don't run `npm run test:e2e:*` from darts26's `package.json` — those scripts predate `maestroq` and use the old `/tmp/darts26-maestro-*-udid` lockfile pattern.
- Don't auto-start the daemon — `maestroq` deliberately requires the user to start it (so they own its lifetime).
