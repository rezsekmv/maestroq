---
"@maestroq/core": minor
"@maestroq/daemon": minor
"maestroq": minor
---

Daemon now partitions logs by day, auto-archives terminal jobs older than queue_retention_days (default 14d) on startup, and persists the build cache across restarts.
