---
"@maestroq/core": minor
"@maestroq/daemon": minor
"maestroq": minor
---

feat: per-job device pinning. `JobSpec` now accepts an optional `deviceUdid` and the CLI exposes `--device <udid>` on both `submit` and `run`. When set, the dispatcher will only assign the job to the worker whose `device.udid` matches; unpinned jobs continue to flow to any worker of the right platform. Lets you route around a known-broken worker (e.g. a flaky physical device, an emulator with a dead PackageManager) without restarting the daemon or editing config.
