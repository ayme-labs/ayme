#!/bin/sh
# Usage: ./run.sh <config name without .cfg> [view file]
# Checks one config with the statechart tool of the `statechart` skill: TLC
# on each rule in turn, a report with the shortest path to each rule that
# breaks, in plain words, and a Mermaid chart. STATECHART is the tool's
# `scripts/statechart`; by default the one the repository installs in
# `.agents/skills/statechart`. Run inside the repository's Devbox shell (the
# tool needs Node 22.18 or later). The tool finds TLC and Java with mise, or
# takes TLA2TOOLS and JAVA as tlc.sh does.
# Then it compares the rules that break with the ones expected.txt lists for
# the config. Exit 0: they are the same. Exit 1: they differ (it says which).
# Exit 2: the config could not be checked, or has no line in expected.txt.
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
# The rules the config must break, by their names in Recorder.tla; none
# after the colon means every rule must hold.
grep -q "^$cfg:" "$here/expected.txt" || {
  echo "No line for $cfg in expected.txt: say which rules it must break." >&2
  exit 2
}
want=$(sed -n "s/^$cfg://p" "$here/expected.txt" | tr -s ' ' '\n' | sed '/^$/d' | sort | tr '\n' ' ')
out=out/$cfg
rm -rf "${here:?}/$out"
(cd "$here" && sh "$tool" Recorder.tla --config "$cfg.cfg" --view "$view" --out "$out")
code=$?
# Exit 1 is a rule that breaks, a result; exit 2 or more, or no report, is not.
if [ "$code" -gt 1 ] || [ ! -f "$here/$out/report.md" ]; then
  echo "$cfg: NOT CHECKED (the statechart tool exited $code)." >&2
  exit 2
fi
got=$(sed -n 's/^## \(.*\) breaks$/\1/p' "$here/$out/report.md" | sort | tr '\n' ' ')
want=${want% } got=${got% }
if [ "$got" != "$want" ]; then
  echo "$cfg: UNEXPECTED. Expected ${want:-no rule} to break; ${got:-no rule} broke (out/$cfg/report.md)." >&2
  exit 1
fi
echo "$cfg: as expected, ${got:-no rule} breaks."
