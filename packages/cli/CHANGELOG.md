# maestroq

## 0.4.0

### Minor Changes

- 311b9bc: feat: headless Android cold-boots now pass `-gpu host` explicitly (with a one-time automatic fallback to `-gpu swiftshader_indirect` if the host-GPU boot fails). `-no-window` otherwise makes the emulator silently use software rendering regardless of the AVD's `hw.gpu.mode`, which starves GPU-heavy RN/Flutter apps and makes Maestro's first `tapOn` time out. A new per-device `gpu: host | swiftshader_indirect | auto` config field pins the mode and disables the fallback.
- f66405f: feat: `maestroq daemon start` backgrounds itself by default. It forks a detached `--foreground` child, redirects output to `~/.maestroq/daemon.log`, and returns once the daemon is listening — so `maestroq daemon start && maestroq submit …` is a one-shot (no `&`/`nohup`/`disown`). Pass `--foreground` / `-f` to keep the blocking behavior for launchd/systemd wrappers or debugging.

### Patch Changes

- ae1942d: fix: give each job its own `METRO_CACHE_ROOT` so parallel iOS + Android builds no longer race on Metro's shared FileStore cache (`ENOTEMPTY` from `clear()`). Builds key the cache root by device udid, the shared bundler by metro port; a caller-supplied `METRO_CACHE_ROOT` (env or `spec.env`) still wins.
- Updated dependencies [311b9bc]
- Updated dependencies [f66405f]
- Updated dependencies [ae1942d]
  - @maestroq/core@0.4.0
  - @maestroq/daemon@0.4.0

## 0.3.0

### Minor Changes

- a037279: New CLI commands: maestroq prune. New flags: logs --tail, run --no-stream. Devices output now shows device labels. Error messages are cleaner.
- 62dd8a4: feat(cli): `maestroq cache` subcommand for inspecting and pruning the persisted build cache. Adds two RPC ops (`cache-list`, `cache-prune`) and two CLI verbs:

  - `maestroq cache list [--json]` — print every entry in `~/.maestroq/build-cache.json` (one line per `<head> <platform> <variant> <device> <cwd>`).
  - `maestroq cache prune [--all] [--cwd <path>] [--head <sha>] [--platform ios|android] [--variant debug|release] [--device <udid>] [--dry-run]` — remove entries matching ALL filters. An empty filter without `--all` is a safety no-op so users can't wipe the cache by typo. `--dry-run` reports matches without touching the cache.

  Closes the previously-missing "how do I purge stale cache entries" workflow; before this PR users had to stop the daemon, edit `~/.maestroq/build-cache.json` by hand (or `rm` it entirely), and restart.

- 0f8f19b: feat(daemon): per-device `headless` flag in `~/.maestroq/config.yaml`. On Android, the daemon appends `-no-window -no-audio -no-boot-anim` when it cold-boots `emulator -avd …` (no effect if the emulator is already running externally). On iOS the flag is declarative — `simctl boot` is already headless, but `Simulator.app` (if open) attaches a window to every booted sim and the daemon does not quit it for you; the dispatcher logs a one-shot warning pointing at `osascript -e 'quit app "Simulator"'`. Backwards compatible: the field defaults to `false`.
- ce5023d: feat: distinguish `error` (setup / infrastructure problem) from `failed` (tests ran and failed), and surface the device label + flow counts in `maestroq status`.

  - New `error` JobStatus, distinct from `failed`. The worker now writes `error` when a step before the test verdict throws (boot failure, build failure, install failure, daemon-crash recovery) and reserves `failed` for "maestro ran to completion but one or more flows failed."
  - `flowsTotal` and `flowsFailed` parsed from the TOTAL line of the maestro / maestro-runner output and persisted on the job record.
  - Status response is enriched with `deviceLabel` (looked up from `~/.maestroq/config.yaml`) at response time — not persisted, so labels stay current with the config.
  - `maestroq status -l` now includes a `DEVICE` column (label, falling back to UDID) and renders `failed 1/30` when flow counts are present. Bare `failed` renders if counts are absent. `error` renders in magenta to distinguish from the red `failed`.

