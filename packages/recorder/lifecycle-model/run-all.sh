#!/bin/sh
# Reruns every check and the three charts with the statechart tool, one
# config after the other, in the order of expected.txt. Results land in
# out/<config>/report.md (and chart.mmd for the charts and the paths that
# break a rule). Each run goes through run.sh, which compares the rules that
# break with expected.txt; a config that gives anything else, or could not be
# checked (no report), fails the whole run, and so does gen-configs.sh
# failing, or a config that expected.txt does not list.
cd "$(dirname "$0")" || exit 2
./gen-configs.sh > /dev/null || {
  echo "gen-configs.sh failed." >&2
  exit 2
}
failed=0
# Progress.cfg checks L1 and L2 with fairness. It is left out: TLC evaluates
# the fairness of these steps at tens of states a minute.
for f in *.cfg; do
  c=${f%.cfg}
  [ "$c" = Progress ] || grep -q "^$c:" expected.txt || {
    echo "$c: no line in expected.txt." >&2
    failed=1
  }
done
for c in $(sed -n 's/^\([A-Za-z0-9][A-Za-z0-9-]*\):.*/\1/p' expected.txt); do
  case $c in
    Chart-Lifecycle) view=view-lifecycle.mjs ;;
    Chart-Gate) view=view-gate.mjs ;;
    Chart-Fill) view=view-fill.mjs ;;
    *) view=view-paths.mjs ;;
  esac
  # run.sh empties out/$c only once it has found its tool, view and
  # expectation: without this, a run that stops before then would be summed
  # up from an older report.
  rm -rf "out/$c"
  ./run.sh "$c" "$view" > "out-$c.log" 2>&1
  code=$?
  echo "$c: exit $code. $(awk '/^TLC reached/ { print; exit }' "out/$c/report.md" 2>/dev/null) $(tail -n1 "out-$c.log")"
  [ "$code" -eq 0 ] || failed=1
done
exit $failed
