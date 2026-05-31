---
"@maestroq/core": minor
"@maestroq/daemon": minor
"maestroq": minor
---

feat: `maestroq daemon start` backgrounds itself by default. It forks a detached `--foreground` child, redirects output to `~/.maestroq/daemon.log`, and returns once the daemon is listening — so `maestroq daemon start && maestroq submit …` is a one-shot (no `&`/`nohup`/`disown`). Pass `--foreground` / `-f` to keep the blocking behavior for launchd/systemd wrappers or debugging.
