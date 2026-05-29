---
"@maestroq/core": patch
"@maestroq/daemon": patch
"maestroq": patch
---

fix: give each job its own `METRO_CACHE_ROOT` so parallel iOS + Android builds no longer race on Metro's shared FileStore cache (`ENOTEMPTY` from `clear()`). Builds key the cache root by device udid, the shared bundler by metro port; a caller-supplied `METRO_CACHE_ROOT` (env or `spec.env`) still wins.
