---
"@maestroq/daemon": patch
---

fix(daemon): place `--platform`/`--device`/`--output` before the `test` subcommand when invoking `maestro-runner`. They are global options in `maestro-runner` >=1.1.x; putting them after `test` makes the binary exit with `flag provided but not defined: -device` and the job fails before any flow runs.
