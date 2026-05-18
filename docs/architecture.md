# Architecture

## Processes

- **Daemon** (`maestroq daemon`): one long-running Node process per machine.
- **CLI client** (`maestroq`): a thin RPC client. Connects to the daemon over a Unix socket at `~/.maestroq/daemon.sock` (file perms `0600`).
- **External children**: `npx expo run:*`, `npx expo start`, `maestro test`, `xcrun simctl`, `adb`, `emulator`. Spawned by the daemon with `detached: true` so each child is the leader of its own process group — descendants ride along.

## State on disk

| Path                                  | Owner  | Purpose                                                        |
| ------------------------------------- | ------ | -------------------------------------------------------------- |
| `~/.maestroq/config.yaml`             | user   | Device list, port range, defaults.                             |
| `~/.maestroq/daemon.sock`             | daemon | RPC socket (mode `0600`).                                      |
| `~/.maestroq/daemon.pid`              | daemon | PID file (used by `maestroq daemon status`).                         |
| `~/.maestroq/queue.json`              | daemon | Authoritative job state (atomic write).                        |
| `~/.local/share/maestroq/logs/<id>.log`     | daemon | Per-job stdout/stderr.                                   |
| `~/.local/share/maestroq/artifacts/<id>/`   | daemon | Maestro `--output` artifacts.                           |

## Job lifecycle

States: `queued → building → installing → metro-starting? → running → tearing-down → succeeded|failed|cancelled`.

```
                                   ┌──────────────┐
                                   │   queued     │
                                   └──────┬───────┘
                                          ▼
   ┌──────────────────────┐        ┌──────────────┐
   │   cancelled (early)  │◀────── │   building   │
   └──────────────────────┘        └──────┬───────┘
                                          ▼
                                   ┌──────────────┐
                                   │  installing  │
                                   └──────┬───────┘
                                          ▼
                  (variant=debug?) ┌──────────────┐
                                   │ metro-starting│
                                   └──────┬───────┘
                                          ▼
                                   ┌──────────────┐
                                   │    running   │
                                   └──────┬───────┘
                                          ▼
                                   ┌──────────────┐
                                   │ tearing-down │
                                   └──────┬───────┘
                                          ▼
                       succeeded | failed | cancelled
```

## Build cache

Key: `(cwd, git HEAD, platform, variant, env-hash)`.

- If `git status --porcelain` on `spec.cwd` returns any line, the cache is **bypassed**. A log line `cache: bypassed (working tree dirty)` lands in the job log.
- On a successful build, the key is recorded against the device UDID. The next clean-tree job with the same key skips the build stage entirely.
- Cache is in-memory: a daemon restart clears it. Persisting across restarts is a v0.2 candidate.

## Metro

When `variant=debug` and the spec doesn't set `metro: skip`, the worker:

1. Acquires a port lease from `MetroPortPool` (default range `8081–8089`).
2. If `reuse: true` and another live worker already has Metro up for the same `(cwd, HEAD)` on a clean tree, that lease is reference-counted and reused.
3. Otherwise spawns `npx expo start --port <p> --dev-client` in the worktree and polls `http://127.0.0.1:<p>/status` until ready.
4. On teardown the refcount decrements; the last user kills the Metro process group.

Dirty trees always get a fresh Metro — see "Build cache" above.

## Crash recovery

Each job in flight has its current external child's PID stored as `pgid` in `queue.json`. On daemon start:

1. Read `queue.json`.
2. For every job in `building|installing|metro-starting|running|tearing-down`, send `process.kill(-pgid, "SIGKILL")`. Negative PID = signal the whole process group, so grandchildren (`metro`, `xcodebuild`, `gradle`) die with the parent.
3. Mark those jobs `failed (reason: daemon-crash)`.
4. Queued jobs stay queued and dispatch normally on the next tick.

This is exercised by verification step 6 in the original plan.

## RPC protocol

Newline-delimited JSON over the Unix socket. Each request from `maestroq` is one line; the daemon answers with one or more `RpcEvent`s and a final `{"kind":"end"}` (or keeps streaming `log` events when `follow: true`).

Schemas live in [`packages/core/src/rpc.ts`](../packages/core/src/rpc.ts) and are validated with zod on both ends. The protocol is not stable until v1.0.

## Runner switch (`maestro` vs `maestro-runner`)

`defaults.runner` in `~/.maestroq/config.yaml` selects which test engine the worker invokes. Three behaviors flip with it:

- **Dispatcher iOS cap**: under `runner: maestro`, the dispatcher honors `defaults.max_concurrent_ios` (default `1`) because upstream `maestro test` hardcodes the iOS driver host port `7001` and the WDA port — two iOS sims on one Mac collide. Under `runner: maestro-runner`, the cap is treated as `Infinity`; the runner uses per-UDID dynamic WDA ports (8100–9099) and Appium-vendored WebDriverAgent, so parallel iOS works out of the box.
- **Teardown pkill sweep**: `lifecycle/teardown.ts` only invokes the iOS leftover sweep (`cleanupIosLeftovers`) under `runner: maestro`. `maestro-runner` does not spawn `maestro-driver-iosUITests-Runner` or `xcodebuild test-without-building`, so there is nothing for the sweep to find.
- **Finalize watchdog**: `lifecycle/maestro.ts` arms a 30 s SIGKILL-after-`Flows Passed/Failed` watchdog only under `runner: maestro`. This mitigates the upstream `DebugLogStore.finalizeRun` race that hangs the JVM forever on a deleted log dir. `maestro-runner` has no JVM and a different artifact layout, so the race does not exist.

See AGENTS.md → "Runners" and "Known sharp edges" for the full upstream-bug context.

## iOS leftover sweep (`cleanupIosLeftovers`)

After a `maestro test` run on iOS under `runner: maestro`, the helper processes `maestro-driver-iosUITests-Runner` and `xcodebuild test-without-building` can linger past the parent CLI exit. They hold port `7001` stale, and the next iOS run dies during install with `Failed to connect to /127.0.0.1:7001`.

`lifecycle/cleanup-ios.ts:cleanupIosLeftovers` runs on every iOS teardown (including the cancel path) and `pkill -f`s the two leftover patterns scoped to the just-used UDID. Cheap, idempotent, and load-bearing for back-to-back iOS jobs on the same simulator. `JobSpec.rebootSimBefore: true` is a heavier fallback (`simctl shutdown` + `bootstatus`, ~30 s) for projects where the pkill misses something.
