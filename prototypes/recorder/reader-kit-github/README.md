# Reader check kit: GitHub

Start from `.ayme/recordings/latest.yaml` (same bytes as the recording's
`package.yaml`). The package is YAML-style text, not necessarily parseable YAML.
Use the copied `ayme-recorder/SKILL.md` and its `references/`.

Recording: `rec_20261112T151741510Z`, stock Playwright 1.65.0, Chromium, recorded
by a person in a visible browser on https://github.com/ayme-labs/ayme, not signed
in. Eight interactions over five visits: open Pull requests, check a pull
request is listed, go back to the repository, open Releases, check a release is
listed, go back, open the Code menu, choose "Clone with GitHub CLI". The page is
live: counts and titles on it can have changed since the recording.

`tracePath` is relative to this directory. Run `npx playwright trace` from a
stock 1.65 install. No refs were stamped into the trace. The two snapshot-id
fields of a trace point are position numbers for that tool; always open a
position's **after** phase. A missing after position means the interaction left
the page; use the next visit's baseline.
