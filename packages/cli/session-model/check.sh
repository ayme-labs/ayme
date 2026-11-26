#!/bin/sh
# Regenerates the rules files and checks the session model against each one.
# Usage, from the repository root: sh packages/cli/session-model/check.sh OUT_DIR
# OUT_DIR must not exist yet; each run writes OUT_DIR/<focus>/report.md.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
out=${1:?give a new output folder}
mkdir "$out"
node "$here/rules.mjs"
(cd "$root" && pnpm exec prettier --log-level warn --write "$here"/*.rules.json)
status=0
for focus in runs lifecycle ids; do
  sh "$root/.agents/skills/stately/scripts/stately-check" check "$here/session.json" \
    --rules "$here/$focus.rules.json" --out "$out/$focus" --compact || status=$?
done
exit "$status"
