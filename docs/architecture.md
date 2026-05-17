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
