---
name: ayme-recorder
description: Record a user flow with the Ayme recorder while the user drives their app, then turn the Recording Package into Playwright page objects and a test.
---

# Ayme recorder

The Ayme recorder listens while the user drives their app in a browser, and
writes what it saw to a Recording Package: the page structure at each visit,
what changed and every interaction. From the package you write page objects and
a Playwright test that replays the flow.

1. **Record.** In the project's folder, run
   `npx @ayme-dev/cli@latest codegen <url>`, with the URL where the user wants
   to start, somewhere it can keep running. The recorder uses the Playwright
   the project has installed. It opens the page in Chromium with a recorder
   window beside it and a small toolbar on the page. Recording is off until the
   user presses Record; they perform the flow and press Finish. The command
   then prints `Recording package: <path>`. To record a Chromium the user
   already has running, run `codegen --cdp-endpoint <address>` instead, with
   the address of its DevTools protocol, such as `http://127.0.0.1:9222`.

   `@latest` runs the newest release. When `@ayme-dev/cli` is in the project's
   `package.json`, the project pins its version: run `npx ayme-recorder` in
   place of `npx @ayme-dev/cli@latest`. Check first that it is installed, with
   `npm ls @ayme-dev/cli`. When that fails, lists no version or marks the
   version `invalid`, ask the user to install the project's dependencies and
   wait: without the pinned copy, `npx ayme-recorder` runs a different
   version, or looks on npm for a package of that name, which is not this CLI.

