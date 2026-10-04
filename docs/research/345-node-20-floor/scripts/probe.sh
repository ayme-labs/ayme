#!/usr/bin/env bash
# Usage: probe.sh <app: next|nuxt> <label>
# Runs build, typecheck, dev E2E, prod E2E in apps/example-<app>, logging each step.
set -u
app=$1; label=$2
root=$(git rev-parse --show-toplevel)
logs=${PROBE_LOGS:-$root/../probe-logs}/$label
mkdir -p "$logs"
cd "$root/apps/example-$app" || exit 1
echo "cwd=$(pwd) node=$(node -v)" | tee "$logs/summary.txt"
pnpm --filter . ls next nuxt vue react vite typescript @types/react --depth 0 2>/dev/null >> "$logs/summary.txt"; (pnpm --filter . why vite --depth 2 2>/dev/null | head -20) >> "$logs/summary.txt"
rm -rf .next .next-dev .nuxt .output
for step in build typecheck test:e2e:dev test:e2e:prod; do
  pnpm run "$step" > "$logs/${step//:/_}.log" 2>&1
  rc=$?
  echo "$step rc=$rc" | tee -a "$logs/summary.txt"
done
