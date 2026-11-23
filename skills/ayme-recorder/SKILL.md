---
name: ayme-recorder
description: Record a user flow with the ayme recorder while the user drives their app, then turn the Recording Package into Playwright page objects and a test, or a parameterised automation of the flow.
---

# ayme recorder

The ayme recorder listens while the user drives their app in a browser, and
writes what it saw to a Recording Package: the page structure at each visit,
what changed and every interaction.

Read `.ayme/CONVENTIONS.md` first, when it exists: what the user settled for
how ayme and its skills work in this repository. Read its opening part, which
holds for every skill, and its `Recorder` section, and follow a line that
points to another file. It overrides this skill's defaults.

1. **Record.** In the project's folder, run
   `npx @ayme-dev/cli@latest codegen <url>`, with the URL where the user wants
   to start, somewhere it can keep running. The recorder uses the Playwright
   the project has installed. It opens the page in Chromium with a recorder
   window beside it and a small toolbar on the page. Recording is off until the
   user presses Record; they perform the flow and press Finish. The command
   then prints `Recording package: <path>`. `.ayme/recordings/latest.yaml` is
   a copy of the newest package. To record a Chromium the user
   already has running, run `codegen --cdp-endpoint <address>` instead, with
   the address of its DevTools protocol, such as `http://127.0.0.1:9222`.

   When the user asked for an automation of a flow with new data, add
   `--start-recording`: the recorder then opens already recording, so the
   package holds the first page load, which the replay test needs. Tell the
   user not to press Clear or Stop during this recording: Clear throws the
   first page load away, and requests made while paused stay in the trace,
   where the replay can take them for the flow's own. To start over, the
   user presses Finish, and you run the command again. Use the browser the
   recorder opens: `--start-recording` does not apply with
   `--cdp-endpoint`, so a recording there never holds its first page load.

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
3. **Follow** the playbook the user's request calls for, and ask when it is
   unclear:
   - [Mirroring test](playbooks/mirroring-test.md): a test that replays the
     flow against the user's app.
   - [Production automation](playbooks/production-automation.md): a
     parameterised automation that does the flow with new data, such as data
     entry that ends in a real submission.

