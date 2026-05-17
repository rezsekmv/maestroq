---
"@maestroq/core": minor
"@maestroq/daemon": minor
"maestroq": minor
---

Switch default runner to `maestro-runner` (community Go fork, https://github.com/devicelab-dev/maestro-runner) so multi-device-per-platform parallelism — including parallel iOS sims — works out of the box. New `defaults.runner` config field selects between `maestro-runner` (default) and `maestro` (legacy JVM CLI). Under `maestro-runner` the iOS cap (`max_concurrent_ios`) is ignored, the JVM finalize watchdog is not armed, and the iOS pkill sweep on teardown is skipped — none of those upstream sharp edges apply to the new engine. `runner: maestro` keeps the existing behavior unchanged.
