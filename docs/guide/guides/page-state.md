# Page state

What an agent sees of your page: the Structural Page State, the Structural Refs and Page Object ids it acts through, and the interaction history ayme keeps.

## Structural Page State

Once ayme has started and Page Objects are registered, it captures the Structural Page State: a model-facing view of what the page presents and which Page Objects it holds. It is based on the page's accessibility tree and marks each Page Object Root with its class, such as `ProjectRow`. An element that is the root of several classes lists their names in its `pom` property. Snapshots and Change Records use the same marks, including for removed roots. It covers the top-level document only.

The state an agent reads also prints each Page Object's id on its root, after the class: `e10 ProjectRow po2`. A root of several classes is the root of several Page Objects: its `id` property lists their ids in the order `pom` lists the classes. See [Page Object ids](#page-object-ids).

Content that is scrollable or blocked by a modal stays in the state. Page Object subtrees known to be hidden or off-canvas are left out. Being in the state does not mean a node can be interacted with.

Page state works without WebMCP publication. An agent reads it with the `snapshot` tool, which returns the state as `structure` and the definitions of the registered Page Object Models as `pomDefinitions`. Your own code runs the same tool with `ayme.tools.run("snapshot", {})`.

## Structural Refs

Each node in the state carries a Structural Ref. In this excerpt, `e10` is the ref of a [`ProjectRow`](ayme-page-objects.md#aymeaction), `po2` its Page Object id, and `e13` the ref of its Remove button:

```text
- e5 list:
  - e10 ProjectRow po2:
    - text: Q4 survey
    - e11 button "Archive"
    - e12 button "Rename"
    - e13 button "Remove"
```

An agent passes a ref back to act on that node:

- a Browser Tool takes it as `target`: `click({ target: "e13" })`;
- a [Custom Tool](custom-tools.md) takes it as `ref`: `highlight_element({ ref: "e10" })`.

A ref names an element only. A rooted Page Object's tool takes its [Page Object id](#page-object-ids) instead: `ProjectRow.remove({ id: "po2" })`.

A ref comes from one capture. Within one document, ayme tries to keep refs stable, so a ref from an earlier capture usually still names the same node. A ref that cannot be used fails with a `RefResolutionError`, such as `Cannot click ref "e13": it is no longer on the page.` Its reason says why:

| Reason                                                   | Meaning                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `no snapshot of the current document issued it`          | No capture in this document printed the ref, such as one written by hand.                                    |
| `it is no longer on the page`                            | The node the ref named was removed.                                                                          |
| `it cannot be matched unambiguously to the current page` | ayme cannot tell which current node the ref continues as. It does not mean the ref matches several elements. |

Refs restart with each document, so a ref from before a full load can resolve to a different node that the new document numbered the same, and the call succeeds on that node; only a ref the new document never issued fails, with the first reason.

In each case, take a `snapshot` and use the ref it prints for the node.

Pass the ref alone, as `e36`. A Playwright snapshot writes it as `[ref=e36]`. A Browser Tool reads that as a CSS selector in `target`. When the selector matches no element, the error names the ref to pass instead:

```text
Cannot click "[ref=e36]": the selector matches no element. It writes the Structural Ref e36 another way.
```

## Page Object ids

A Page Object of a class with a [Page Object Root](../reference/ayme.md#page-object-root) has an id, written `po<n>`, such as `po3`. The page numbers its Page Objects in the order it first shows them. Two classes rooted at one element are two Page Objects, each with its own id. A Page Object keeps its id while the element of its root stays on the page, and an id is never given to another Page Object.

A Page Object Tool of such a class takes the id as `id`, for a page, a single child and a collection item alike: `ProjectRow.archive({ id: "po2" })`. An `id` that is not written `po<n>`, a Structural Ref included, is refused with a `ToolInputError`, as is a call that gives `ref`. An id whose Page Object is no longer on the page fails with a `RefResolutionError`: `Cannot call ProjectRow.archive on Page Object "po2": it is not on the page.` So does the id of a Page Object of another class: `it is not a ProjectRow on the page`.

An agent reads the ids without the whole page state from `page_objects`, which answers the Page Objects on the page as a tree: each one's class, its declared children with their values (an element child as its accessibility subtree), and the id of each Page Object of a class with a root. It carries no tool names, schemas or Page Object definitions:

```text
ShoppingListPage
  title: heading "Groceries" [level=1]
  items:
    - Item po1
        name: text: Milk
    - Item po2
        name: text: Eggs
```

Every id it prints is one that Page Object's tools take. It answers `No Page Object is on the page.` when none is.

In TypeScript the id is a `PageObjectId`, exported from `@ayme-dev/ayme`. It is a type of its own: a Structural Ref (`AriaRef`) is not assignable to it, nor it to a Structural Ref.

## Keep parts of the page out

Pass `ignore` where ayme starts to drop elements, and everything inside them, from the page state. Its value is a CSS selector:

```ts
createAyme({
  ignore: "[data-assistant-panel]",
});
```

For a rule a selector cannot say, pass a function that takes the session's Playwright `Page` and returns a `Locator` of the elements to drop. ayme calls it once, when the session starts, and keeps the Locator. The function runs in your own code, so it can use anything around it:

```ts
const assistantName = "Assistant";

createAyme({
  ignore: (page) => page.getByRole("complementary", { name: assistantName }),
});
```

In the browser, `page` is the session's Playwright Lite page; through `@ayme-dev/ayme/playwright` it is the Playwright `Page` you passed. A function that throws, or returns anything but a Locator, fails `start()` with a `ToolInputError` that names `ignore`.

An element that matches later is dropped too. An element an action adds just before a full page load can still appear in that action's Change Record.

A filter, here and in a Custom Tool, matches only the page's own document: a Locator into a frame, such as `page.frameLocator("iframe").locator(".private")`, matches nothing, as the page state holds none of a frame's contents.

To leave out an element your own code owns, such as a widget you mount beside the app, put the attribute `data-ayme-exclude` on it:

```html
<div id="support-widget" data-ayme-exclude></div>
```

From code, use the exported constant:

```ts
import { EXCLUDE_ATTRIBUTE } from "@ayme-dev/ayme";

const widget = document.getElementById("support-widget")!;
widget.setAttribute(EXCLUDE_ATTRIBUTE, "");
```

The element and everything in it:

- is out of every capture;
- lets picking and clicks pass through it.

The attribute needs no `ignore`, and it works in a build that leaves ayme out.

`ignore` changes page state only; it does not change which tools are published.

## Interaction history

ayme records what happens in the document for the length of its Page State Session: a Visit at load and at each same-document navigation, every tool call and Goal Loop step as an action, and every page state it captures. A full page load starts a new Page State Session and a new history.

Every action returns its Change Record: what changed on the page, in two parts. A [full page load](#full-page-loads) can leave it unread. Take the list of [`ProjectRow`](ayme-page-objects.md#aymeaction)s above. Say your app's code last read it with Launch plan (`e6`) and Q4 survey (`e10`). Then the user removes Launch plan by hand. Then your code runs `ayme.tools.run("ProjectRow.archive", { id: "po2" })` to archive Q4 survey. The result is:

```ts
{
  page_changed: true,
  settled: true,
  changes_before: `- e2 main:
  - e5 list:
    - e6 ProjectRow <removed>:
      - text: Launch plan
      - e7 <removed> button "Archive"
      - e8 <removed> button "Rename"
      - e9 <removed> button "Remove"`,
  changes: `- e2 main:
  - e5 list:
    - e10 ProjectRow <removed>:
      - text: Q4 survey
      - e11 <removed> button "Archive"
      - e12 <removed> button "Rename"
      - e13 <removed> button "Remove"`,
}
```

- `changes_before` is what changed after your code last read the page and before its action ran. Here, that is the user's removal of Launch plan.
- `changes` is what the action changed, up to the Settled Page after it. A change that lands while the page settles counts as the action's.
- Each part is present only when it has a change. `page_changed` is true when either part is present.
- `settled` says whether the page went quiet after the action.

An agent's Page Object Tool call answers in [a shorter form](#a-page-object-tools-answer-to-an-agent). Its other tools answer with the full result.

Each Caller name has its own cursor: the page state that Caller last received, from `snapshot` or as the Settled Page after its last action. The Caller names are:

- `webmcp`, an agent calling through WebMCP;
- `ayme-mcp`, an agent calling through the ayme MCP server;
- `ayme-command`, an agent calling with `ayme call` through a Session of the [`ayme` command](connect-an-agent.md);
- `inspector`, the Inspector;
- `app`, your app's `ayme.tools.run`, or the name it passes as `by`.

Two Callers that use one name share one cursor.

A Custom Tool's Change Record also covers what the tools it started through `run` changed.

An action that fails still reports what it changed. Its error keeps its own message, such as a Playwright timeout and its call log, and carries the Change Record as fields named like an action result's: `page_changed`, and `changes_before` and `changes` when they have a change. The type `ActionFailure` describes them. An agent calling a Browser Tool or Custom Tool through WebMCP reads the error's text followed by `changes_before:` and `changes:` and each record; a failed Run in the Inspector shows the error alone, and an agent's failed Page Object Tool call shows the error and how the Page Object Tree changed (see [A Page Object Tool's answer to an agent](#a-page-object-tools-answer-to-an-agent)). The Caller's cursor moves to the page the failed action left, so the next action does not report those changes again. A click that lands after its timeout has passed, as on a page too busy to keep up, fails with `TimeoutError` like in Playwright, and its `changes:` shows what the click did.

## Full page loads

A tool call whose action starts loading a new document, such as a click on a plain link or on a form's submit button, answers at once when ayme sees the load start, before the old document goes away and ayme with it. The answer is the action result with `settled: false`, the Change Record up to that moment in `changes_before` and `changes`, the URL the navigation started for in `loading`, and in `next` a note that the page is loading and that `snapshot` is the next call. For a form submit, `loading` is the form's `action`: where the server redirects is not known yet when the answer goes out.

```ts
{
  page_changed: true,
  settled: false,
  changes: `- e2 main:
  - e7 <removed> status: Saved`,
  loading: "http://localhost:5173/session",
  next: "The page is loading http://localhost:5173/session. Call snapshot next to read the new page.",
}
```

This holds for Browser Tools, Custom Tools and Page Object Tools alike; an agent reads a Page Object Tool's as [its short answer](#a-page-object-tools-answer-to-an-agent). Over Playwright in Node, as in a Session of the `ayme` command, a Page Object Tool's call answers only once its action has returned: see [The Page Object an action returns](#the-page-object-an-action-returns). A navigation that stays in the document, such as your client router's route change, a fragment change, or going back to an entry of the same document, waits for a Settled Page like any other action. A Goal Loop step that starts a full load is the run's last; its Handover has the reason `page_loading` and names the URL in `loading`.

Over Playwright in Node, the old document's last capture can fail to reach ayme when the next document commits at once, as from a local server on a busy machine. The answer then has no `page_changed` and no Change Record, and `next` says that what the action changed before the load could not be read. ayme does not see a load that Playwright's own `goto` or `reload` starts, so `navigate` without a router function and `reload` answer once that call returns. These two, `navigate_back` and `navigate_forward` change nothing in the document themselves, so when its last capture does not arrive, the page before the call stands in for it, and they always answer with `page_changed`.

## The Page Object an action returns

When a Page Object Action returns a Page Object whose model declares or inherits [`present`](../reference/ayme.md#page-object-presence), the call answers once that predicate returns `true`. A Caller then finds the screen the action led to, not one still on its way, such as the nearly empty page some apps load after a sign-in before they send the browser on. The wait ends at the Settled Page deadline, counted from the action's return, and each ask of the predicate gets only the time left. Past the deadline the call answers as it would have without the wait.

- An action that returns nothing, a value that is not a Page Object, or a Page Object without a `present` of its own or inherited gets no wait.
- ayme adds no other wait after an action. Waiting for a navigation or a load as such is the browser automation's, and an action does not wait for the screen it leads to: it returns that screen's Page Object.
- The answer is the one the action gave; the wait changes when it comes, not what it says. A part of the page that came during the wait is in the next action's `changes_before`.
- In the browser, where a full load ends ayme with the document, a call that starts one still answers at once, and gets no wait.
- Over Playwright in Node, as in a Session of the `ayme` command, ayme outlives the load. A call that starts one lasts until its action returns, however long after the load that is: it answers with what the action returned, or fails with what it threw, and then waits for the returned Page Object. ayme puts no time limit on the call, and the next call on the page waits until it ends.

## A Page Object Tool's answer to an agent

An agent that calls a Page Object Tool through WebMCP, through the ayme MCP server, or with `ayme call` through a Session of the [`ayme` command](connect-an-agent.md) gets a short answer instead of the action result, the same in each:

```ts
{
  settled: boolean;   // whether the page settled after the action; false while a new document loads
  result?: unknown;   // what the action returned, when it returned something
  url?: string;       // the page's URL, when the action changed it
  changes?: string;   // how the Page Objects on the page changed
}
```

`changes` is in the notation of `page_objects`, not a Change Record: a Page Object that went away is marked `(removed)`, one that appeared is shown in full after `+`, with its declared children and its id, and a declared child whose value changed reads `old → new`. It is absent when the Page Objects did not change. When the action starts loading a new document, `settled` is `false`. In a Session, when the action returned a Page Object that is present on the new document, the answer comes from the new page: `url` is its URL when that changed, and `changes` is how the Page Objects changed from the old page to the new one. Otherwise, and always through WebMCP and the ayme MCP server, whose ayme ends with the document, `url` is the URL the action loads when that differs from the page's, as it does not for a reload, and `changes` is absent.

```ts
{
  settled: true,
  result: 2,
  changes: `ShoppingListPage
  items:
    + Item po4
        name: text: Eggs`,
}
```

A refused call answers with its reason alone, such as `RuntimeStateError: Item.archive is unavailable: The item is archived.`, and a failed one with its error and, when the Page Object Tree changed while it ran, `changes:` and that change in the same tree, without the Change Record. Besides its Settled Page wait, ayme waits after the action only for [the Page Object it returns](#the-page-object-an-action-returns). `ayme.tools.run` in your code, the Inspector and the Goal Loop keep reading the full action result.
