---
"@maestroq/daemon": minor
---

feat(daemon): probe Android PackageManager during `bootDevice`. A booted-but-broken emulator (system_server stuck, PM service dead) can still pass `adb get-state`, but `adb shell pm list packages` returns `cmd: Can't find service: package`. Without this probe the worker happily drives a 20+ min release build before the failure surfaces at `adb install`. The probe runs a 4 s `pm list packages android` check on both the already-running and freshly-spawned emulator paths; if PM is unhealthy, the job fails fast with a clear "reboot the emulator/device" message.
