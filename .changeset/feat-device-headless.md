---
"@maestroq/core": minor
"@maestroq/daemon": minor
"maestroq": minor
---

feat(daemon): per-device `headless` flag in `~/.maestroq/config.yaml`. On Android, the daemon appends `-no-window -no-audio -no-boot-anim` when it cold-boots `emulator -avd …` (no effect if the emulator is already running externally). On iOS the flag is declarative — `simctl boot` is already headless, but `Simulator.app` (if open) attaches a window to every booted sim and the daemon does not quit it for you; the dispatcher logs a one-shot warning pointing at `osascript -e 'quit app "Simulator"'`. Backwards compatible: the field defaults to `false`.
