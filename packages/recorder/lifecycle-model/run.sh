#!/bin/sh
# Usage: ./run.sh <config name without .cfg> [view file] [out folder]
# Checks one config with the statechart tool of the `statechart` skill: TLC
# on each rule in turn, a report with the shortest path to each rule that
# breaks, in plain words, and a Mermaid chart. STATECHART is the tool's
# `scripts/statechart`; by default the one the repository installs in
# `.agents/skills/statechart`. Run inside the repository's Devbox shell (the
# tool needs Node 22.18 or later). The tool finds TLC and Java with mise, or
# takes TLA2TOOLS and JAVA as tlc.sh does.
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
tool=${STATECHART:-$repo/.agents/skills/statechart/scripts/statechart}
[ -f "$tool" ] || {
  echo "No statechart tool at $tool: install the statechart skill, or set STATECHART (README, \"Running it\")." >&2
  exit 2
}
cfg=${1:?Name a config, as Rules.}
view=${2:-view-paths.mjs}
out=${3:-out/$cfg}
rm -rf "${here:?}/$out"
cd "$here" && sh "$tool" Recorder.tla --config "$cfg.cfg" --view "$view" --out "$out"