When the page objects should also become ayme tools, use the `ayme` skill,
which [Coding agent skills](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/coding-agent-skill.md#ayme) says how to install.

## Read the package

The package is YAML-style text; it may not parse as YAML. Its outline:

```text
recordingId: rec_…
mode: structural
createdAt: 2026-…               # when the recording was stored
url: https://…                  # where the recording started
tracePath: .ayme/recordings/rec_…/trace.zip   # relative to where codegen ran
visits:                         # one per page, from a load or a navigation to another path
  - visitId, url, cause
    baselineTree:               # the page just before the first interaction; with none, the last read
    timelineEntries:            # in order
      - kind: interaction       # or `change`
        timestamp               # see Timestamps below
        discarded: true         # a stub only; absent on a kept entry
        interaction:            # stub: id, type. Kept adds targetRef, values
        changeTree:             # a kept entry, only when something changed
traceActionPoints:              # where the trace holds each interaction
  - interactionId, pageId, beforeSnapshotId, afterSnapshotId, startedAt, endedAt
```

Timestamps are milliseconds on the monotonic clock of the recorder's Node
process, counted from when that process started; compare them only with each
other. An interaction's `timestamp`, and
its trace point's `startedAt`, is when its input reached the page; for typing,
a select or an upload, which the recorder does not hold back, it is when the
recorder read the page just before it. A `kind: change` entry's `timestamp` is
when the recorder read the page that showed the change. A trace point's
`endedAt` is when the interaction's "after" was read. A step that left the
page before the recorder read the page again has an `endedAt` but no
`afterSnapshotId`: its "after" is the next visit's. Typing that made the page
navigate after the recorder had read the page during it keeps that last read
of its own page as its "after", with its `afterSnapshotId` and `endedAt`.
With no "after" at all, `endedAt` equals `startedAt`.

A visit's `cause` is `initial` for the page the recording started on,
`navigate` for a page that went to another address, and `openPage` for a tab
or window that opened. The package does not say what made a page navigate.
When the last step of the visit before could have led there, such as a click
on a link or Enter pressed in a form, it did. When no step could have, the
user used the browser's Back or Forward button, reloaded or typed an address,
or the page redirected by itself. Ask the user which it was rather than guess.

A package made by the 0.1 recorder differs in a few places; see
[Packages from the 0.1 recorder](#packages-from-the-01-recorder).

Nodes carry no locators. An interaction's `targetSelector` identifies its
target; read any other locator from the trace, as
[Use the trace](#use-the-trace) describes.

A ref, such as `e5`, names a node within this package. Refs link an
interaction to its target and a change to the node it changed. They never go
into code, and the trace does not carry them. Refs are per visit: the same ref
in another visit is another element. Copy refs exactly as they are written.

An element keeps its ref for the whole visit while the page keeps it, also
when its name, text or state changes. When the page re-creates an element in
the same place with the same role and name, the recorder takes it for the
same element and it keeps its ref too: a button the page re-renders after a
click is still `e5`. An element the page re-creates with another name is a
new element to the recorder: it gets a new ref, and the old one is
`<removed>`.

A `changeTree` holds only the paths down to what changed. `<added>`,
`<removed>` and `<changed>` mark nodes that appeared, disappeared, or changed
their own content or state; an unmarked node is only the path to a change
below it. After the user adds a second item to the cart, the cart button
re-renders with a new name, the count changes and a button appears:

```text
- [ref=e1]:
  - <added> [ref=e9] button "Cart, 2 items"
  - <removed> [ref=e4] button "Cart, 1 items"
  - <changed> [ref=e3] paragraph: "Items: 2"
  - <added> [ref=e10] button "Remove item"
```

Here the page re-created the cart button, so it shows as a new button and a
removed one. Had the page kept the button and changed only its text, the tree
would show `<changed> [ref=e4] button "Cart, 2 items"` instead.

An interaction names its target by `targetRef`, a node in the visit's baseline
tree or one `<added>` earlier in the same visit, or a node a discarded change
added; [Discarded entries](#discarded-entries) says how to read that one. Its
other fields, such as a fill's `text`, are the values the user entered. A
click's `button` says which mouse button it was: `left`; `right` for a
right-click, which the user made to open a menu; or `middle` for a middle
click, as on a link to open it in a new tab. A middle click on a checkbox or
a radio is a `click` with `button: middle`, not a `check`: it checks nothing.
Its `clickCount` is 2 for a double click.

```text
interaction:
  id: interaction_3
  type: fill
  targetRef: e11
  targetSelector: '[data-test="username"]'
  text: standard_user
```

`targetRef` and `targetSelector` name the element the user acted on: for a
click on the text or an icon inside a link or a button, the link or the
button. They can name different elements when that element is not in the
tree, such as a decoration with no role: `targetRef` is then its nearest
ancestor the tree lists, while `targetSelector` still names the element
itself. An `assert*` interaction
names the element the user picked in the same way. `targetRef` is `null` with
the selector present when a key was pressed while nothing on the page had
focus, as the key then goes to the page's body, which the tree does not list.

A `kind: change` entry is a change the recorder could not tie to an
interaction. Read it together with the steps around it. It is usually the
late result of an earlier step, such as data that finished loading. The
focus a click's press moved to the clicked element, and away from the one
before, is in that click's own change tree, not a change before it, nor in
the change tree of the step just before it, such as the typing before a
click. A page's first click can lack it, when another element, such as a
field the page focused by itself, had the focus. A change that no recorded action explains can also come from a
hover. It can come from something the page does
on its own in between, too, such as an async update.

A recording can have pauses: the user pressed Stop, did something, and pressed
Continue. What the page changed during a pause is not in the package at all,
neither as a `kind: change` entry nor in the next step's `changeTree`. After
Continue, changes are counted from the page as it stood then. So after a pause
the baseline plus the Change Trees no longer add up to the page: a node can be
there, or be gone, with no entry saying so. When a step after a pause acts on
an element nothing in the package added, read the page from the trace, at that
step's `beforeSnapshotId`.

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

Draft the playbook's test from the timeline first, then the smallest set of
page objects that can express it. When a step or a check cannot be expressed, change the
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

A click on an icon or on empty space can have only a candidate made of
generated ids or hashed class names, and no element in the trace that meets
the strategy. Do not invent a locator for it. Ask the user whether the click
matters to the flow.

## Use the trace

The recording's trace holds a DOM snapshot of the page before and after each
recorded interaction, with the real elements and their attributes. Read it
when a tree does not settle what a step did, or to find a locator for an
element. Open it with the project's own Playwright, `npx playwright trace`,
run in the project's folder. The tool keeps the trace it opened in that
folder, so run every command of one lookup from there. It also writes its
logs to a `.playwright-cli/` folder there: keep that folder out of commits.

The trace also holds the network log: every request, with its timing,
headers and bodies. `trace requests` lists the requests with their method,
status and duration, and from Playwright 1.63 when each started, counted
from the start of the trace; `trace request <n>`, with `<n>` from that list,
shows one request in full: its headers, and the paths of its body files to
read. The list names a request by the last part of its path; `trace request`
shows its full URL.

`traceActionPoints` says where each interaction is in the trace. Its
`beforeSnapshotId` and `afterSnapshotId` are position numbers, the numbers the
tool's `trace actions` list prints. Pass them to `trace snapshot`. Open both
with the `after` phase: each number points at a small step the recorder made
just after reading the page, so its `after` is the page at that moment. The
flag that picks the phase is `--phase` from Playwright 1.63 and `--name`
on 1.62; check the version with `npx playwright --version`.

Do not look for the user's steps by name in `trace actions`. The list shows
the recorder's own calls: its reads of the page (`Aria snapshot`, then a
`snapshot_<n>` group whose one call inside has the number the package
gives), and the mouse moves, presses and releases of the clicks it held
back and sent on. Keys the recorder held back show as key presses; text the
user typed or pasted otherwise is not an action there. Go to a step by the
package's position numbers.

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

For a first look at a page whose selectors you do not know yet, read its body
without the elements that are not the app's: the recorder's toolbar
(`ayme-recorder-toolbar`) and highlight (`ayme-recorder-highlight`), and
Playwright's own `x-pw-glass` and `template` elements, whose styles fill the
output.

```sh
npx playwright trace snapshot 44 --phase after \
  eval "(() => { const body = document.body.cloneNode(true); body.querySelectorAll('ayme-recorder-toolbar, ayme-recorder-highlight, x-pw-glass, template, script, style').forEach((element) => element.remove()); return body.outerHTML; })()" \
  | sed -n '/^### Result/,/^### Ran/{//!p;}'
```

The trace does not carry the package's refs. Find an element by what the
package says of it:

- An interaction's target: its `targetSelector`. A CSS selector, such as
  `[data-test="username"]`, goes into `querySelector` as it is. A
  Playwright selector does not. `internal:role=button[name="Add item"i]`,
  `internal:text="Items:"i`, `internal:label=…` and `internal:testid=…` are
  what `getByRole`, `getByText`, `getByLabel` and `getByTestId` find; a
  trailing `i` means the text is matched ignoring case, as part of a longer
  text. In the snapshot, match the role and the text instead, for example
  `[...document.querySelectorAll('button')].filter(e => e.textContent.trim() === 'Add item')`.
- Any other node: its role, name and text in the tree, and its ancestors.
- A `targetRef` that is the nearest listed ancestor of the element the user
  acted on: read both, the element by `targetSelector` and the ancestor by its
  role and name, in the same call.

When an `<added>` node takes the place of a `<removed>` node with the same
role, the trace tells whether the page drew the same control again or put a
different element there. Read the removed node in the step's
`beforeSnapshotId` and the added node in its `afterSnapshotId`, each by its
role and name, with `cloneNode(false)` as above. The same tag and the same
stable attributes, such as an `id`, a test id or an `href`, at the same place
in the page, mean the same control drawn again. Anything else is a different
element.

`trace snapshot <number> --phase after snapshot` prints the page structure of
a snapshot with refs of its own; they are not the package's refs.

A click that leaves the page shows its result in the next visit's baseline.
It has no `afterSnapshotId` when the page left before the recorder read it
again. When the page was slower to leave, as an app that loads the next page
in the background is, the click has an `afterSnapshotId`: that snapshot is of
the page it was on, not of where it led. An `assert*`
interaction has the same number in both. A pause is still part of the trace:
the trace has screenshots of the page throughout, also of what was on screen
while recording was stopped, and what the user did then, typing included, can
show in them and in later snapshots.

## Packages from the 0.1 recorder

A package made by the 0.1 recorder, `@ayme-dev/cli` 0.1, has text such as
`after@interaction_3` in `beforeSnapshotId` and `afterSnapshotId` rather than
a number. Read it with these differences:

- Its snapshots open only with that recorder's own trace command.
  `npx playwright trace` opens the trace and lists its actions, but finds no
  snapshots in it. Use `npx @ayme-dev/cli@0.1 trace open latest`, then
  `npx @ayme-dev/cli@0.1 trace snapshot <interaction id> --name after eval …`,
  named by the interaction's `id`. An interaction's `before` cannot be read.
- In its trace each element carries its package ref as the attribute
  `__playwright_aria_ref__`, so `[__playwright_aria_ref__="e44"]` finds the
  node `e44` of that interaction's visit.
- An element the app re-created got a new ref, even when nothing about it
  changed: the same button can be `e44`, then `e137` after a click, as an
  `<added>` and a `<removed>` node. To tell whether they are the same control,
  read the removed ref in the snapshot of the interaction before and the
  added ref in this one's, and compare them as
  [Use the trace](#use-the-trace) describes.
- Some nodes have a `/locator:` line with a Playwright locator for that node:
  a candidate, like a target selector.
