#!/bin/sh
# Usage: run-phase.sh <config> <arm> <phase> [read-only|read-write] [e2e run args...]
# Runs one phase of the comparison and prints the run summary plus the runStep count.
set -u
config=$1 arm=$2 phase=$3 mode=${4:-read-write}
shift 4 2>/dev/null || shift $#
out=.e2e/out/$config/$arm-$phase
rm -rf "$out"; mkdir -p "$out"
SPIKE_ARM=$arm SPIKE_PHASE=$phase SPIKE_LOG=$PWD/$out/runsteps.jsonl SPIKE_CACHE_MODE=$mode \
  node node_modules/e2e/dist/cli/bin.js run --config e2e.$config.config.ts --output "$out" "$@" > "$out/stdout.txt" 2>&1
echo "== $config $arm $phase ($mode) exit=$?"
grep -E "Tests |Cache |Duration |AI " "$out/stdout.txt"
echo "runStep calls: $( [ -f "$out/runsteps.jsonl" ] && wc -l < "$out/runsteps.jsonl" | tr -d ' ' || echo 0)"
