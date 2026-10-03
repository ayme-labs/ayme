#!/usr/bin/env bash
# Reproduces the findings in ../../unified-ayme-api.md. Run from this directory.
set -euo pipefail
cd "$(dirname "$0")"
root=../../../..
dist=$root/packages/ayme/dist
esbuild=$(ls -d "$root"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild | head -1)
rolldown=$(ls -d "$root"/node_modules/.pnpm/rolldown@*/node_modules/rolldown/bin/cli.mjs | head -1)
legacy='{"compilerOptions":{"experimentalDecorators":true}}'
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
marker="Ayme requires a browser Document"

echo "== Typing: combined ayme, bare and options forms, runtime properties"
for mode in standard legacy; do
  "$root"/node_modules/.bin/tsc -p "typing/tsconfig.$mode.json" && echo "$mode decorators: type-checks"
done

echo
echo "== Function properties a runtime operation cannot take over"
node -e '"use strict";
for (const key of ["name", "length", "prototype", "call", "apply", "bind"]) {
  const fn = function ayme() {};
  try { Object.assign(fn, { [key]: 1 }); console.log(`${key}: overwritten`); }
  catch (error) { console.log(`${key}: ${error.constructor.name}`); }
}'

echo
echo "== Tree-shaking: a module that only marks a Page Object Model"
report() { printf '%-26s %-22s %8s bytes  keeps the runtime helper: %s\n' "$1" "$2" "$(cat "${@:3}" | wc -c | tr -d ' ')" "$(cat "${@:3}" | grep -q "$marker" && echo yes || echo no)"; }
for entry in decorators-module decorator-only.today decorator-only.combined; do
  "$esbuild" "shake/$entry.ts" --bundle --format=esm --platform=browser --minify \
    --tsconfig-raw="$legacy" --log-level=error --outfile="$work/$entry.esbuild.js"
  report "$entry" "esbuild" "$work/$entry.esbuild.js"
  "$esbuild" "shake/$entry.ts" --format=esm --tsconfig-raw="$legacy" \
    --log-level=error --outfile="shake/$entry.lowered.mjs"
  node "$rolldown" "shake/$entry.lowered.mjs" -f esm -p browser -m \
    -d "$work/$entry.rolldown" >/dev/null
  rm "shake/$entry.lowered.mjs"
  report "$entry" "rolldown" "$work/$entry.rolldown"/*.js
done

# The same consumers against a copy of the dist whose package declares
# "sideEffects": false. The main package declares nothing today.
mkdir -p "$work/pkg" "$work/shake"
cp -R "$dist" "$work/pkg/dist"
echo '{"name":"probe","type":"module","sideEffects":false}' >"$work/pkg/package.json"
for file in combined.mjs decorator-only.today.ts decorator-only.combined.ts; do
  sed "s#../../../../../packages/ayme/dist#../pkg/dist#" "shake/$file" >"$work/shake/$file"
done
for entry in decorator-only.today decorator-only.combined; do
  "$esbuild" "$work/shake/$entry.ts" --bundle --format=esm --platform=browser --minify \
    --tsconfig-raw="$legacy" --log-level=error --outfile="$work/$entry.sfx.js"
  report "$entry" "esbuild, sideEffects:false" "$work/$entry.sfx.js"
done

echo
echo "== Compiler: which classes become Page Object Models"
node compiler/derive.mjs
