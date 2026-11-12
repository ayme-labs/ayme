# Findings: a structural recorder on stock Playwright

This prototype is throwaway code kept as a primary source. It is not meant to
merge into `main`. `README.md` says how to run it.

## The question

Can the Ayme recorder be rebuilt in this repository, on Ayme core and on
whatever stock Playwright the user has installed, without a Playwright fork and
without bundling Playwright? Scope: structural recording only, no AI.

## Verdict

Yes, with the limits below. The engine/session round verifies gate-b on stock
Playwright 1.62.1 and 1.65.0, headless Chromium: eight SauceDemo interactions,
three visits, released package checks passing. The earlier four-mode experiment
recorded 19 local-fixture interactions and seven SauceDemo interactions per mode.

Not verified: a recording made by a person in a visible browser. Every "human"
input was raw CDP input.

## The design that held up

- **Interactions** come from Playwright's own recorder in API mode. We write no
  capture of our own for action kind, value or selector.
- **Trees** come from the public `page.ariaSnapshot({ mode: 'ai' })`, called
  from Node. It covers iframes and open shadow roots.
- **Change Trees** come from core's tree, reconcile and renderers, unchanged.
  Core's tree parser already accepts frame-prefixed refs such as `f1e4`.
- **Before and after** around clicks and key presses come from the gate: an
  init script swallows the input, Node snapshots, re-sends the input through
  `page.mouse` or `page.keyboard`, and snapshots again after the page settles.
- **Typing, the native select and file upload** cannot be gated. For those, the
  snapshot inside the recorder's own event serves as the "before"
  (`lib/classify.mjs`). It is used only to split changes into "changed before
  the interaction" and "changed by the interaction".
- **A target that is not in the tree** is marked on its nearest ancestor that
  is, with the selector kept (`lib/targetHint.mjs`).
- Core observation session and identity ledger in Node; no own distillation of the tree, no polling.

## Gate variants

|                                     | A: swallow from `pointerdown` | B: swallow only the `click` |
| ----------------------------------- | ----------------------------- | --------------------------- |
| Drag, text selection, custom slider | broken                        | unchanged                   |
| Press held back until release       | yes                           | no                          |
| Effects of `pointerdown`            | attributed to the interaction | listed as changed before it |

B is the recommended variant. Its cost showed on 12 of 14 gated clicks, mostly
as a focus change listed before the interaction. Untested idea: treat focus as
always belonging to the interaction, as `lib/classify.mjs` already does.

Added lag per click, median, on 1.65: 13 to 16 ms on the test page, 10 to 16 ms
on SauceDemo, about 280 ms on a page with 12,000 elements. Nearly all of it is
the snapshot.

## What the modes gain

- After-only attributes a late change to an interaction that did not cause it,
  and loses a target that its own click removed (2 of 19 on the test page, 2 of
  7 on SauceDemo).
- The event snapshot as "before" fixes both, for the frame the action happened
  in. See `out/compare-late-typing-pw1.65.0.md`.
- The gate gives real refs for nodes that come and go, covers all frames, and
  needs no matching for the split.

## Private Playwright details this relies on

Each can change in a Playwright release and needs a check per supported version.

- The recorder API: `context._enableRecorder` through 1.63,
  `context._startRecording` from 1.64, and the shape of the action it reports.
- The event snapshot having the same shape as the public snapshot for the same
  frame. Verified line for line on both versions (`probes/shape.mjs`). The
  split depends on it.
- `_ariaRef`, the tag Playwright's recorder leaves on elements, read by
  `lib/targetHint.mjs`.
- The rule for which keys are a press and which are typing. In API mode a
  single character is typing only in an input, textarea or editable area.
- The overlay element `x-pw-glass`, hidden with a stylesheet.

## Limits found

- A menu that opens on `pointerdown` is attributed wrongly without gate A.
- The event snapshot covers one frame; changes in other frames go to the
  interaction.
