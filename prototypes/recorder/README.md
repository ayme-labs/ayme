# Structural recorder prototype (throwaway)

> **Published copy.** This folder is a primary source for the recorder rebuild spec and is not meant to merge.
> Local paths were replaced with the placeholders `<scratchpad>`, `<repo>`, `<home>` and `<session>`, and the
> Playwright trace archives were left out. Scripts whose defaults pointed at those paths need `AYME_PW_ROOT`
> (a folder of stock Playwright installs, one `pw-<version>` each), and the format check also needs
> `AYME_SCRATCH` and `AYME_RELEASED_EXPORT`. Run a recording again to get a trace.

A recording is a list of human interactions with the page, each with a Change
Tree. Interactions come from stock Playwright's own recorder in API mode, trees
from the public `page.ariaSnapshot({ mode: 'ai' })`, Change Trees from core's
reconcile and renderers. No fork, no bundled Playwright, no AI.

## Setup

```sh
devbox run -- pnpm install --frozen-lockfile
devbox run -- pnpm --filter @ayme-dev/core build   # the prototype imports packages/core/dist
```

Playwright is not a dependency. It is loaded from a stock install by version:
`<AYME_PW_ROOT>/pw-<version>/node_modules/playwright-core` (default root: the
scratchpad `fork-experiments` directory named in `lib/pw.mjs`), or from
`AYME_PW_DIR=<any playwright-core directory>`.

## Modes

| mode     | what it adds                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------- |
| `after`  | one public snapshot after each interaction settles                                                    |
| `before` | the action's own event snapshot splits changes into "before the interaction" and "by the interaction" |
| `gate-a` | the gate: the human's input is swallowed from pointerdown on, snapshot, re-sent                       |
| `gate-b` | the gate: only the final click is swallowed, snapshot, re-sent without a second press and release     |

## Record by hand (headed)

```sh
devbox run -- node prototypes/recorder/record.mjs --mode gate-b                 # the local fixture
devbox run -- node prototypes/recorder/record.mjs --mode gate-a --url edge       # the gate edge-case page
devbox run -- node prototypes/recorder/record.mjs --mode before --url https://www.saucedemo.com --only-host saucedemo.com
```

Each interaction is printed as it is recorded, and `out/manual-<mode>.json` and
`.txt` are rewritten after each one (`--out <file.json>` to choose). The
recording ends when you press Enter in the terminal, close the last page, close
the browser or interrupt. `--pw 1.62` picks the Playwright version.

In gate-b mode, `--package <root>` also writes the released Recording Package
with a stock trace to `<root>/.ayme/recordings/<id>/` (see below).

## Compare the modes on a scripted flow

```sh
devbox run -- node prototypes/recorder/compare.mjs                                   # fixture, 1.65
devbox run -- node prototypes/recorder/compare.mjs --pw 1.62
devbox run -- node prototypes/recorder/compare.mjs --flow saucedemo
devbox run -- node prototypes/recorder/compare.mjs --flow saucedemo-bare-cart-link
```

Writes `out/<flow>-<mode>-pw<version>.json` and `.txt` per mode, and
`out/compare-<flow>-pw<version>.md` with the Change Trees side by side.
`--modes after,gate-b` limits the modes, `--headed` shows the browser.

## Write the released Recording Package

```sh
devbox run -- node prototypes/recorder/record-package.mjs --check            # SauceDemo, 1.65
devbox run -- node prototypes/recorder/record-package.mjs --pw 1.62 --check --root <dir>
devbox run -- node prototypes/recorder/record-package.mjs --flow fixture --check --root <dir>
devbox run -- node prototypes/recorder/check-package.mjs                                     # the stored package again, released code only
```

Records a scripted flow in gate-b mode (default `saucedemo-cart`: log in, add an
item, open the cart, remove it) and stores it as the released recorder does:
`<root>/.ayme/recordings/<id>/package.yaml` and `trace.zip`, and
`<root>/.ayme/recordings/latest.yaml`. The default root is `skill-check/`.

- Traces are stock and unstamped. This engine trial rejects other stamp modes.
- The package keeps the released string fields `beforeSnapshotId` and
  `afterSnapshotId`, but their values are stock CLI positions. Open **after**
  phase for either marker (`--phase after` on 1.63+, `--name after` on 1.62).
  Typing's before position is the preceding public DOM, not its event snapshot.