- 90f71b6: feat: per-job device pinning. `JobSpec` now accepts an optional `deviceUdid` and the CLI exposes `--device <udid>` on both `submit` and `run`. When set, the dispatcher will only assign the job to the worker whose `device.udid` matches; unpinned jobs continue to flow to any worker of the right platform. Lets you route around a known-broken worker (e.g. a flaky physical device, an emulator with a dead PackageManager) without restarting the daemon or editing config.
- 03bae4c: feat: failure-aware dispatch with worker quarantine. After 3 consecutive `error` outcomes (boot / build / install / daemon-crash recovery — _not_ test-level `failed`), a worker is quarantined and the dispatcher routes around it. Backoff escalates per episode: 30 s → 5 m → 30 m → 1 h. The `quarantinedUntil` epoch-ms is surfaced in the `devices` RPC response; `maestroq devices` now shows `quarantined (Nm)` in magenta. Any non-error terminal (`succeeded`, `failed`, `cancelled`) clears the active streak and lifts quarantine immediately, but the escalation level is retained for the daemon's lifetime — a worker that flakes, recovers for one job, then flakes again jumps to the next backoff tier instead of resetting to 30 s.
- 16a62cf: Daemon now partitions logs by day, auto-archives terminal jobs older than queue_retention_days (default 14d) on startup, and persists the build cache across restarts.

### Patch Changes

- 1a3c0a1: CLI polish: `maestroq prune` now prompts for confirmation (skip with `-y` / `--yes`) and `--older-than` defaults to `0s` instead of being required. Added `-c` short alias for `--color` on `devices` and `status`. Updated top-level CLI description.
- 24463f8: `maestroq status` STATUS column now leads with the flow-count pair: `30/30 passed` on success, `1/30 failed` on failure — matching how `maestro` itself prints the summary.
- 2087db4: Daemon: singleton lock prevents queue.json corruption; CLI no longer hangs on RPC errors; cancel on terminal jobs is now a no-op; simctl bootstatus has a 60s timeout; daemon stop waits for socket cleanup.
- 5d36e0d: fix(cli): render the `DUR` column in `maestroq status` in human units instead of raw seconds. A 31-min job now reads `31m24s` instead of `1884.2s`; multi-hour runs show `Hh Mm`; multi-day shows `Dd Hh`. Sub-minute runs keep tenths-of-a-second precision (`7.3s`) so quick smoke flows don't lose detail.
- 41c5255: fix(cli): print the daemon's message and exit 1 when `cancel` is rejected, instead of crashing on an undefined payload
- 897a019: fix(cli): `maestroq status` now always includes currently-active jobs (queued / building / installing / metro-starting / running / tearing-down) regardless of `--since` and `--limit`. Previously a long-running job (e.g. a 35-minute build) silently vanished from the default 1h-since view once its `createdAt` aged out of the window. Single-job lookups (`maestroq status <id>`) also no longer filter — the user explicitly asked for that id.
- d52f1d2: New config defaults expose cancel grace, metro readiness, and Maestro finalize timeouts. RPC response payloads now validated end-to-end.
- Updated dependencies [1a3c0a1]
- Updated dependencies [a037279]
- Updated dependencies [2087db4]
- Updated dependencies [0a57f96]
- Updated dependencies [62dd8a4]
- Updated dependencies [0f8f19b]
- Updated dependencies [ce5023d]
- Updated dependencies [262573f]
- Updated dependencies [17fafc0]
- Updated dependencies [90f71b6]
- Updated dependencies [03bae4c]
- Updated dependencies [7c7ecc9]
- Updated dependencies [bbaf79e]
- Updated dependencies [4e11f04]
- Updated dependencies [16a62cf]
- Updated dependencies [d52f1d2]
  - @maestroq/core@0.3.0
  - @maestroq/daemon@0.3.0

## 0.2.0

### Minor Changes

- b2c1bf6: Switch default runner to `maestro-runner` (community Go fork, https://github.com/devicelab-dev/maestro-runner) so multi-device-per-platform parallelism — including parallel iOS sims — works out of the box. New `defaults.runner` config field selects between `maestro-runner` (default) and `maestro` (legacy JVM CLI). Under `maestro-runner` the iOS cap (`max_concurrent_ios`) is ignored, the JVM finalize watchdog is not armed, and the iOS pkill sweep on teardown is skipped — none of those upstream sharp edges apply to the new engine. `runner: maestro` keeps the existing behavior unchanged.
- 1dd7e77: Cap iOS concurrency to one active job at a time (new `defaults.max_concurrent_ios` config, default `1`), kill lingering `maestro-driver-iosUITests-Runner` and `xcodebuild` helpers on teardown to stop the next iOS run from failing on stale port 7001, and adopt `.maestro/` as the convention for per-project specs and an optional `.maestro/maestroq.yaml` config file merged into every spec at submission time.

### Patch Changes

- Updated dependencies [b2c1bf6]
- Updated dependencies [1dd7e77]
  - @maestroq/core@0.2.0
  - @maestroq/daemon@0.2.0
