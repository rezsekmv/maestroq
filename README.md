# maestroq

> Local job queue/daemon for [Maestro](https://maestro.mobile.dev) UI tests. Share simulators and emulators across parallel git worktrees and AI coding agents on one machine.

> Status: **v0.1**, MIT-licensed, macOS + Linux. APIs and CLI surface may shift before v1.0.

## The problem

Maestro can only drive one iOS simulator (or Android emulator) at a time. The moment you have two agents — or two worktrees, or a developer and a CI job — sharing a Mac, they race the simulator and step on each other.

Existing workarounds either run remotely ([Maestro Cloud](https://cloud.mobile.dev)), assume one developer at a time (per-project shell scripts), or are tied to a specific runner ([Detox](https://wix.github.io/Detox/)'s device-registry pattern). None solve "N agents from N worktrees driving the same Mac."

## The solution

`maestroq` runs a single daemon per machine that:

- holds a FIFO queue of jobs (each job = `flows` to run on a specific platform),
- owns the local pool of simulators/emulators,
- spawns child builds, Metro instances, and Maestro runs in their own process groups,
- exposes a tiny `mq` CLI over a Unix socket so any worktree can submit work.

```
┌──────────────┐    submit / status / logs / cancel   ┌──────────────────────┐
│  mq client   │ ──────── unix socket ───────────────▶│       daemon         │
└──────────────┘ ◀──────── log stream ─────────────── │ (single per machine) │
                                                      └──────────┬───────────┘
                                                                 │ dispatch
                                                                 ▼
                                                    ┌─────────────────────────┐
                                                    │  worker pool (N)         │
                                                    │  one per registered UDID │
                                                    └─────────────────────────┘
```

See [docs/architecture.md](docs/architecture.md) for the full lifecycle.

## Quick start

```bash
npm i -g maestroq
mq daemon start &                     # foreground; launchd template lives in docs/launchd.md
cd ~/my-app && mq init --from-package-json
$EDITOR ~/.maestroq/config.yaml       # fill in your sim UDID + AVD name
mq run examples/darts26/smoke-ios.yaml
```

## Job spec

```yaml
platform: ios                # or android
flows:
  - .maestro/smoke.yaml
build:
  variant: release           # or debug for dev-client
  cache: true                # auto-disabled when working tree is dirty
metro:
  reuse: true                # only honored when variant: debug
env:
  EXPO_PUBLIC_DEMO_MODE: "1"
priority: 0
rebootSimBefore: false
label: "darts26 smoke iOS"
```

Submit it with `mq run spec.yaml` (blocks, streams logs, exit code mirrors the job) or `mq submit spec.yaml` (fire-and-forget, prints the job id).

## Not in v0.1

- Parallel runs on more than one iOS simulator
- Windows
- Physical devices (works in theory — untested)
- Remote / TCP transport (Unix socket only)

## Why not Detox / Maestro Cloud / a lockfile?

| Option        | Limitation we hit                                       |
| ------------- | ------------------------------------------------------- |
| Detox         | Tied to Jest workers; not generic                       |
| Maestro Cloud | Remote, paid, no local sim ownership                    |
| Bash lockfile | No FIFO across agents, no status/logs/cancel, no Metro  |

## License

MIT — see [LICENSE](./LICENSE).
