---
name: ayme-recorder
description: Record a user flow with the Ayme recorder while the user drives their app, then turn the Recording Package into Playwright page objects and a test.
---

# Ayme recorder

A recording package is the flow the user kept: each page visit, what changed,
and every interaction, with a Playwright trace beside it. From the kept entries
you write page objects and a test that replays that flow.

1. **Record.** Run `npx @ayme-dev/cli codegen <url>` from the project and leave
   it running. The user drives the app. When they finish, the command prints
   `Recording package: <path>`.
2. **Read** the package, as [Read the package](#read-the-package) describes.
   Leave every `discarded: true` entry out of the page objects and the test.
   A package with no kept entry has no flow: tell the user whether it captured
   nothing or every entry is a stub, and stop.
3. **Propose** the page objects and the test before you write a file, following
   [Write page objects](#write-page-objects) and
   [Write the test](#write-the-test). Settle it with the user.
4. **Write** what you agreed, following
   [Page object design](references/page-object-design.md). Where it conflicts
   with the project's conventions, raise the conflict.
5. **Run** the test until it passes. Fix locators and timing without changing
   the flow. When passing would take different steps or checks, stop and tell
   the user.

Done when the test passes and replays the flow you agreed. A package with no
kept entry is done when you have told the user and stopped.

## Read the package

The package is YAML-style text. It may not parse as YAML.

```text
recordingId: rec_…
mode: structural
createdAt: 2026-…
url: https://…                  # where the recording started
tracePath: .ayme/recordings/rec_…/trace.zip   # relative to where codegen ran
visits:
  - visitId, url, cause         # one per page load
    baselineTree:               # the page as first seen
    timelineEntries:            # in order
      - kind: interaction       # or `change`
        timestamp
        discarded: true         # a stub only; absent on a kept entry
        interaction:            # stub: id, type. Kept adds targetRef and values
        changeTree:             # a kept entry, only when something changed
traceActionPoints:              # snapshot ids and times; not how you find an action
```

A ref names a node in this package. Each visit numbers its nodes from scratch,
and a node the app re-renders gets a new ref, so the same button can be `e44`
and later `e137`. After a full page load a ref can have a frame prefix, such
as `f1e4`. Copy refs as written. Refs never go into code.

Nodes carry no locators. A kept interaction's `targetSelector` is one candidate
for its target. Older packages also have `/locator:` lines under some nodes.
Choose a locator by
[Locator strategy](references/page-object-design.md#locator-strategy), and read
another candidate from the trace when the tree does not settle it.

A `changeTree` holds only the paths down to what changed. `<added>`,
`<removed>` and `<changed>` mark a node that appeared, disappeared, or changed
its own content or state. An unmarked node is only the path to a change below
it.

```text
- [ref=e25]:
  - <added> [ref=e137] button "Cart, 2 items":
    - <changed> [ref=e45]:
      - text: 2
  - <removed> [ref=e44] button "Cart, 1 items"
```

A kept interaction's `targetRef` is a node in the visit's baseline, a node
`<added>` earlier in that visit, or a node a discarded change added. For the
last of those, read the ref from the trace as
[Discarded entries](#discarded-entries) describes. Other fields, such as a
fill's `text`, are the values the user entered.

```text
interaction:
  id: interaction_3
  type: fill
  targetRef: e11
  targetSelector: '[data-test="username"]'
  text: standard_user
```

A `kind: change` entry belongs to no interaction. Read it with the entries
around it, and do not assume it comes after the step that caused it.

## Discarded entries

A discarded entry stays in the timeline, in order, as a stub. It has `kind`,
`timestamp` and `discarded: true`. An interaction stub also has
`interaction.id` and `interaction.type`. It omits the target, the entered
value and the `changeTree`. A kept entry has no `discarded` field.

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

Leave the stub out of the page objects and the test. The trace still has that
action under `interaction.id`. When a kept `targetRef` names an element this
package no longer spells out, open it with `trace action <interaction.id>` and
`trace snapshot <interaction.id>`, as [Use the trace](#use-the-trace) describes.
A discarded `kind: change` has no action: use a snapshot already in the trace,
or the next visit's baseline.

When a kept step depends on a discarded one, ask the user how the flow should
reach it. A package of only stubs is valid, trace included, and names no flow.
A package with no timeline entries captured nothing.

## Write page objects

Draft the test from the kept entries, then the smallest set of page objects
that can express it. When a step or a check cannot be expressed, change the
page objects, never the check. Design them by
[Page object design](references/page-object-design.md). The package shows the
evidence:

- A visit is a page, by its URL path.
- A boundary that appears or disappears is an `<added>` or `<removed>` subtree.
- A repeated structure is sibling subtrees of one shape.
- A part every visit repeats, such as a header, is the same element on every
  page.
- An action's parameters are the values the user entered, or values taken from
  elements the user interacted with.

A recording shows one outcome of each action. When the app can end it another
way, such as a validation error, and the recording does not show how to tell
the outcomes apart, ask the user before writing a return that depends on the
outcome.

## Write the test

One test replays the kept entries in recorded order, with no steps the user
did not take and no branching. Every step goes through a page object action or
one of its named locators, and every check through a page object locator or
method. When an action returns one of several page objects, assert the one the
flow reached, such as `assert(page instanceof ProjectPage)` from `node:assert`.

From the kept entries:

- Assert what a step caused beyond the element it acted on: something appears,
  disappears or is replaced, a count changes, a page opens.
- Assert a value or choice the user entered when it shows up somewhere else or
  later, such as an added item in the cart.
- Leave out the acted element's own change, such as a filled value, focus or a
  checked box, what the page already showed, and changes outside the flow,
  such as animations or clocks.
- A kept `assert*` interaction, such as `assertVisible`, is a point the user
  checked. From its target and the changes around it, assert what they meant.
- Each assertion checks one fact. A replaced element is two: the old one is
  gone, and the new one is visible.
- Steps that only change their own element, such as filling one form, need no
  assertion between them. Assert after the step that submits the form.

## Use the trace

Pass the interaction `id` to `trace action` and `trace snapshot`. That id is
the action's own id. `trace actions` also numbers rows from 1, and that counter
is not the id.

```sh
npx @ayme-dev/cli trace open latest    # or a recording id, or the trace.zip path
npx @ayme-dev/cli trace actions
npx @ayme-dev/cli trace action interaction_1
npx @ayme-dev/cli trace snapshot interaction_1 --name after \
  eval "document.querySelector('[__playwright_aria_ref__=\"e11\"]').outerHTML"
npx @ayme-dev/cli trace close
```

`trace action <id>` prints that action's parameters, including its selector,
entered value and ref, and the snapshot phases it names. `trace actions` prints
a counter, the elapsed time, the title and the duration, then a locator. It
does not print the action id. The same title can appear on more than one row,
and the elapsed time is not the entry's `timestamp` or a `traceActionPoints`
time.

`trace snapshot <id>` loads a snapshot named `input@<id>`, `before@<id>` or
`after@<id>`, in that order. `--name after` selects the after snapshot. A phase
`trace action` names is openable only when a snapshot has that name. When the
command reports that no snapshot was found, use the next visit's baseline, or a
snapshot from a kept action. A click that leaves the page has no after snapshot.
Its result is the next visit's baseline.

The `[ref=…]` labels in that snapshot are not the package refs. The package
ref is the `__playwright_aria_ref__` attribute, including a frame prefix when
the package has one. An `s_*` ref is not in the trace: reach that element from
its nearest ancestor with an `e` ref, such as
`[__playwright_aria_ref__="e58"] img`.
