---
"@maestroq/core": minor
"@maestroq/daemon": minor
"maestroq": minor
---

Cap iOS concurrency to one active job at a time (new `defaults.max_concurrent_ios` config, default `1`), kill lingering `maestro-driver-iosUITests-Runner` and `xcodebuild` helpers on teardown to stop the next iOS run from failing on stale port 7001, and adopt `.maestro/` as the convention for per-project specs and an optional `.maestro/maestroq.yaml` config file merged into every spec at submission time.
