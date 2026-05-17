# maestroq

> A local job queue for [Maestro](https://maestro.mobile.dev) UI tests. Share simulators and emulators across parallel git worktrees and AI coding agents on one machine.

[![CI](https://github.com/rezsekmv/maestroq/actions/workflows/ci.yml/badge.svg)](https://github.com/rezsekmv/maestroq/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Why maestroq?

Maestro can only drive one simulator or emulator at a time. Without a queue you end up manually waiting for the previous run to finish before you can start the next one — polling "is it done yet?", or worse, kicking off a second run mid-install and watching both crash. The moment two AI agents — or two git worktrees, or a developer plus a CI job — share a Mac, the problem multiplies: tests interleave, installs collide, port 7001 goes stale.

Existing options force a tradeoff: Maestro Cloud is paid and remote, Detox couples to Jest, a bash lockfile gives you no queue / no logs / no cancel.

`maestroq` is one daemon per machine. It owns the local sim/emulator pool, FIFOs jobs per device, and dispatches work from any worktree over a Unix socket — so N agents on one Mac stops being a foot gun.

## Getting started

### Install

```bash
npm i -g maestroq
```

### Startup

Start the daemon (or install it as a service — see [`docs/launchd.md`](docs/launchd.md)):

```bash
mq daemon start &
```

### Configure

Scaffold the config, then fill in the devices you want the daemon to own:

```bash
mq init                               # writes ~/.maestroq/config.yaml
xcrun simctl list devices booted      # grab the iOS UDID
adb devices                            # grab the Android emulator id
$EDITOR ~/.maestroq/config.yaml        # paste them in
mq daemon stop && mq daemon start &    # reload config
```

If your project already has `test:e2e:*` scripts in `package.json`, `mq init --from-package-json` seeds placeholder device entries based on which platforms it sees.

#### `config.yaml` reference

| Key                              | Type                 | Default                                | What it does |
| -------------------------------- | -------------------- | -------------------------------------- | ------------ |
| `devices[].udid`                 | string (required)    | —                                      | Simulator UDID (`xcrun simctl list devices booted`) or emulator id (`adb devices`). |
| `devices[].platform`             | `ios` \| `android`   | —                                      | Which worker pool this device joins. |
| `devices[].label`                | string               | —                                      | Human-readable name shown in `mq devices`. |
| `devices[].avdName`              | string               | —                                      | Android only. The AVD name passed to `emulator -avd`; needed when the daemon has to cold-boot the emulator. |
| `metro.port_range`               | `[number, number]`   | `[8081, 8089]`                         | Inclusive port range the daemon allocates from for Metro (dev-client jobs). |
| `defaults.reboot_sim_before`     | boolean              | `false`                                | Per-job default for `rebootSimBefore` (mitigates iOS port-7001 staleness). |
| `defaults.build_cache`           | boolean              | `true`                                 | Per-job default for `build.cache`. Auto-bypassed when the working tree is dirty. |
| `log_dir`                        | string (path)        | `~/.local/share/maestroq/logs`         | Per-job log file directory. `~` is expanded. |
| `artifact_dir`                   | string (path)        | `~/.local/share/maestroq/artifacts`    | Maestro `--output` artifact directory. `~` is expanded. |


### Run

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

## Docs

- [Architecture & lifecycle](docs/architecture.md)
- [Service install (launchd / systemd)](docs/launchd.md)
- [Notes for AI agent workflows](docs/ai-agents.md)
- [Contributor guide / invariants](AGENTS.md)

---

Licensed under [MIT](LICENSE).
