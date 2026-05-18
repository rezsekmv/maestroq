---
"@maestroq/core": patch
"@maestroq/daemon": patch
"maestroq": patch
---

Daemon: singleton lock prevents queue.json corruption; CLI no longer hangs on RPC errors; cancel on terminal jobs is now a no-op; simctl bootstatus has a 60s timeout; daemon stop waits for socket cleanup.
