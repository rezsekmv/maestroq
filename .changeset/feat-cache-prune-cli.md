---
"@maestroq/core": minor
"@maestroq/daemon": minor
"maestroq": minor
---

feat(cli): `maestroq cache` subcommand for inspecting and pruning the persisted build cache. Adds two RPC ops (`cache-list`, `cache-prune`) and two CLI verbs:

- `maestroq cache list [--json]` — print every entry in `~/.maestroq/build-cache.json` (one line per `<head> <platform> <variant> <device> <cwd>`).
- `maestroq cache prune [--all] [--cwd <path>] [--head <sha>] [--platform ios|android] [--variant debug|release] [--device <udid>] [--dry-run]` — remove entries matching ALL filters. An empty filter without `--all` is a safety no-op so users can't wipe the cache by typo. `--dry-run` reports matches without touching the cache.

Closes the previously-missing "how do I purge stale cache entries" workflow; before this PR users had to stop the daemon, edit `~/.maestroq/build-cache.json` by hand (or `rm` it entirely), and restart.
