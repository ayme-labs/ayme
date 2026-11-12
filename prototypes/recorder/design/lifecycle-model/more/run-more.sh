#!/bin/sh
# Runs the narrower checks in this folder. Usage: ./run-more.sh
here=$(cd "$(dirname "$0")" && pwd)
repo=<repo>
tool=<home>/.agents/skill-plugins/plugins/pstack/skills/statechart/scripts/statechart.ts
cp "$here/../Recorder.tla" "$here/Recorder.tla"
for cfg in More-No4-PausedClick More-No3-BeforeClear More-No3-HeldClickSaved More-Simple-Surfaces; do
  rm -rf "$here/out/$cfg"
  (cd "$repo" && devbox run -- sh -c "cd '$here' && node --disable-warning=ExperimentalWarning '$tool' RecorderMore.tla --config '$cfg.cfg' --view ../view-paths.mjs --out 'out/$cfg'") > "$here/out-$cfg.log" 2>&1
  echo "$cfg: exit $?, $(grep -c '^## .* breaks$' "$here/out/$cfg/report.md" 2>/dev/null) rule(s) break"
done
