# maestroq

## 0.2.0

### Minor Changes

- b2c1bf6: Switch default runner to `maestro-runner` (community Go fork, https://github.com/devicelab-dev/maestro-runner) so multi-device-per-platform parallelism — including parallel iOS sims — works out of the box. New `defaults.runner` config field selects between `maestro-runner` (default) and `maestro` (legacy JVM CLI). Under `maestro-runner` the iOS cap (`max_concurrent_ios`) is ignored, the JVM finalize watchdog is not armed, and the iOS pkill sweep on teardown is skipped — none of those upstream sharp edges apply to the new engine. `runner: maestro` keeps the existing behavior unchanged.
- 1dd7e77: Cap iOS concurrency to one active job at a time (new `defaults.max_concurrent_ios` config, default `1`), kill lingering `maestro-driver-iosUITests-Runner` and `xcodebuild` helpers on teardown to stop the next iOS run from failing on stale port 7001, and adopt `.maestro/` as the convention for per-project specs and an optional `.maestro/maestroq.yaml` config file merged into every spec at submission time.

### Patch Changes

- Updated dependencies [b2c1bf6]
- Updated dependencies [1dd7e77]
  - @maestroq/core@0.2.0
  - @maestroq/daemon@0.2.0