- The re-send adds an extra key down and up of the modifier around a
  Shift+click or Control+a.
- Enter on a button yields two recorded actions, with or without the gate.
- An action's `ref` can be stale, not only null.
- Not tested: cross-origin iframes, CSS transforms on iframes, native pickers
  in a visible browser.

## SauceDemo cart link

The reported case of a target missing from the tree no longer reproduces: the
link now has a role and a label. The `saucedemo-bare-cart-link` flow removes
both in the local browser tab to recreate it. After-only then marks the wrong
element; the gate marks the nearest ancestor correctly.

## Engine/session round (2026-11-12)

Current results use **only gate-b, unstamped stock tracing and raw CDP human
input**. No archive rewriting, polling, snapshot-on-change observer or reader
check. The earlier `skill-check/` result used stamping; it is historical and
is not evidence for this reader kit.

### 1. Core's observation session: verified, with identity limits

The prototype now uses the publicly exported `StructuralObservationSession`
for visit registration, action starts/completions, observations, the identity
ledger and `readChange`. No source import was needed; core was not edited.
`lib/classify.mjs` still uses bare reconcile internally to reconstruct a
free-before tree, not to produce the package's final changes.

Core gives `resolve`/`sameIdentity`, but no first-ref accessor or tree projection.
`lib/core.mjs` therefore keeps a visit-scoped presentation map from raw refs
to the first observed ref, using **only ledger continuity** to carry it forward.
Package trees/targets use those refs; browser lookup still uses raw refs.

`probes/package-edges.mjs 1.65` and `1.62` assert:

- Playwright really gives the re-created Save button a different ref, yet its
  package target stays `e5`, the ref in the baseline.
- An unchanged, ref-less paragraph stays `s_2` throughout its visit.
- An unfocused F8 has selector `body` and no targetRef.
- The first cause is `initial`; navigation has no Change Tree.

Output: `PASS recreated Save keeps e5; stable paragraph keeps s_2 ...`.
Full outputs: `out/engine-checks/edges-165.txt` and `edges-162.txt`.

**Limits observed:** one ref-less paragraph becoming two identical siblings
has ambiguous lineage in core; neither can safely inherit its identity. The
probe reproduces this separately and prints `LIMIT core ledger ...`. Thus synthetic
stability holds for unambiguous lineage, not universally. Core documents its
ambiguity policy; this is a limitation, not a newly proven session bug.
A paragraph gaining text (and a browser ref) can also read as removed + added.
No core bug was patched. The known open issues were not fetched because this
trial permits no external service besides SauceDemo and npm.

The session drains identities in observation-registration order. Registering an
old before only at delayed recorder finalization let the next visit's baseline
get ahead of it; synthetic continuity then broke. Registering a gate before
**before replay** fixes the observed host ordering error. This does not prove
that every overlapping input/navigation race is solved.

### 2. Stock trace positions: verified on 1.65 and 1.62

Every public snapshot gets a serialized no-op `page.evaluate(() => 0)` marker
inside a unique tracing group. A gated input's before marker finishes before
replay; the after marker follows settling. A navigation keeps only its before.
The package retains the released **string** snapshot-id fields, containing CLI
position numbers, e.g. `beforeSnapshotId: "97"`, `afterSnapshotId: "107"` for
adding the backpack in the 1.65 kit. Neither contains an interaction id or
private snapshot name. Always open the marker's **after** phase, for both
fields. IDs such as `interaction_6` still identify interactions as the format
requires; only the snapshot lookup values changed.

