# maestroq

> A local job queue for [Maestro](https://maestro.mobile.dev) UI tests. Share simulators and emulators across parallel git worktrees and AI coding agents on one machine.

[![CI](https://github.com/rezsekmv/maestroq/actions/workflows/ci.yml/badge.svg)](https://github.com/rezsekmv/maestroq/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Why maestroq?

Maestro can only drive one simulator or emulator at a time. The moment two AI agents — or two git worktrees, or a developer plus a CI job — share a Mac, they race the device. Tests interleave, installs collide, port 7001 goes stale.

Existing options force a tradeoff: Maestro Cloud is paid and remote, Detox couples to Jest, a bash lockfile gives you no queue / no logs / no cancel.

`maestroq` is one daemon per machine. It owns the local sim/emulator pool, FIFOs jobs per device, and dispatches work from any worktree over a Unix socket — so N agents on one Mac stops being a foot gun.

## Getting started

```bash
# 1. install
npm i -g maestroq

# 2. start the daemon (or install it as a service — see docs/launchd.md)
mq daemon start &

# 3. point it at the devices you want it to own
xcrun simctl list devices booted              # grab the iOS UDID
adb devices                                    # grab the Android emulator id
$EDITOR ~/.maestroq/config.yaml                # add them
mq daemon stop && mq daemon start &            # reload config
```

Drop a spec next to your `.maestro/` flows:

```yaml
# maestroq/smoke-ios.yaml
platform: ios
flows: [.maestro/e2e/smoke]
build: { variant: release, cache: true }
rebootSimBefore: true
label: smoke iOS
```

And run it:

```bash
mq run    maestroq/smoke-ios.yaml   # blocks, streams logs, exits with the maestro code
mq submit maestroq/smoke-ios.yaml   # async — prints the job id and returns
mq status -lH -w                    # live queue (long view, header, watch)
mq logs   <id> -f                   # follow a job's log
mq cancel <id>                      # SIGTERM the worker's child group
```

That's it. Multiple worktrees or agents can submit the same way — the daemon FIFOs per device, runs across devices in parallel.

## The killer demo

Two worktrees, both submitting iOS + Android in parallel:

```
ID       WORKTREE     PLAT    STATUS      CREATED  STARTED  DUR     EXIT
17aad925 darts26      ios     succeeded   6m47s    6m47s    86.0s   0
03deb076 darts26      android succeeded   6m47s    6m47s    110.6s  0
ab2079e3 my-feature   ios     succeeded   6m47s    5m21s    87.1s   0
9d5b7412 my-feature   android succeeded   6m46s    4m56s    85.4s   0
```

`darts26` and `my-feature` started their iOS jobs at the same instant; `my-feature`'s iOS started *exactly* when `darts26`'s iOS finished. Same for Android. No agent had to know about the others.

## Wiring AI agents

`mq run` is a drop-in for `maestro test`: it blocks, streams logs, exits with the underlying exit code. Tell your agent:

> Run Maestro flows via `mq run <spec.yaml>`, not `maestro test`. If the daemon isn't running, surface the one-line hint and ask the human to start it.

See [`AGENTS.md`](AGENTS.md) for the full architectural guide for contributors.

## Docs

- [Architecture & lifecycle](docs/architecture.md)
- [Service install (launchd / systemd)](docs/launchd.md)
- [Notes for AI agent workflows](docs/ai-agents.md)
- [Contributor guide / invariants](AGENTS.md)

---

Licensed under [MIT](LICENSE).
