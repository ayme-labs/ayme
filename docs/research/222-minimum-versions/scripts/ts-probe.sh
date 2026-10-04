#!/usr/bin/env bash
# Usage: ts-probe.sh <dir-with-typescript-installs> <versions...>
S=$1; shift
cd "$(git rev-parse --show-toplevel)"
for v in "$@"; do
  for p in apps/example-next/probe-ts-tsconfig.json apps/example-next/probe-ts-tsconfig.pom.json apps/example-nuxt/probe-ts-tsconfig.pom.json; do
    out=$(node "$S/$v/node_modules/typescript/bin/tsc" --noEmit -p "$p" 2>&1); rc=$?
    echo "TS $v $p rc=$rc errors=$(grep -c 'error TS' <<<"$out")"
    grep 'error TS' <<<"$out" | head -3
  done
done
