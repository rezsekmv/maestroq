---
"@maestroq/core": minor
"@maestroq/daemon": minor
"maestroq": minor
---

feat: distinguish `error` (setup / infrastructure problem) from `failed` (tests ran and failed), and surface the device label + flow counts in `maestroq status`.

- New `error` JobStatus, distinct from `failed`. The worker now writes `error` when a step before the test verdict throws (boot failure, build failure, install failure, daemon-crash recovery) and reserves `failed` for "maestro ran to completion but one or more flows failed."
- `flowsTotal` and `flowsFailed` parsed from the TOTAL line of the maestro / maestro-runner output and persisted on the job record.
- Status response is enriched with `deviceLabel` (looked up from `~/.maestroq/config.yaml`) at response time — not persisted, so labels stay current with the config.
- `maestroq status -l` now includes a `DEVICE` column (label, falling back to UDID) and renders `failed 1/30` when flow counts are present. Bare `failed` renders if counts are absent. `error` renders in magenta to distinguish from the red `failed`.
