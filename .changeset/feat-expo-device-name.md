---
"@maestroq/core": minor
"@maestroq/daemon": minor
---

feat(daemon): add optional `expoDeviceName` field per device config so `expo run:{ios,android} --device <…>` can use a different identifier than the `udid` maestroq uses for adb / simctl. Required for physical Android phones (whose adb serial like `d90586bb` is rejected by Expo, which wants the model name like `CPH2307`) and physical iPhones (where Expo wants the device name, not the ECID). Falls back to the previous behavior — `avdName ?? udid` for Android, `udid` for iOS — when `expoDeviceName` is unset, so existing configs are unchanged.
