#!/usr/bin/env bash
# Development-side check for a React floor lane (separate from the consumer
# contract): Ayme's React package typecheck + unit tests at an old React.
# Usage: react-dev-rebuild.sh <react> <@types/react> <@types/react-dom>
# Restores package.json and the lockfile afterwards.
set -uo pipefail
W="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$W"
R="$1"; T="$2"; TD="$3"; B="${PROBE_SCRATCH:?}/ayme221-react-backup"; mkdir -p "$B"
cp packages/react/package.json "$B/pkg.json"; cp pnpm-lock.yaml "$B/lock.yaml"
pnpm --dir packages/react pkg set devDependencies.react=$R devDependencies.react-dom=$R "devDependencies[\"@types/react\"]=$T" "devDependencies[\"@types/react-dom\"]=$TD"
pnpm install --no-frozen-lockfile >/dev/null 2>&1
echo "== typecheck (react $R, types $T/$TD)"; (cd packages/react && pnpm exec tsc --noEmit 2>&1 | head -8; echo "exit ${PIPESTATUS[0]}")
echo "== unit tests"; (cd packages/react && pnpm exec vitest run 2>&1 | grep -E 'Tests |FAIL|Error' | head -8; echo "exit ${PIPESTATUS[0]}")
cp "$B/pkg.json" packages/react/package.json; cp "$B/lock.yaml" pnpm-lock.yaml
pnpm install --frozen-lockfile >/dev/null 2>&1; echo restored
