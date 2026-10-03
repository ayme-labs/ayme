#!/usr/bin/env bash
# Old-Vue development rebuild (separate from the consumer contract): mirror the
# CI "Vue 3.2 compatibility" lane, then also emit the declarations with tsdown.
# Restores package.json and the lockfile afterwards.
set -uo pipefail
W="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$W"
V="${1:-3.2.0}"
cp packages/vue/package.json "${PROBE_SCRATCH:?}"/ayme221-vue-pkg.json; cp pnpm-lock.yaml "${PROBE_SCRATCH:?}"/ayme221-lock.yaml
pnpm --dir packages/vue pkg set devDependencies.vue=$V "devDependencies[\"@vue/server-renderer\"]=$V"
pnpm install --no-frozen-lockfile >/dev/null 2>&1
echo "== typecheck ($V)"; (cd packages/vue && pnpm exec tsc --noEmit; echo "exit $?")
echo "== unit tests ($V)"; (cd packages/vue && pnpm exec vitest run 2>&1 | grep -E 'Tests |FAIL'; echo "exit ${PIPESTATUS[0]}")
echo "== declaration build ($V)"; (cd packages/vue && pnpm exec tsdown --out-dir "${PROBE_SCRATCH:?}"/ayme221-vue-dist 2>&1 | grep -iE 'error|TS[0-9]+' | head -5; echo "exit ${PIPESTATUS[0]}")
cp "${PROBE_SCRATCH:?}"/ayme221-vue-pkg.json packages/vue/package.json; cp "${PROBE_SCRATCH:?}"/ayme221-lock.yaml pnpm-lock.yaml
pnpm install --frozen-lockfile >/dev/null 2>&1; echo restored