2. **Read** the package, as [Read the package](#read-the-package) describes.
   Leave every discarded entry out of the page objects and the test. A package
   with no kept entry has no flow to implement: tell the user whether it
   captured nothing or every entry is a stub, and stop.
3. **Propose** the page objects and the test to the user before you write any
   file, following
   [Write page objects from the recording](#write-page-objects-from-the-recording)
   and [Write the test](#write-the-test). Settle it with them.
4. **Write** what you agreed, following
   [Page object design](references/page-object-design.md). Where it conflicts
   with the project's existing POM and test conventions, raise the conflict
   with the user.
5. **Run** the test until it passes. Fix locators and timing without changing
   the flow: when passing would take different steps or different checks, for
   example because the app no longer behaves as recorded, stop and tell the
   user.

Done when the test passes against the app and replays the flow you agreed.
A package with no kept entry is done when you have told the user and stopped.

## Read the package

The package is YAML-style text; it may not parse as YAML. Its outline:

```text
recordingId: rec_…
mode: structural
createdAt: 2026-…               # when the recording was stored
url: https://…                  # where the recording started
tracePath: .ayme/recordings/rec_…/trace.zip   # relative to where codegen ran
visits:                         # one per page load
  - visitId, url, cause
    baselineTree:               # the page just before the first interaction
    timelineEntries:            # in order
      - kind: interaction       # or `change`
        timestamp
        discarded: true         # a stub only; absent on a kept entry
        interaction:            # stub: id, type. Kept adds targetRef, values
        changeTree:             # a kept entry, only when something changed
traceActionPoints:              # where the trace holds each interaction
  - interactionId, pageId, beforeSnapshotId, afterSnapshotId, …
```

A package made by the 0.1 recorder differs in a few places; see
[Packages from the 0.1 recorder](#packages-from-the-01-recorder).

Nodes carry no locators. An interaction's `targetSelector` identifies its
target; read any other locator from the trace, as
[Use the trace](#use-the-trace) describes.

A ref, such as `e5`, names a node within this package. Refs link an
interaction to its target and a change to the node it changed; they never go
into code, and the trace does not carry them. An element keeps its ref for
the whole visit, also when the app re-creates it: a button the page re-renders
after a click is still `e5`. Refs are per visit: the same ref in another visit
is another element. A ref can carry a frame prefix, such as `f1e4`; copy refs
as they are written.

A `changeTree` holds only the paths down to what changed. `<added>`,
`<removed>` and `<changed>` mark nodes that appeared, disappeared, or changed
their own content or state; an unmarked node is only the path to a change
below it.

```text
- [ref=e1]:
  - <changed> [ref=e3] paragraph: "Items: 2"
  - <added> [ref=e9] button "Remove item"
  - <removed> [ref=e7] paragraph: "Your cart is empty"
```

An interaction names its target by `targetRef`, a node in the visit's baseline
tree or one `<added>` earlier in the same visit, or a node a discarded change
added; [Discarded entries](#discarded-entries) says how to read that one. Its
other fields, such as a fill's `text`, are the values the user entered.

```text
interaction:
  id: interaction_3
  type: fill
  targetRef: e11
  targetSelector: '[data-test="username"]'
  text: standard_user
```

`targetRef` and `targetSelector` can name different elements. When the
element the user acted on is not in the tree, such as an icon inside a
button, `targetRef` is its nearest ancestor the tree lists, while
`targetSelector` still names the element itself. `targetRef` is `null` with
the selector present in two cases: an `assert*` interaction, whose target the
recorder knows only by its selector, and a key pressed while nothing on the
page had focus.

A `kind: change` entry is a change the recorder could not tie to an
interaction. It is usually the late result of an earlier step, such as data
that finished loading. Just before a click it is often the focus moving to the
clicked element, as the mouse button goes down before the click. A change no
recorded action explains can also come from a hover, or from anything the page
does on its own in between, such as an async update. Read it together with the
steps around it.

## Discarded entries

The user can discard a whole interaction or unassigned change. It stays in the
timeline, in order, as a stub:

```text
- kind: interaction
  timestamp: 100
  discarded: true
  interaction:
    id: interaction_1
    type: fill
- kind: change
  timestamp: 150
  discarded: true
```

A stub has no target, entered value or `changeTree`. When a kept step depends
on one, ask the user how the flow should reach it.

A kept `targetRef` can name an element a discarded entry added. The trace
still has the page before and after a discarded interaction: find its
`interactionId` in `traceActionPoints` and open those position numbers, as
[Use the trace](#use-the-trace) describes. A discarded `kind: change` has no
entry there: open the `afterSnapshotId` of the interaction before it, or the
`beforeSnapshotId` of the one after it.

## Write page objects from the recording

Draft the test from the timeline first, then the smallest set of page objects
that can express it. When a step or a check cannot be expressed, change the
page objects, never the check. Design them by
[Page object design](references/page-object-design.md); the package shows its
evidence:

- Each visit is a page, by its URL path.
- A boundary that appears or disappears is an `<added>` or `<removed>`
  subtree in a Change Tree.
- A repeated structure shows as sibling subtrees of one shape.
- Part of the page that every visit repeats, such as a header, is the same
  element on every page.
- An action's parameters are the values the user entered, or derived from elements the user interacted with.

A recording shows one outcome of each action. When the app can end it another
way, such as with a validation error, and the recording does not show how to
tell the outcomes apart, ask the user before writing a return that depends on
the outcome.

Target selectors are candidates. Check each by
[Locator strategy](references/page-object-design.md#locator-strategy) and keep
one that meets it. Look in the trace for an element that has no candidate, or
whose candidate does not meet the strategy.

## Write the test

One test replays the flow in recorded order, with no steps the user did not
take and no branching. Every step goes through a page object action or one of its named locators, and
every check through a page object locator or method. When an action returns one of
several page objects, assert the one the recorded flow reached, such as
`assert(page instanceof ProjectPage)` from `node:assert`, rather than branching on it.

Turn the timeline into assertions:

- Assert what a step caused beyond the element it acted on: something appears,
  disappears or is replaced, a count changes, a page opens.
- Assert a value or choice the user entered or interacted with when it shows up somewhere else or
  later, such as an added item in the cart.
- Leave out the acted element's own change, such as a filled value, focus or a
  checked box, what the page already showed, and changes unrelated to the
  flow, such as animations or clocks.
- An `assert*` interaction, such as `assertVisible`, marks a point where the
  user checked something: from its `targetSelector` and the changes around
  it, work out what they meant to check, and assert that.
- Each assertion checks one fact. A replaced element is two facts: the old one
  is gone and the new one is visible.
- Steps that only change their own element, such as filling the fields of one form, need no
  assertions in between; assert after the step that submits it.

## Use the trace

The recording's trace holds a DOM snapshot of the page before and after each
recorded interaction, with the real elements and their attributes. Read it
when a tree does not settle what a step did, or to find a locator for an
element. Open it with the project's own Playwright, `npx playwright trace`,
run in the project's folder. The tool keeps the trace it opened in that
folder, so run every command of one lookup from there.

`traceActionPoints` says where each interaction is in the trace. Its
`beforeSnapshotId` and `afterSnapshotId` are position numbers, the numbers the
tool's `trace actions` list prints. Find the interaction's `interactionId`
there and pass the number to `trace snapshot`. Open both with the `after`
phase: each number points at a small step the recorder made just after
reading the page, so its `after` is the page at that moment. The flag that
picks the phase is `--phase` from Playwright 1.63 and `--name` on 1.62; check
the version with `npx playwright --version`.

```sh
npx playwright trace open .ayme/recordings/rec_…/trace.zip   # the package's tracePath
npx playwright trace snapshot 44 --phase after \
  eval "Object.fromEntries(['#count', 'button#add', 'main [data-test=\"cart\"]'].map(selector => [selector, document.querySelector(selector)?.cloneNode(false).outerHTML ?? null]))" \
  | sed -n '/^### Result/,/^### Ran/{//!p;}'
npx playwright trace close
```

```json
{
  "#count": "<p id=\"count\"></p>",
  "button#add": "<button id=\"add\"></button>",
  "main [data-test=\"cart\"]": null
}
```

`eval` runs the expression in the page of the snapshot and prints a report,
with the value between `### Result` and `### Ran Playwright code`; the `sed`
keeps only the value. `cloneNode(false)` returns an element's own tag and
attributes without its content; read `outerHTML` directly when you need what
is inside. An element the selector does not find comes back as `null`.

Each `trace snapshot` call takes about six seconds, because the tool starts a
browser to draw the snapshot. Collect everything you need from one snapshot
first, then read it in a single call, as above: one `eval` can return many
elements.

The trace does not carry the package's refs. Find an element by what the
package says of it:

- An interaction's target: its `targetSelector`. A CSS selector, such as
  `[data-test="username"]`, goes into `querySelector` as it is. A
  Playwright selector such as `internal:role=button[name="Add item"i]` does
  not: match the role and the name, for example
  `[...document.querySelectorAll('button')].filter(e => e.textContent.trim() === 'Add item')`.
- Any other node: its role, name and text in the tree, and its ancestors.
- A `targetRef` that is the nearest listed ancestor of the element the user
  acted on: read both, the element by `targetSelector` and the ancestor by its
  role and name, in the same call.

`trace snapshot <number> --phase after snapshot` prints the page structure of
a snapshot with refs of its own; they are not the package's refs.

A click that leaves the page has a `beforeSnapshotId` and no
`afterSnapshotId`: its result is the next visit's baseline. An `assert*`
interaction has the same number in both. A pause is still part of the trace:
what the user did while recording was stopped, typing included, can show in
its screenshots and in later snapshots.

## Packages from the 0.1 recorder

A package made by the 0.1 recorder, `@ayme-dev/cli` 0.1, has text such as
`after@interaction_3` in `beforeSnapshotId` and `afterSnapshotId` rather than
a number. Read it with these differences:

- Its trace opens only with that recorder's own trace command, not with
  `npx playwright trace`: `npx @ayme-dev/cli@0.1 trace open latest`, then
  `npx @ayme-dev/cli@0.1 trace snapshot <interaction id> --name after eval …`,
  named by the interaction's `id`. An interaction's `before` cannot be read.
- In its trace each element carries its package ref as the attribute
  `__playwright_aria_ref__`, so `[__playwright_aria_ref__="e44"]` finds the
  node `e44` of that interaction's visit.
- An element the app re-created got a new ref: the same button can be `e44`,
  then `e137` after a click.
- Some nodes have a `/locator:` line with a Playwright locator for that node:
  a candidate, like a target selector.
