# @maestroq/daemon

## 0.4.1

### Patch Changes

- 4db0f8a: fix: headless Android now defaults to `-gpu swiftshader_indirect` instead of `-gpu host`. On Apple Silicon, `-gpu host` makes the emulator translate GL→Metal, and a GPU-heavy RN app's first-frame render starves SystemUI's render thread, producing a reproducible "System UI isn't responding" ANR that overlays the app and swallows every tap (the entire Maestro suite fails on the first interaction). Verified against darts26: `-gpu host` → 36/36 fail, `-gpu swiftshader_indirect` → 36/36 pass. `gpu: host` remains an opt-in for hosts with a real GL stack (x86 Linux). The now-unneeded host→swiftshader boot fallback and fast-exit guard are removed.
- Updated dependencies [4db0f8a]
  - @maestroq/core@0.4.1

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

## 0.3.0

### Minor Changes

- a037279: New CLI commands: maestroq prune. New flags: logs --tail, run --no-stream. Devices output now shows device labels. Error messages are cleaner.
- 0a57f96: feat(daemon): probe Android PackageManager during `bootDevice`. A booted-but-broken emulator (system_server stuck, PM service dead) can still pass `adb get-state`, but `adb shell pm list packages` returns `cmd: Can't find service: package`. Without this probe the worker happily drives a 20+ min release build before the failure surfaces at `adb install`. The probe runs a 4 s `pm list packages android` check on both the already-running and freshly-spawned emulator paths; if PM is unhealthy, the job fails fast with a clear "reboot the emulator/device" message.
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

- 262573f: feat(daemon): add optional `expoDeviceName` field per device config so `expo run:{ios,android} --device <…>` can use a different identifier than the `udid` maestroq uses for adb / simctl. Required for physical Android phones (whose adb serial like `d90586bb` is rejected by Expo, which wants the model name like `CPH2307`) and physical iPhones (where Expo wants the device name, not the ECID). Falls back to the previous behavior — `avdName ?? udid` for Android, `udid` for iOS — when `expoDeviceName` is unset, so existing configs are unchanged.
- 17fafc0: feat(daemon): support physical iOS devices in `bootDevice`. Previously every iOS UDID went through `xcrun simctl bootstatus`, which only knows simulators — physical iPhones/iPads failed instantly with `Invalid device`. The boot path now probes `xcrun simctl list -j devices` to tell simulator vs. physical, and uses `xcrun devicectl list devices` to confirm a physical device is paired before handing off to `maestro-runner`'s WDA path. Note: physical-device configuration also requires (a) the **ECID** (e.g. `00008030-…`) as the device UDID, not the CoreDevice UUID, because that's what `xcodebuild` matches against, and (b) `MAESTRO_TEAM_ID` in the daemon's environment so the WDA can be code-signed.
- 90f71b6: feat: per-job device pinning. `JobSpec` now accepts an optional `deviceUdid` and the CLI exposes `--device <udid>` on both `submit` and `run`. When set, the dispatcher will only assign the job to the worker whose `device.udid` matches; unpinned jobs continue to flow to any worker of the right platform. Lets you route around a known-broken worker (e.g. a flaky physical device, an emulator with a dead PackageManager) without restarting the daemon or editing config.
- 03bae4c: feat: failure-aware dispatch with worker quarantine. After 3 consecutive `error` outcomes (boot / build / install / daemon-crash recovery — _not_ test-level `failed`), a worker is quarantined and the dispatcher routes around it. Backoff escalates per episode: 30 s → 5 m → 30 m → 1 h. The `quarantinedUntil` epoch-ms is surfaced in the `devices` RPC response; `maestroq devices` now shows `quarantined (Nm)` in magenta. Any non-error terminal (`succeeded`, `failed`, `cancelled`) clears the active streak and lifts quarantine immediately, but the escalation level is retained for the daemon's lifetime — a worker that flakes, recovers for one job, then flakes again jumps to the next backoff tier instead of resetting to 30 s.
- 16a62cf: Daemon now partitions logs by day, auto-archives terminal jobs older than queue_retention_days (default 14d) on startup, and persists the build cache across restarts.

### Patch Changes

- 1a3c0a1: CLI polish: `maestroq prune` now prompts for confirmation (skip with `-y` / `--yes`) and `--older-than` defaults to `0s` instead of being required. Added `-c` short alias for `--color` on `devices` and `status`. Updated top-level CLI description.
- 2087db4: Daemon: singleton lock prevents queue.json corruption; CLI no longer hangs on RPC errors; cancel on terminal jobs is now a no-op; simctl bootstatus has a 60s timeout; daemon stop waits for socket cleanup.
- 7c7ecc9: fix(daemon): don't crash the daemon when the Android emulator process exits non-zero (e.g. wrong AVD name). The detached `emulator` child's rejected execa promise was unhandled, which Node 25's default policy turns into a fatal `unhandledRejection`. Now swallowed with a `.catch(() => {})` and surfaced as a clean job failure via a newly time-bounded `adb wait-for-device` (uses the same `bootstatus_timeout_ms` config knob, default 60s).
- bbaf79e: fix(daemon): release the singleton lock if any post-`lock()` initialization step throws, so the next `daemon start` isn't blocked by a stale lock.
- 4e11f04: fix(daemon): place `--platform`/`--device`/`--output` before the `test` subcommand when invoking `maestro-runner`. They are global options in `maestro-runner` >=1.1.x; putting them after `test` makes the binary exit with `flag provided but not defined: -device` and the job fails before any flow runs.
- d52f1d2: New config defaults expose cancel grace, metro readiness, and Maestro finalize timeouts. RPC response payloads now validated end-to-end.
- Updated dependencies [1a3c0a1]
- Updated dependencies [a037279]
- Updated dependencies [2087db4]
- Updated dependencies [62dd8a4]
- Updated dependencies [0f8f19b]
- Updated dependencies [ce5023d]
- Updated dependencies [262573f]
- Updated dependencies [90f71b6]
- Updated dependencies [03bae4c]
- Updated dependencies [16a62cf]
- Updated dependencies [d52f1d2]
  - @maestroq/core@0.3.0

## 0.2.0

### Minor Changes

- b2c1bf6: Switch default runner to `maestro-runner` (community Go fork, https://github.com/devicelab-dev/maestro-runner) so multi-device-per-platform parallelism — including parallel iOS sims — works out of the box. New `defaults.runner` config field selects between `maestro-runner` (default) and `maestro` (legacy JVM CLI). Under `maestro-runner` the iOS cap (`max_concurrent_ios`) is ignored, the JVM finalize watchdog is not armed, and the iOS pkill sweep on teardown is skipped — none of those upstream sharp edges apply to the new engine. `runner: maestro` keeps the existing behavior unchanged.
- 1dd7e77: Cap iOS concurrency to one active job at a time (new `defaults.max_concurrent_ios` config, default `1`), kill lingering `maestro-driver-iosUITests-Runner` and `xcodebuild` helpers on teardown to stop the next iOS run from failing on stale port 7001, and adopt `.maestro/` as the convention for per-project specs and an optional `.maestro/maestroq.yaml` config file merged into every spec at submission time.

### Patch Changes

- Updated dependencies [b2c1bf6]
- Updated dependencies [1dd7e77]
  - @maestroq/core@0.2.0
