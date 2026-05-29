---
"@maestroq/daemon": minor
"maestroq": minor
---

feat: iOS `headless: true` now quits a running `Simulator.app` before booting. Previously the flag was declarative and a user- or previous-run-launched Simulator window contended with the headless run. `bootDevice` now `pgrep`s for Simulator and, if present, quits it (`osascript` quit, falling back to `killall`) before `simctl bootstatus`. Non-headless runs are untouched.
