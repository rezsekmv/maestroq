#!/usr/bin/env bash
# Sync README + LICENSE from the repo root into each published package directory.
#
# - packages/cli/README.md is overwritten with the root README (CLI is the
#   user-facing package on npm; npmjs.com renders this one).
# - packages/core/README.md and packages/daemon/README.md are hand-written
#   stubs and intentionally NOT overwritten.
# - LICENSE is overwritten in all three packages from the root LICENSE.
#
# Called by each package's `prepublishOnly` hook, so it runs before any
# `npm publish` (whether via `changeset publish` or a manual publish).
#
# Usage: bash scripts/sync-readme.sh

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

cp "$repo_root/README.md"  "$repo_root/packages/cli/README.md"

for pkg in cli core daemon; do
  cp "$repo_root/LICENSE" "$repo_root/packages/$pkg/LICENSE"
done

echo "[sync-readme] cli README + all package LICENSEs synced from repo root"
