---
"@maestroq/core": minor
"@maestroq/daemon": minor
"maestroq": minor
---

feat: headless Android cold-boots now pass `-gpu host` explicitly (with a one-time automatic fallback to `-gpu swiftshader_indirect` if the host-GPU boot fails). `-no-window` otherwise makes the emulator silently use software rendering regardless of the AVD's `hw.gpu.mode`, which starves GPU-heavy RN/Flutter apps and makes Maestro's first `tapOn` time out. A new per-device `gpu: host | swiftshader_indirect | auto` config field pins the mode and disables the fallback.