The positions come from each version's own `npx --no-install playwright trace
actions`, in a temporary working directory. Raw event ordinals were tried and
were wrong: the CLI filters/orders actions. Asking the stock tool avoids
reimplementing that private rule. Nothing is written into the archive.

`probes/trace-positions.mjs <root> <version>` closes/reopens the trace and
asserts identical action ordering, re-derives the same package positions,
opens **all 14 available before/after points**, checks the selected call is the
marker, checks no stamped attributes exist, verifies cart state before/after
add and remove, and asserts the archive SHA256 is unchanged. Both versions
print `PASS <version>: 14 snapshot lookups; deterministic positions;
before/after cart state; trace SHA256 unchanged ...`.
Logs: `out/engine-checks/trace-{165,162}.txt`.

**Trace fidelity limit:** ungated typing/select/upload get a reconstructed
before-tree from their event snapshot. That event contains no DOM capture.
Their before position therefore opens the preceding public DOM snapshot,
which can miss intervening changes. The package format has no provenance field;
this fact is in side evidence and the copied skill, not an invented package
field. Exact event-time DOM would need additional input capture or browser
support; neither was added. The DOM and ARIA calls themselves are also separate
round trips, so an async page can change between them.

`probes/shape.mjs` now asserts event/public equality rather than only printing
it. It passed on **all trial-supported minors 1.62, 1.63, 1.64, 1.65**, in main
frame and iframe. `out/engine-checks/shape-*.txt` records the exact versions.
Future supported versions must run that check too. It covers a stable keypress
snapshot shape; it does not prove every action's timing or cross-origin frame.

### 3. Real released SauceDemo package: compared value by value

Reference: `rec_20261112T132544402Z`, supplied read-only. Fresh prototype:
`reader-kit/.ayme/recordings/rec_20261112T145047604Z/`.
`probes/compare-released.py` writes `out/released-comparison.md`: every header,
visit, interaction and trace-point value, normalized tree diffs, every
unassigned change, and a complete raw diff including **all refs and marks**.
After normalizing refs, all seven shared interactions' Change Trees match.
Differences and what closing them would take:

1. **Flow:** release has 12 interactions, including two credential double-clicks,
   two body copy keypresses, and a final `assertVisible`; prototype has eight,
   ending in Remove. Expected different human flow. Match inputs to close.
2. **Metadata/identity:** recording id, createdAt, tracePath, page guid and
   interaction numbering differ. Login targets are exactly `e11/e13/e15` in
   both; add target is `e65` vs `e66`, cart target is `e136` in both. Other
   baseline/added/image/synthetic refs differ by capture order; full raw diff
   lists them. Expected recording-local identity, not a format mismatch. A
   ref ledger is not a promise of equal numbers across recordings.
3. **Initial cause:** released `navigate`, prototype `initial`. Deliberately
   different per decision; no fix proposed.
4. **Page/body node:** login's released tree additionally has `[ref=e1]
   [active]` under its generic page wrapper. The public snapshot omits it.
   Release can therefore target `body` at e1; unfocused keypresses here keep
   the selector and omit targetRef. This is expected from public-only trees
   and the no-focus decision. Exact parity needs public body evidence or an
   explicit target-node augmentation decision; neither was invented here.
5. **Inventory baseline:** prototype catches transient menu wrappers/navigation
   (All Items, Dynamic Catalog, About, Logout, Reset App State, Close Menu),
   removed as an unassigned change at the next click. Release's baseline is
   later and already shows Add to cart active. Timing is verified; animation/
   capture-policy causation is an inference. Closing it needs matched capture
   timing or a stronger settle policy; no tree filtering was added.
6. **Cursor/focus marks:** cart's release baseline marks the outer page wrapper
   `[cursor=pointer]` and omits cursor marks on eight descendant controls/links;
   public output marks those descendants instead. Prototype adds focus before
   Remove; release stopped before that click. Other focus changes include
   release's extra body/credential steps. Public/fork capture differences are
   inferred for cursor placement; matching the raw captures is needed to
   isolate them. Preserve the mandated public snapshot rather than restyle it.
7. **Change entries:** release login has four unassigned focus changes; prototype
   login has three. Prototype inventory also has the menu-removal/add-focus
   entry; cart has Remove-focus and the Remove effect. Shared fills show the
   exact entered values, and add-to-cart has the same added/removed marks and
   content after ref normalization. Expected gate-b focus, differing inputs,
   and boundary sampling. Matching timing/inputs closes incidental differences;
   timer/observer history intentionally remains absent.
8. **Timestamps:** createdAt is wall time in both. Timeline and trace times are
   monotonic milliseconds in both, but release timeline timestamps often lag
   trace startedAt by about 500 ms; release endedAt equals startedAt for all
   12 points. Prototype timeline timestamp equals its startedAt, endedAt includes
   replay/settling (and typing updates). Every number is in the report.
   Different clock origins/durations are expected; timestamp semantic parity
   would need a separately agreed timestamp boundary, not copied numbers.
9. **Trace values:** release uses `observation@...` / `after@interaction_N`;
   prototype uses position strings and no stamps. Both omit after on navigation
   while retaining before. Expected explicit decision. Use the user's matching
   stock tool; the released CLI's older tool cannot read a stock 1.65 archive.

### 4. Released package checks: pass; missing-target exception is explicit

Both SauceDemo runs pass every existing `check-package.mjs` check: schema
acceptance with no dropped fields, released store/read/trace resolution and
file layout, valid target refs, byte-identical released text renderer and
equal document renderer output. `out/engine-checks/kit-{165,162}.txt` holds
in-process evidence; standalone checks also pass against both stored packages.
Check failures now set a failing process status in in-process runs too.

**Verified conflict:** the released `RecorderInteractionSchema` requires a
nullable targetRef; omitting it fails the JSON schema. `null` passes. The
released store reads the missing-ref package as opaque YAML-style text without
validation. The edge probe asserts all three facts. Its omitted-ref text still
renders byte-for-byte with the released text renderer, but the released JSON
validation/document path cannot accept that omission. Therefore the universal
“every interaction has a known targetRef” check no longer applies: it checks
only refs that exist. The no-focus decision and released JSON schema cannot
both hold without changing the schema or allowing an internal null. No schema
change was made; this remains a reported format finding. SauceDemo has no
missing targets and needs no exemption.

### 5. Reader kit: prepared, not read-tested

`reader-kit/` stores the fresh 1.65 package and untouched trace exactly in the
released recording layout, plus a copy of `skills/ayme-recorder/` including
references. Only its **Use the trace** section changed; all earlier bytes and
reference files are checked equal. `CHANGES.md` lists changed sentences and
why, including unchanged earlier wording that conflicts with this trial.
No fresh agent followed it; no POM/test was created or run from this kit.
The separate 1.62 recording is `out/stock-162/`.

### Documentation/code disagreements met

- The shipped skill says a re-render gets a new package ref and that refs link
  to trace elements; the session-backed engine retains first refs and stock
  replay refs do not match. Only the permitted copied section was changed.
- Earlier skill paragraphs open discarded actions by interaction id and its
  original trace section presumes stamps/`--name`; stock uses positions, and
  `--phase` from 1.63. The kit has no discarded entries.
- The skill's universal targetRef wording conflicts with the requested
  unfocused-key omission, while the released JSON schema requires null.
- The original prototype README recommended `--stamp private`, and its
  FINDINGS said no ledger, unstable refs and no real released package found.
  Those were prior-round facts; the current README/findings now reflect this
  round. Stamping/rewrite probe files remain historical, unused.

## Ending a hands-on recording

`record.mjs` now ends when the last page closes, and writes its output after
every entry. An interrupt used to lose the output because Playwright's own
SIGINT handler closes the browser and exits the process with 130 at once;
`record.mjs` launches with those handlers off. Not verified in a real
terminal, where Ctrl+C also reaches the browser: the trace may then be lost
while the package is still written.

## Still to decide

Decided since: a finished recording is the released Recording Package. Open:
which released features are in the first
version (recorder window, review of entries, `mcp` recording tools, attaching to
a running browser), the package and CLI, the supported Playwright range and the
behaviour on an untested version, the glossary terms, and whether to use Effect.
