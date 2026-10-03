#!/usr/bin/env bash
# Baseline: current adapters build, typecheck and pass their unit tests.
set -euo pipefail
W="$(cd "$(dirname "$0")/../.." && pwd)"
echo "worktree: $W"; git -C "$W" rev-parse HEAD
cd "$W" && pnpm turbo run build --filter=@ayme-dev/react --filter=@ayme-dev/vue --filter=@ayme-dev/unplugin-ayme --filter=@ayme-dev/inspector --force | tail -4
for p in react vue; do
  cd "$W/packages/$p"; echo "== $p"; pnpm exec tsc --noEmit; pnpm exec vitest run 2>&1 | tail -5
done
