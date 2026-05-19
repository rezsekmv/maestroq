# maestroq

> A local job queue for [Maestro](https://maestro.mobile.dev) UI tests. Share simulators and emulators across parallel git worktrees and AI coding agents on one machine.

[![CI](https://github.com/rezsekmv/maestroq/actions/workflows/ci.yml/badge.svg)](https://github.com/rezsekmv/maestroq/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

_Independent OSS project. Not affiliated with, sponsored by, or endorsed by mobile.dev or Maestro._

## Why maestroq?

Maestro can only drive one simulator or emulator at a time. Without a queue you end up manually waiting for the previous run to finish before you can start the next one — polling "is it done yet?", or worse, kicking off a second run mid-install and watching both crash. The moment two AI agents — or two git worktrees, or a developer plus a CI job — share a Mac, the problem multiplies: tests interleave, installs collide, port 7001 goes stale.

Existing options force a tradeoff: Maestro Cloud is paid and remote, Detox couples to Jest, a bash lockfile gives you no queue / no logs / no cancel.

`maestroq` is one daemon per machine. It owns the local sim/emulator pool, FIFOs jobs per device, and dispatches work from any worktree over a Unix socket — so N agents on one Mac stops being a foot gun.

`maestroq` drives mobile UI tests via one of two engines: [`maestro-runner`](https://github.com/devicelab-dev/maestro-runner) (default, recommended — single Go binary, supports parallel devices on iOS *and* Android) or the original [Maestro CLI](https://github.com/mobile-dev-inc/Maestro) (opt-in, JVM-based, limited to one iOS sim at a time). **Running more than one device per platform requires the default `maestro-runner` runner.**

## Getting started

### Install

```bash
npm i -g maestroq
```

`maestroq` defaults to [`maestro-runner`](https://github.com/devicelab-dev/maestro-runner) as its test engine. Install it before running your first job, or set `defaults.runner: maestro` in `~/.maestroq/config.yaml` to fall back to the original [Maestro CLI](https://github.com/mobile-dev-inc/Maestro).

### Startup

Start the daemon (or install it as a service — see [`docs/launchd.md`](docs/launchd.md)):

```bash
maestroq daemon start &
```

### Configure

Boot the simulator and emulator you want maestroq to own, then:

```bash
maestroq init                               # auto-discovers booted devices + scaffolds starter specs
maestroq daemon stop && maestroq daemon start &   # reload daemon with the new config
```

`maestroq init`:

- Reads `xcrun simctl list devices booted` and `adb devices` to pick one iOS sim and one Android emulator.
- Writes `~/.maestroq/config.yaml` with those devices and sensible defaults.
- If `.maestro/` exists in the current directory, also scaffolds `.maestro/smoke-<platform>.yaml` so `maestroq run` works immediately.

Flags: `--no-discover` (skip the auto-detect), `--no-specs` (skip spec scaffolding), `--from-package-json` (fall back to placeholders if nothing is booted yet).

#### `config.yaml` reference

| Key                              | Type                 | Default                                | What it does |
| -------------------------------- | -------------------- | -------------------------------------- | ------------ |
| `devices[].udid`                 | string (required)    | —                                      | Simulator UDID (`xcrun simctl list devices booted`) or emulator id (`adb devices`). |
| `devices[].platform`             | `ios` \| `android`   | —                                      | Which worker pool this device joins. |
| `devices[].label`                | string               | —                                      | Human-readable name shown in `maestroq devices`. |
| `devices[].avdName`              | string               | —                                      | Android only. The AVD name passed to `emulator -avd`; needed when the daemon has to cold-boot the emulator. |
| `metro.port_range`               | `[number, number]`   | `[8081, 8089]`                         | Inclusive port range the daemon allocates from for Metro (dev-client jobs). |
| `defaults.runner`                | `maestro-runner` \| `maestro` | `maestro-runner`              | Which CLI maestroq shells out to. **The default `maestro-runner` is required to run more than one device per platform** — the legacy `maestro` runner hardcodes iOS port 7001 and is capped at one iOS sim regardless of how many you configure. Use `maestro` only if you can't install the Go binary from [devicelab-dev/maestro-runner](https://github.com/devicelab-dev/maestro-runner). |
| `defaults.reboot_sim_before`     | boolean              | `false`                                | Per-job default for `rebootSimBefore`. Fallback knob now that pkill-on-teardown handles most iOS port-7001 staleness. |
| `defaults.build_cache`           | boolean              | `true`                                 | Per-job default for `build.cache`. Auto-bypassed when the working tree is dirty. |
| `defaults.max_concurrent_ios`    | integer              | `1`                                    | Only honored when `defaults.runner: maestro`. Caps the number of iOS jobs running simultaneously because upstream `maestro test` hardcodes the iOS driver host port. Under the default `maestro-runner` this setting is ignored and every configured iOS device runs in parallel. |
| `log_dir`                        | string (path)        | `~/.local/share/maestroq/logs`         | Per-job log file directory. `~` is expanded. |
| `artifact_dir`                   | string (path)        | `~/.local/share/maestroq/artifacts`    | Maestro `--output` artifact directory. `~` is expanded. |


### Run

After `maestroq init`, you already have a starter spec at `.maestro/smoke-<platform>.yaml`. Tweak it (or write your own — see the example below) and run:

```yaml
# .maestro/smoke-ios.yaml
platform: ios
flows: [.maestro/e2e/smoke]
build: { variant: release, cache: true }
label: smoke iOS
```

```bash
maestroq run    .maestro/smoke-ios.yaml   # blocks, streams logs, exits with the maestro code
maestroq run    smoke-ios                 # shorthand — resolves to .maestro/smoke-ios.yaml walking up
maestroq submit .maestro/smoke-ios.yaml   # async — prints the job id and returns
maestroq status -lH -w                    # live queue (long view, header, watch)
maestroq logs   <id> -f                   # follow a job's log
maestroq cancel <id>                      # SIGTERM the worker's child group
```

That's it. Multiple worktrees or agents can submit the same way — the daemon FIFOs per device, runs across devices in parallel.

#### Multi-device parallelism

If you've configured more than one iOS sim or more than one Android emulator in `~/.maestroq/config.yaml`, maestroq dispatches them concurrently — submit N specs and the daemon will run them on N devices at once. **Parallel iOS only works under the default `defaults.runner: maestro-runner`.** Under `defaults.runner: maestro`, iOS is hard-capped at one concurrent job (upstream port 7001 collision). See [maestro-runner](https://github.com/devicelab-dev/maestro-runner) for install instructions.

#### Per-project config (optional)

Drop a `.maestro/maestroq.yaml` next to your specs and the CLI will merge it into every job submitted from that project, so you don't repeat boilerplate in every spec:

```yaml
# .maestro/maestroq.yaml
defaults:
  rebootSimBefore: true
  build: { variant: release, cache: true }
```

Spec fields always win — this only fills gaps.

#### Physical iOS devices (capability gap)

Maestroq is built around iOS **simulators**. A physical iPhone/iPad does run, but only after working around four Apple-side constraints in order — none of them are bugs maestroq can fix on its own:

1. **Use the device's ECID, not its CoreDevice UUID, in `~/.maestroq/config.yaml`.** `xcrun devicectl list devices` shows `identifier: FC709E4A-…` (CoreDevice UUID) but `xcodebuild` matches against the ECID `00008030-…`. Get both via `xcrun devicectl list devices -v` — the `udid` field is the ECID.
2. **Export `MAESTRO_TEAM_ID=<your-Apple-team-id>` before `maestroq daemon start`.** maestro-runner needs it to code-sign WebDriverAgent for real devices. (Or set it via the spec's `env:` block per-job.)
3. **Override the WDA bundle id with `MAESTRO_WDA_BUNDLE_ID=<your-prefix>.WebDriverAgentRunner`.** The default is `com.facebook.WebDriverAgentRunner.xctrunner`, which Facebook's team owns — no other team can sign under it. maestro-runner appends `.xctrunner` automatically, so don't include it.
4. **Bootstrap signing once via Xcode UI.** Even with a logged-in Apple ID, `xcodebuild` from CLI cannot auto-provision profiles for personal/individual accounts. Open `~/.maestro-runner/drivers/ios/WebDriverAgent/WebDriverAgent.xcodeproj` in Xcode, select the `WebDriverAgentRunner` target → Signing & Capabilities, tick "Automatically manage signing", pick your team, change the bundle id to match step 3, and let Xcode UI fix any signing issues. Once it builds in the UI, the provisioning profile is cached at `~/Library/Developer/Xcode/UserData/Provisioning Profiles/` and subsequent maestro-runner CLI builds reuse it.

The most common symptom-to-step mapping if something fails along the way:

| Failure | Step to revisit |
| --- | --- |
| `[boot] simctl bootstatus … Invalid device` | (maestroq itself didn't always handle physical devices — make sure you're on a version with `lifecycle/boot.ts` routing through `devicectl`) |
| `xcodebuild: Unable to find a device matching the provided destination specifier` | step 1 (wrong UDID kind) |
| `iOS with WDA driver requires --team-id` | step 2 |
| `No profiles for 'com.facebook.WebDriverAgentRunner.xctrunner'` | step 3 |
| `No Accounts: Add a new account in Accounts settings` despite being signed in to Xcode | step 4 |

## Docs

- [Architecture & lifecycle](docs/architecture.md)
- [Service install (launchd / systemd)](docs/launchd.md)
- [Notes for AI agent workflows](docs/ai-agents.md)
- [Claude Code skill](integrations/claude-code/SKILL.md) — drop-in skill so agents auto-route Maestro runs through `maestroq`
- [Contributor guide / invariants](AGENTS.md)

---

Licensed under [MIT](LICENSE).
