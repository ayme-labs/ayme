---
name: ayme-recorder
description: Record a user flow with the Ayme recorder while the user drives their app, then turn the Recording Package into Playwright page objects and a test.
---

# Ayme recorder

The Ayme recorder listens while the user drives their app in a browser, and
writes what it saw to a Recording Package: the page structure at each visit,
what changed and every interaction. From the package you write page objects and
a Playwright test that replays the flow.

1. **Record.** Run `npx @ayme-dev/cli codegen <url>`, with the URL where the
   user wants to start, somewhere it can keep running. A recorder window opens
   on that page; the user performs the flow and presses Finish. The command
   then prints `Recording package: <path>`.
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
    baselineTree:               # the page as first seen
    timelineEntries:            # in order
      - kind: interaction       # or `change`
        timestamp
        discarded: true         # a stub only; absent on a kept entry
        interaction:            # stub: id, type. Kept adds targetRef, values
        changeTree:             # a kept entry, only when something changed
traceActionPoints:              # the interactions the trace holds
```

Nodes carry no locators. An interaction's `targetSelector` identifies its
target; read any other locator from the trace, as
[Use the trace](#use-the-trace) describes. Packages from older recorder
versions also have `/locator:` lines under some nodes, with a Playwright
locator for that node.

A ref names a node within this package. Each visit numbers its nodes anew, and
a node the app re-renders gets a new ref: the same button can be `e44`, then
`e137` after a click. Refs link an interaction to its target, and a node to its
element in the trace; they never go into code. After a full page load a ref
can carry a frame prefix, such as `f1e4`, because Playwright renumbers the
main frame's refs; copy refs as they are written.

A `changeTree` holds only the paths down to what changed. `<added>`,
`<removed>` and `<changed>` mark nodes that appeared, disappeared, or changed
their own content or state; an unmarked node is only the path to a change
below it.

```text
- [ref=e25]:
  - <added> [ref=e137] button "Cart, 2 items":
    - <changed> [ref=e45]:
      - text: 2
  - <removed> [ref=e44] button "Cart, 1 items"
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

A `kind: change` entry is a change the recorder could not tie to an
interaction. It is usually the late result of an earlier step, such as data
that finished loading. It can also come before the interaction that caused
it, because the recorder can see the page change before it records the click
behind the change. A change no recorded action explains can also come from a
hover, or from anything the page does on its own in between, such as an async
update. Read it together with the steps around it.

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

A kept `targetRef` can name an element a discarded change added. The trace still
has the discarded interaction's action, under its `interaction.id`: open it
with `trace action <interaction.id>` and `trace snapshot <interaction.id>`, as
[Use the trace](#use-the-trace) describes. A discarded `kind: change` has no
action: use a snapshot already in the trace, or the next visit's baseline.

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

Target selectors, and `/locator:` lines in older packages, are candidates.
Check each by [Locator strategy](references/page-object-design.md#locator-strategy)
and keep one that meets it. Look in the trace for an element that has no
candidate, or whose candidate does not meet the strategy.

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
  user checked something: from its target and the changes around it, work out
  what they meant to check, and assert that.
- Each assertion checks one fact. A replaced element is two facts: the old one
  is gone and the new one is visible.
- Steps that only change their own element, such as filling the fields of one form, need no
  assertions in between; assert after the step that submits it.

## Use the trace

This recording has an untouched stock Playwright 1.65 trace and no stamped
package refs. Use the stock trace tool from the user's installed Playwright
(the commands below run from this kit's directory). Read it when a tree does
not settle what a step did, or to find a locator for an element.

Each `beforeSnapshotId` or `afterSnapshotId` in `traceActionPoints` is a
position number accepted by that stock tool. Select the position from the
interaction's point in the package; do not use its `interaction.id`. Both
positions refer to the **after phase of a no-op marker call**: use `--phase
after` for both. On Playwright 1.62 the same flag is `--name after`.

```sh
npx playwright trace open .ayme/recordings/rec_20261112T145047604Z/trace.zip
# Example: interaction_6's afterSnapshotId is "107"; read the package first.
npx playwright trace snapshot 107 --phase after \
  eval "Object.fromEntries(['[data-test=\"shopping-cart-link\"]', '[data-test=\"remove-sauce-labs-backpack\"]'].map(selector => [selector, document.querySelector(selector)?.outerHTML ?? null]))" \
  | sed -n '/^### Result/,/^### Ran/{//!p;}'
npx playwright trace close
```

Find elements by the interaction's `targetSelector` and the tree's role and
name. A CSS selector can be queried directly as above; translate a recorder
`internal:role` selector to a Playwright role/name locator. For another node,
match its role, name, content and ancestors to the replayed snapshot, then
inspect the matching element's attributes. Package refs, including `s_*`,
are only package identities: replay refs are numbered afresh and cannot be
used to find those elements. No `__playwright_aria_ref__` attributes were added.

Each snapshot call takes several seconds. Batch all selectors needed from
one snapshot into one call. `cloneNode(false).outerHTML` gives only tag and
attributes; `outerHTML` includes children. Missing elements return `null`.

A target may be represented by its nearest ancestor in the tree; keep the
recorded selector and inspect the actual control and its ancestors together.
An interaction that leaves the page has a before position and no after
position; its result is the next visit's baseline. Typing's before position
is the preceding public DOM snapshot, while its before-tree is reconstructed
from the recorder event: late changes between them may be absent in the DOM.