- `--check` runs the released recorder's own schema, text renderer, document
  renderer, store and trace-target code over the recording. They are bundled
  from the read-only export of the released sources (`AYME_RELEASED_EXPORT`,
  default in `check-package.mjs`) into the scratchpad (`AYME_SCRATCH`); nothing
  of them is copied here.
- What the check needs beyond the package lands in `out/package/<id>/`.

`skill-check/` holds the result of following the shipped `ayme-recorder` skill
on that package: page objects, one test, and the package it was written from.
It needs `@playwright/test` from outside this repository:

```sh
npm install --prefix <dir> @playwright/test@1.65.0
cd prototypes/recorder/skill-check && NODE_PATH=<dir>/node_modules node <dir>/node_modules/@playwright/test/cli.js test
```

## Probes

```sh
devbox run -- node prototypes/recorder/probes/shape.mjs 1.65           # core on public snapshots; event vs public shape
devbox run -- node prototypes/recorder/probes/gate-edge.mjs 1.65       # what the gate breaks, per variant
devbox run -- node prototypes/recorder/probes/lag.mjs 1.65 2000        # added input lag (pause between inputs in ms)
devbox run -- node prototypes/recorder/probes/saucedemo-cart.mjs 1.65  # is SauceDemo's cart link in the tree?
devbox run -- node prototypes/recorder/probes/package-edges.mjs 1.65   # a re-created target; refs after a full page load
```

`AYME_CHANNEL=chromium` runs any of them in the full browser's new headless
mode instead of the headless shell. `AYME_DEBUG=1` prints the classifier's
inputs per interaction.

## Files

- `lib/pw.mjs`: loads stock Playwright, starts its recorder across versions.
- `lib/core.mjs`: core session, ledger-based first-ref projection, trees and renderers.
- `lib/recorder.mjs`: the recorder and the four modes.
- `lib/classify.mjs`: the free "before" (event snapshot as classifier).
- `lib/gate.mjs`: the gate, both variants.
- `lib/targetHint.mjs`: places a target that is not in the tree on its nearest ancestor.
- `lib/package.mjs`: the Recording Package text, its JSON document, storing, the trace action points.
- `lib/stamp.mjs`: historical stamping experiments; not used by this engine trial.
- `record-package.mjs`, `check-package.mjs`: record a flow as a package; check it with the released code.
- `lib/settle.mjs`: the settle rule.
- `lib/human.mjs`: plays the human with raw CDP input.
- `lib/fixture.mjs`, `lib/flows.mjs`: the test pages and scripted flows.

## Session/trace engine round and reader kit

```sh
devbox run -- node prototypes/recorder/probes/package-edges.mjs 1.65
devbox run -- node prototypes/recorder/probes/package-edges.mjs 1.62
# Run shape.mjs on every supported trial minor: 1.62, 1.63, 1.64, 1.65.
devbox run -- node prototypes/recorder/probes/shape.mjs 1.65
devbox run -- node prototypes/recorder/check-package.mjs --root prototypes/recorder/reader-kit
devbox run -- node prototypes/recorder/probes/trace-positions.mjs prototypes/recorder/reader-kit 1.65
devbox run -- node prototypes/recorder/probes/trace-positions.mjs prototypes/recorder/out/stock-162 1.62
devbox run -- python3 prototypes/recorder/probes/compare-released.py
```

`reader-kit/` is a fresh SauceDemo flow, package + untouched trace, with a copy
of the consumer skill. **The reader check has not run.** Its README and
CHANGES say what to hand a fresh reader. `out/engine-checks/` holds verified
outputs. `out/released-comparison.md` compares every field and includes a full
raw diff against the owner's released package. See FINDINGS for limitations,
especially omitted target refs vs the released JSON schema and ambiguous
ref-less siblings.

To make another kit recording (creates a new id; does not rewrite the copied
skill's example archive path):

```sh
devbox run -- node prototypes/recorder/record-package.mjs --root <new-root> --check
devbox run -- node prototypes/recorder/record-package.mjs --pw 1.62 --root <new-root-162> --check
```
