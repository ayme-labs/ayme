#!/bin/sh
# Usage: ./run.sh <config name without .cfg> [view file]
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
# A config of this folder by its plain name: the name is also the folder
# under out/ that is emptied first, so nothing else can be.
case $cfg in
  *[!A-Za-z0-9-]* | -*)
    echo "Not a config name: $cfg (letters, digits and dashes, as Rules)." >&2
    exit 2
    ;;
esac
[ -f "$here/$cfg.cfg" ] || {
  echo "No config $cfg.cfg in $here." >&2
  exit 2
}
[ -f "$here/$view" ] || {
  echo "No view $view in $here." >&2
  exit 2
}
out=out/$cfg
rm -rf "${here:?}/$out"
cd "$here" && sh "$tool" Recorder.tla --config "$cfg.cfg" --view "$view" --out "$out"
