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

## Read the package

The package is YAML-style text; it may not parse as YAML. Its outline:

```text
recordingId: rec_…
tracePath: …/trace.zip
visits:                         # one per page load
  - visitId, url, cause
    baselineTree:               # the page as first seen
    timelineEntries:            # in order
      - kind: interaction       # or `change`
        timestamp
        interaction:            # id, type, targetRef, values
        changeTree:             # only when something changed
traceActionPoints:              # the interactions the trace holds
```

`/locator:` lines under a node are Playwright locators for it. An `s_*` node
has one only when an action targeted it.

A ref names a node within this package. Each visit numbers its nodes anew, and
a node the app re-renders gets a new ref: the same button can be `e44`, then
`e137` after a click. Refs link an interaction to its target, and a node to its
element in the trace; they never go into code.

A `changeTree` holds only the paths down to what changed. `<added>`,
`<removed>` and `<changed>` mark nodes that appeared, disappeared, or changed
their own content or state; an unmarked node is only the path to a change
below it.

```text
- [ref=e25]:
  - <added> [ref=e137] button "Cart, 2 items":
    - /locator: "locator('[data-test=\"shopping-cart-link\"]')"
    - <changed> [ref=e45]:
      - /locator: "locator('[data-test=\"shopping-cart-link\"]')"
      - text: 2
  - <removed> [ref=e44] button "Cart, 1 items"
```

An interaction names its target by `targetRef`, a node in the visit's baseline
tree or one `<added>` earlier in the same visit. Its other fields, such as a
fill's `text`, are the values the user entered.

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
behind the change. Read it together with the steps around it.

## Write page objects from the recording

Draft the test from the timeline first, then the smallest set of page objects
that can express it. When a step or a check cannot be expressed, change the
page objects, never the check. Design them by
[Page object design](references/page-object-design.md); the package shows its
evidence:

- Each visit is a page, by its URL path.
- A boundary that appears or disappears is an `<added>` or `<removed>`
  subtree in a Change Tree.
- A repeated structure shows as sibling subtrees of one shape, whose locators
  differ only in position.
- Part of the page that every visit repeats, such as a header, is the same
  element on every page.
- An action's parameters are the values the user entered, or derived from elements the user interacted with.

A recording shows one outcome of each action. When the app can end it another
way, such as with a validation error, and the recording does not show how to
tell the outcomes apart, ask the user before writing a return that depends on
the outcome.

Recorded locators are candidates. Check each by
[Locator strategy](references/page-object-design.md#locator-strategy), and look
for a better one in the trace.

## Write the test

One test replays the flow in recorded order, with no steps the user did not
take and no branching. Every step goes through a page object action, and
every check through a page object locator or method. When an action returns one of
several page objects, assert the one the recorded flow reached, such as
`expect(page).toBeInstanceOf(ProjectPage)`, rather than branching on it.

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

The trace holds a DOM snapshot after each recorded interaction, with the real
elements and their attributes. Read it when a tree does not settle what a step
did, or to find a better locator. Each element carries its package ref as
`__playwright_aria_ref__`, so you can look up a node from the timeline:

```sh
npx @ayme-dev/cli trace open <trace.zip path>
npx @ayme-dev/cli trace actions     # numbered actions with their locators
npx @ayme-dev/cli trace snapshot <number> --name after \
  eval "document.querySelector('[__playwright_aria_ref__=\"e45\"]').outerHTML"
npx @ayme-dev/cli trace close
```

Find an interaction's action number in `trace actions` by its type and
locator. A snapshot holds the refs of its own visit. An `s_*` ref is the
recorder's own and is not in the trace: reach that element from its nearest
ancestor with an `e` ref, such as `[__playwright_aria_ref__="e58"] img`.
