#!/usr/bin/env bash
# Build and pack the public packages the way packedConsumer.test.ts does:
# isolated staging dist, real `pnpm pack` (workspace: conversion).
# Usage: pack.sh <out-dir> [react-peer-override]
# The optional override rewrites only the STAGED manifest's react peer range
# (proposed-patch branch); the source manifest is never edited.
set -euo pipefail
W="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$1"; REACT_PEER="${2:-}"
rm -rf "$OUT"; mkdir -p "$OUT/tarballs"
for name in ayme inspector vue react unplugin-ayme; do
  root="$W/packages/$name"; staging="$OUT/staging/$name"
  mkdir -p "$staging"
  cp "$root"/{package.json,README.md,LICENSE} "$staging/"
  ln -s "$root/node_modules" "$staging/node_modules"
  (cd "$root" && pnpm exec tsdown --out-dir "$staging/dist" >/dev/null)
  if [[ $name == react && -n $REACT_PEER ]]; then
    node -e 'const f=process.argv[1],m=require(f);m.peerDependencies.react=process.argv[2];require("fs").writeFileSync(f,JSON.stringify(m,null,2))' "$staging/package.json" "$REACT_PEER"
  fi
  (cd "$staging" && pnpm pack --pack-destination "$OUT/tarballs" >/dev/null)
done
ls "$OUT/tarballs"
