---
"@maestroq/core": patch
"@maestroq/daemon": patch
"maestroq": patch
---

fix: headless Android now defaults to `-gpu swiftshader_indirect` instead of `-gpu host`. On Apple Silicon, `-gpu host` makes the emulator translate GL→Metal, and a GPU-heavy RN app's first-frame render starves SystemUI's render thread, producing a reproducible "System UI isn't responding" ANR that overlays the app and swallows every tap (the entire Maestro suite fails on the first interaction). Verified against darts26: `-gpu host` → 36/36 fail, `-gpu swiftshader_indirect` → 36/36 pass. `gpu: host` remains an opt-in for hosts with a real GL stack (x86 Linux). The now-unneeded host→swiftshader boot fallback and fast-exit guard are removed.
