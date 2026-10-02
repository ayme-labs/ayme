#!/usr/bin/env bash
# Usage (inside the probe's devbox env): run-probe.sh <app-dir>
set -u
cd "$1"
node --version
npx ng build > final-build.log 2>&1 && echo "build: ok" || { echo "build: failed"; tail -20 final-build.log; }
for mode in prod dev; do
  PROBE_MODE=$mode npx playwright test 2>&1 | grep -v WebServer > final-$mode.log
  echo "$mode: $(grep -E '[0-9]+ (passed|failed|skipped)' final-$mode.log | tr -s ' ' | tr '\n' ' ')"
done
