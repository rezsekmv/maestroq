---
"@maestroq/daemon": minor
---

feat(daemon): support physical iOS devices in `bootDevice`. Previously every iOS UDID went through `xcrun simctl bootstatus`, which only knows simulators — physical iPhones/iPads failed instantly with `Invalid device`. The boot path now probes `xcrun simctl list -j devices` to tell simulator vs. physical, and uses `xcrun devicectl list devices` to confirm a physical device is paired before handing off to `maestro-runner`'s WDA path. Note: physical-device configuration also requires (a) the **ECID** (e.g. `00008030-…`) as the device UDID, not the CoreDevice UUID, because that's what `xcodebuild` matches against, and (b) `MAESTRO_TEAM_ID` in the daemon's environment so the WDA can be code-signed.
