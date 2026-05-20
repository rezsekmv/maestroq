---
"@maestroq/core": minor
"@maestroq/daemon": minor
"maestroq": minor
---

feat: failure-aware dispatch with worker quarantine. After 3 consecutive `error` outcomes (boot / build / install / daemon-crash recovery — *not* test-level `failed`), a worker is quarantined and the dispatcher routes around it. Backoff escalates per episode: 30 s → 5 m → 30 m → 1 h. The `quarantinedUntil` epoch-ms is surfaced in the `devices` RPC response; `maestroq devices` now shows `quarantined (Nm)` in magenta. Any non-error terminal (`succeeded`, `failed`, `cancelled`) clears the active streak and lifts quarantine immediately, but the escalation level is retained for the daemon's lifetime — a worker that flakes, recovers for one job, then flakes again jumps to the next backoff tier instead of resetting to 30 s.
