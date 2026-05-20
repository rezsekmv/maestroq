---
"@maestroq/daemon": patch
---

fix(daemon): don't crash the daemon when the Android emulator process exits non-zero (e.g. wrong AVD name). The detached `emulator` child's rejected execa promise was unhandled, which Node 25's default policy turns into a fatal `unhandledRejection`. Now swallowed with a `.catch(() => {})` and surfaced as a clean job failure via a newly time-bounded `adb wait-for-device` (uses the same `bootstatus_timeout_ms` config knob, default 60s).
