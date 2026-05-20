---
"maestroq": patch
---

fix(cli): render the `DUR` column in `maestroq status` in human units instead of raw seconds. A 31-min job now reads `31m24s` instead of `1884.2s`; multi-hour runs show `Hh Mm`; multi-day shows `Dd Hh`. Sub-minute runs keep tenths-of-a-second precision (`7.3s`) so quick smoke flows don't lose detail.
