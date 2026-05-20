---
"@maestroq/core": patch
"@maestroq/daemon": patch
"maestroq": patch
---

CLI polish: `maestroq prune` now prompts for confirmation (skip with `-y` / `--yes`) and `--older-than` defaults to `0s` instead of being required. Added `-c` short alias for `--color` on `devices` and `status`. Updated top-level CLI description.
