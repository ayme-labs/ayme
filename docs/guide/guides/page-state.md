# Page state

What an agent sees of your page: the Structural Page State, the Structural Refs it acts through, and the interaction history Ayme keeps.

## Structural Page State

Once Ayme has started and Page Objects are registered, it captures the Structural Page State: a model-facing view of what the page presents and which Page Objects it holds. It is based on the page's accessibility tree and marks each Page Object Root with its class, such as `ListItem`. An element that is the root of several classes lists their names in its `pom` property. Snapshots and Change Records use the same marks, including for removed roots. It covers the top-level document only.

The state an agent reads also prints each Page Object's id on its root, after the class: `e9 ListItem po3`. On a root of several classes it is the `id` property beside `pom`. See [Page Object ids](#page-object-ids).

Content that is scrollable or blocked by a modal stays in the state. Page Object subtrees known to be hidden or off-canvas are left out. Being in the state does not mean a node can be interacted with.

Page state works without WebMCP publication. An agent reads it with the `snapshot` tool, which returns the state as `structure` and the definitions of the registered Page Object Models as `pomDefinitions`. Your own code runs the same tool with `ayme.tools.run("snapshot", {})`.

## Structural Refs

Each node in the state carries a Structural Ref, such as `e5`. An agent passes it back as the `target` of a Browser Tool, as the `ref` of a Custom Tool, or as the `ref` that picks a rooted Page Object instance, including a page or single child, in place of its [id](#page-object-ids). A ref belongs to the capture it came from; within one document, Ayme keeps refs continuous on a best-effort basis, so an earlier ref can resolve to the current version of the same node. A ref that cannot be used fails with a `RefResolutionError` whose reason says why:

| Reason                                                   | Meaning                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `no snapshot of the current document issued it`          | No capture in this document printed the ref, such as one written by hand.                                    |
| `it is no longer on the page`                            | The node the ref named was removed.                                                                          |
| `it cannot be matched unambiguously to the current page` | Ayme cannot tell which current node the ref continues as. It does not mean the ref matches several elements. |
| `it has no element on the page now`                      | The ref names a node of the latest capture that has no live element.                                         |

Refs restart with each document, so a ref from before a full load can resolve to a different node that the new document numbered the same, and the call succeeds on that node; only a ref the new document never issued fails, with the first reason.

In each case, take a `snapshot` and use the ref it prints for the node. When an input writes a ref another way, such as `[ref=e36]`, the message names the ref it writes, `e36`, and the tool takes that ref alone.

## Page Object ids

A Page Object of a class with a [Page Object Root](../reference/ayme.md#page-object-root) has an id, written `po<n>`, such as `po3`. The page numbers its Page Objects in the order it first shows them. A Page Object keeps its id while the element of its root stays on the page, and an id is never given to another Page Object.

A Page Object Tool of such a class takes the id as `id`: `ListItem.archive({ id: "po3" })`. An `id` that is not written `po<n>` is refused with a `ToolInputError`. An id whose Page Object is no longer on the page fails with a `RefResolutionError`: `Cannot call ListItem.archive on Page Object "po3": it is not on the page.`

In TypeScript the id is a `PageObjectId`, exported from `@ayme-dev/ayme`. It is a type of its own: a Structural Ref (`AriaRef`) is not assignable to it, nor it to a Structural Ref.

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

Ayme resolves the Locator again each time, right before it reads the page, so an element that appears later is dropped too. One that appears after the Locator resolved and before the page was read is dropped from the next page state on. An element an action adds just before a full page load can appear in that action's Change Record, since the matches are from when the action began.

A filter, here and in a Custom Tool, matches only the page's own document: a Locator into a frame, such as `page.frameLocator("iframe").locator(".private")`, matches nothing, as the page state holds none of a frame's contents.

To leave out an element your own code owns, such as a widget you mount beside the app, put the attribute `data-ayme-exclude` on it, or set it from code with the exported `EXCLUDE_ATTRIBUTE` (`import { EXCLUDE_ATTRIBUTE } from "@ayme-dev/ayme"`). The element and everything in it is out of every capture, picking and clicks pass through it, and screenshots hide it. The attribute needs no `ignore`, and it works in a build that leaves Ayme out.

`ignore` changes page state only; it does not change which tools are published.

## Interaction history

Ayme records what happens in the document for the length of its Page State Session: a Visit at load and at each same-document navigation, every tool call and Goal Loop step as an action, and every page state it captures. A full page load starts a new Page State Session and a new history.

Each Caller name, the agent calling through WebMCP or the Ayme MCP server, the Inspector, and your application's `ayme.tools.run` under `app` or the name it passes as `by`, has its own cursor: the page state it last received, through `snapshot` or as the Settled Page after its last action. Two Callers under one name share one. Every action returns a result with `page_changed` and `settled`, and its Change Record in two parts, each present only when it has a change: `changes_before`, what changed between the state the Caller had last received and the page right before the action, on its own or by another Caller; and `changes`, what the action changed, from that page to the Settled Page after it. `settled` says whether the page went quiet after the action, and `page_changed` is true when either part has a change. A change that lands while the page settles counts as the action's. So an agent's next action also reports what your application or another Caller changed in between, under `changes_before`, and a Custom Tool's Change Record covers what the tools it ran through its `run` changed. A Goal Loop run reads with a fork of its Caller's cursor and leaves the cursor alone until it hands over.

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
