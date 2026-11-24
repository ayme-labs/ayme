#!/bin/sh
# Reruns every check and the three charts with the statechart tool, one
# config after the other. Results land in out/<config>/report.md (and
# chart.mmd for the charts and the paths that break a rule). A rule that
# breaks is a result (the tool's exit 1), as the Limit-, Race- and Probes
# configs expect; a run that could not check (exit 2 or more, or no report)
# fails the whole run, and so does gen-configs.sh failing.
cd "$(dirname "$0")" || exit 2
./gen-configs.sh > /dev/null || {
  echo "gen-configs.sh failed." >&2
  exit 2
}
failed=0
one() { # config [view]
  ./run.sh "$1" "${2:-view-paths.mjs}" > "out-$1.log" 2>&1
  code=$?
  if [ "$code" -le 1 ] && [ -f "out/$1/report.md" ]; then
    breaks=$(grep -c '^## .* breaks$' "out/$1/report.md")
    echo "$1: exit $code, $breaks rule(s) break. $(grep -m1 '^TLC reached' "out/$1/report.md")"
  else
    echo "$1: exit $code, NOT CHECKED (see out-$1.log)"
    failed=1
  fi
}
one Chart-Lifecycle view-lifecycle.mjs
one Chart-Gate view-gate.mjs
one Chart-Fill view-fill.mjs
for c in Rules Rules-Pages Rules-Rounds Rules-Ends Surfaces TimeLimit TimeLimit-Holds \
         Rules-StartRecording Path-StartRecording-Stop Path-StartRecording-BlankPage \
         Path-StartRecording-Continue \
         Rule7 Rule7-Strict Rule7-Navigation Rule7-StartRecording Rule7-AssertThenType \
         Rule7-TypeAfterStopOnNewPage Fold-AfterStep Rules-WithoutB2 \
         Limit-TypingThenTyping Limit-ClosedPageWaits Limit-BlankPageInput \
         Path-AfterStop Path-StopClickCtrlC Path-HeldKeyAfterStop Path-PickOnNewPage \
         Path-PickOnNewPage-NextClick Path-TypingAfterContinue Path-NavigationThenType Path-ReadAcrossNavigation Input-ReadAcrossNavigation \
         Path-TypingAfterNavigation Path-AddressChangeWhileTyping \
         Races Race-LateRevision Race-LateRevision-Stop Race-LateTypingReport Race-LastText \
         Race-ClickLostAfterStop Race-ClickAfterPicking Race-HeldMessageAfterStop \
         Race-NavigationBeforeTypingReport \
         Clicks-Middle Clicks-Middle-Fill Clicks-MiddleOnCheckbox Clicks-Mixed \
         Probes Probes-Discard Probes-Clear Probes-Window Probes-Window-Navigation Probes-Continue Probes-LateRevision Probes-Storage; do
  one "$c"
done
# Progress.cfg checks L1 and L2 with fairness. It is left out: TLC evaluates
# the fairness of these steps at tens of states a minute.
exit $failed
