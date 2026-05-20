---
"maestroq": patch
---

fix(cli): `maestroq status` now always includes currently-active jobs (queued / building / installing / metro-starting / running / tearing-down) regardless of `--since` and `--limit`. Previously a long-running job (e.g. a 35-minute build) silently vanished from the default 1h-since view once its `createdAt` aged out of the window. Single-job lookups (`maestroq status <id>`) also no longer filter — the user explicitly asked for that id.
