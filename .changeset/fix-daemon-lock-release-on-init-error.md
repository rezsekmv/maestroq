---
"@maestroq/daemon": patch
---

fix(daemon): release the singleton lock if any post-`lock()` initialization step throws, so the next `daemon start` isn't blocked by a stale lock.
