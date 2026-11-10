# Page state

What an agent sees of your page: the Structural Page State, the Structural Refs it acts through, and the interaction history Ayme keeps.

## Structural Page State

Once Ayme has started and Page Objects are registered, it captures the Structural Page State: a model-facing view of what the page presents and which Page Objects it holds. It is based on the page's accessibility tree and marks each Page Object Root with its class, such as `ProjectRow`. An element that is the root of several classes lists their names in its `pom` property. Snapshots and Change Records use the same marks, including for removed roots. It covers the top-level document only.

Content that is scrollable or blocked by a modal stays in the state. Page Object subtrees known to be hidden or off-canvas are left out. Being in the state does not mean a node can be interacted with.

Page state works without WebMCP publication. An agent reads it with the `snapshot` tool, which returns the state as `structure` and the definitions of the registered Page Object Models as `pomDefinitions`. Your own code runs the same tool with `ayme.tools.run("snapshot", {})`.

## Structural Refs

Each node in the state carries a Structural Ref. In this excerpt, `e10` is the ref of a [`ProjectRow`](ayme-page-objects.md#aymeaction), and `e13` the ref of its Remove button:

```text
- e5 list:
  - e10 ProjectRow:
    - text: Q4 survey
    - e11 button "Archive"
    - e12 button "Rename"
    - e13 button "Remove"
```

An agent passes a ref back to act on that node:

- a Browser Tool takes it as `target`: `click({ target: "e13" })`;
- a [Custom Tool](custom-tools.md) takes it as `ref`: `highlight_element({ ref: "e10" })`;
- a rooted Page Object's tool takes its root's ref as `ref`: `ProjectRow.remove({ ref: "e10" })`. This holds for a rooted page or single child too.

A ref comes from one capture. Within one document, Ayme tries to keep refs stable, so a ref from an earlier capture usually still names the same node. A ref that cannot be used fails with a `RefResolutionError`, such as `Cannot click ref "e13": it is no longer on the page.` Its reason says why:

| Reason                                                   | Meaning                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `no snapshot of the current document issued it`          | No capture in this document printed the ref, such as one written by hand.                                    |
| `it is no longer on the page`                            | The node the ref named was removed.                                                                          |
| `it cannot be matched unambiguously to the current page` | Ayme cannot tell which current node the ref continues as. It does not mean the ref matches several elements. |
| `it has no element on the page now`                      | The ref names a node of the latest capture that has no live element.                                         |

Refs restart with each document, so a ref from before a full load can resolve to a different node that the new document numbered the same, and the call succeeds on that node; only a ref the new document never issued fails, with the first reason.

In each case, take a `snapshot` and use the ref it prints for the node.

Pass the ref alone, as `e36`. A Playwright snapshot writes it as `[ref=e36]`. A Browser Tool reads that as a CSS selector in `target`. When the selector matches no element, the error names the ref to pass instead:

```text
Cannot click "[ref=e36]": the selector matches no element. It writes the Structural Ref e36 another way.
```

## Keep parts of the page out

Pass `ignore` where Ayme starts to drop elements, and everything inside them, from the page state. Its value is a CSS selector:

```ts
createAyme({
  ignore: "[data-assistant-panel]",
});
```

For a rule a selector cannot say, pass a function that takes the session's Playwright `Page` and returns a `Locator` of the elements to drop. Ayme calls it once, when the session starts, and keeps the Locator. The function runs in your own code, so it can use anything around it:

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
- lets picking and clicks pass through it;
- is hidden from screenshots.

The attribute needs no `ignore`, and it works in a build that leaves Ayme out.

`ignore` changes page state only; it does not change which tools are published.

## Interaction history

Ayme records what happens in the document for the length of its Page State Session: a Visit at load and at each same-document navigation, every tool call and Goal Loop step as an action, and every page state it captures. A full page load starts a new Page State Session and a new history.

Every action returns its Change Record: what changed on the page, in two parts. Take the list of [`ProjectRow`](ayme-page-objects.md#aymeaction)s above. Say an agent last read it with Launch plan (`e6`) and Q4 survey (`e10`). Then the user removes Launch plan by hand. Then the agent calls `ProjectRow.archive({ ref: "e10" })` to archive Q4 survey. The result is:

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

- `changes_before` is what changed after the agent last read the page and before its action ran. Here, that is the user's removal of Launch plan.
- `changes` is what the action changed, up to the Settled Page after it. A change that lands while the page settles counts as the action's.
- Each part is present only when it has a change. `page_changed` is true when either part is present.
- `settled` says whether the page went quiet after the action.

Each Caller name has its own cursor: the page state that Caller last received, from `snapshot` or as the Settled Page after its last action. The Caller names are:

- `webmcp`, an agent calling through WebMCP;
- `ayme-mcp`, an agent calling through the Ayme MCP server;
- `inspector`, the Inspector;
- `app`, your app's `ayme.tools.run`, or the name it passes as `by`.

Two Callers that use one name share one cursor.

A Custom Tool's Change Record also covers what the tools it started through `run` changed.

An action that fails still reports what it changed. Its error keeps its own message, such as a Playwright timeout and its call log, and carries the Change Record as fields named like an action result's: `page_changed`, and `changes_before` and `changes` when they have a change. The type `ActionFailure` describes them. An agent calling through WebMCP or the Ayme MCP server reads the error's text followed by `changes_before:` and `changes:` and each record; a failed Run in the Inspector shows the error alone. The Caller's cursor moves to the page the failed action left, so the next action does not report those changes again. A click that lands after its timeout has passed, as on a page too busy to keep up, fails with `TimeoutError` like in Playwright, and its `changes:` shows what the click did.

## Full page loads

A tool call whose action starts loading a new document, such as a click on a plain link or on a form's submit button, answers at once, before the old document goes away and Ayme with it. The answer is the action result with `settled: false`, the Change Record up to that moment in `changes_before` and `changes`, the URL the navigation started for in `loading`, and in `next` a note that the page is loading and that `snapshot` is the next call. For a form submit, `loading` is the form's `action`: where the server redirects is not known yet when the answer goes out.

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

This holds for Browser Tools, Custom Tools and Page Object Tools alike. A navigation that stays in the document, such as your client router's route change, a fragment change, or going back to an entry of the same document, waits for a Settled Page like any other action. A Goal Loop step that starts a full load is the run's last; its Handover has the reason `page_loading` and names the URL in `loading`.
