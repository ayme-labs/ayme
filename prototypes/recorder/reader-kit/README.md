# Reader check kit — not yet run

Start from `.ayme/recordings/latest.yaml` (same bytes as the recording's
`package.yaml`). The package is YAML-style text, not necessarily parseable YAML.
Use the copied `ayme-recorder/SKILL.md` and its `references/` for the later fresh
reader check. `CHANGES.md` lists the copy's edits and the unchanged wording
that conflicts with this trial. Do not infer that a reader check has passed.

Recording: `rec_20261112T145047604Z`, stock Playwright 1.65.0, gate-b, Chromium
headless, raw CDP human input. Log in as `standard_user` / `secret_sauce`, add
Sauce Labs Backpack, open the cart, remove it. Eight recorder interactions,
three visits. No trace stamping, archive rewriting, polling or snapshot-on-change
observer. Tracing and structural output contain the entered test credentials.

`tracePath` is relative to this directory. Run `npx playwright trace` from a
stock 1.65 install; no dependency was added here. A stock 1.62 tool cannot read
this newer trace; the separate 1.62 engine run lives in `../out/stock-162/`.
The two snapshot-id fields contain CLI position strings; always open a marker's
**after** phase. Missing after means navigation; use the next visit's baseline.
Typing's before position is the preceding public DOM, not its event snapshot.

Only engine checks were performed: released schema/store/renderers and stock
trace position/DOM checks. Their logs are in `../out/engine-checks/`. No page
objects or test were written from this kit, and no agent followed its skill.
