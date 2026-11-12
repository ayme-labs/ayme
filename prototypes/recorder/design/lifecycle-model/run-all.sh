#!/bin/sh
# Reruns every check and both charts. Results land in out/<config>/report.md
# (and chart.mmd for the two charts). About 15 minutes.
#   ./run-all.sh        the standard set
#   ./run-all.sh long   also the two long runs (about 25 minutes each or more)
cd "$(dirname "$0")"
./gen-configs.sh > /dev/null
one() { # config [view]
  ./run.sh "$1" "${2:-view-paths.mjs}" > "out-$1.log" 2>&1
  code=$?
  if [ -f "out/$1/report.md" ]; then
    breaks=$(grep -c '^## .* breaks$' "out/$1/report.md")
    echo "$1: exit $code, $breaks rule(s) break. $(grep -m1 '^TLC reached' "out/$1/report.md")"
  else
    echo "$1: exit $code, NO REPORT (see out-$1.log)"
  fi
}
one Chart-Lifecycle view-lifecycle.mjs
one Chart-Gate view-gate.mjs
one Proposed
one Progress
one Surfaces
one Surfaces-No10-Revisions
one Simple
for c in No1-WaitGate No2-WaitHeld No3-WaitReports No4-RecorderOff No5-GateStartsRight \
         No6-NewerCloses No7-KeepOrder No8-AssertWaits No9-IgnoreSecondStop \
         Path-No1-StuckAfterSaving Path-No2-StuckAfterSaving Path-No6-ClickThenTyping \
         Question-WrongPage Probes; do one "$c"; done
./more/run-more.sh
if [ "$1" = long ]; then one SimpleRest; one Proposed3; fi
