#!/bin/sh
# Usage: ./run.sh <config name without .cfg> [view file] [out folder name]
# Runs the pstack statechart tool on Recorder.tla with the repository's Devbox Node.
here=$(cd "$(dirname "$0")" && pwd)
repo=<repo>
tool=<home>/.agents/skill-plugins/plugins/pstack/skills/statechart/scripts/statechart.ts
cfg=$1
view=${2:-view-paths.mjs}
out=${3:-out/$cfg}
rm -rf "$here/$out"
cd "$repo" && devbox run -- sh -c "cd '$here' && node --disable-warning=ExperimentalWarning '$tool' Recorder.tla --config '$cfg.cfg' --view '$view' --out '$out'"
