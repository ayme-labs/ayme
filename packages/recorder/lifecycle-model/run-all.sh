#!/bin/sh
# Reruns every check and the three charts with the statechart tool, one
# config after the other. Results land in out/<config>/report.md (and
# chart.mmd for the charts and the paths that break a rule).
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
one Chart-Fill view-fill.mjs
for c in Rules Rules-Pages Rules-Rounds Rules-Ends Surfaces TimeLimit \
         Rule7 Rule7-Strict Rules-WithoutB2 \
         Limit-TypingThenTyping Limit-ClosedPageWaits \
         Path-AfterStop Path-StopClickCtrlC Path-HeldKeyAfterStop Path-PickOnNewPage \
         Path-PickOnNewPage-NextClick Path-TypingAfterContinue \
         Races Race-LateRevision Race-LateRevision-Stop Race-LateTypingReport Race-LastText \
         Probes Probes-Clear Probes-Window Probes-Window-Navigation Probes-Continue Probes-LateRevision; do
  one "$c"
done
# Progress.cfg checks L1 and L2 with fairness. It is left out: TLC evaluates
# the fairness of these steps at tens of states a minute.
