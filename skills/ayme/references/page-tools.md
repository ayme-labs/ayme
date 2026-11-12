# Page tools

## Prefer the Page Object Tools

Use the Page Object Tools first, reading each tool's schema: one call can do
what several clicks and keystrokes would. Use Browser Tools for what no Page
Object covers.

Once the page is connected, its tools are the Browser Tools and the Page
Object Tools it publishes. Each Page Object Tool is named after its class and action,
such as `ListItem.archive`, across all instances of the class. [Browser Tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/browser-tools.md)
lists every built-in tool with its input. To connect to the page, when its
tools are missing, or when the page left before a call answered, read
[Browser setup](browser-setup.md).

When `goal` is among your tools, read [Goal](goal.md).

## The tools follow the screen

Page Object Tools appear and disappear with their Page Objects, as the page
moves between screens. When the tools changed since your previous call, the
answer names those that appeared and disappeared. Plan with the tools of the
screen you are on.

Call each tool directly, by its name in your tool list. When a call answers
that the tool doesn't exist, use `ayme_list_tools` and `ayme_call`.

The page's tools change as the page does. If your client doesn't update your
tool list by itself, `ayme_list_tools` lists the current tools and `ayme_call`
runs them.

## Read each answer

Every action answers with `page_changed` and `settled`. `changes` holds what
the action changed and `changes_before` what changed before it, each present
only when it has a change, element refs included;
[Page state](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-state.md#interaction-history)
explains the two. A tool's own return value is in `result`.

- When `changes` shows the effect you expected, move on.
- `settled: false` means the page was still changing when the call answered,
  so `changes` may not hold all the call did.
- After an action, take a `snapshot` only when an answer is empty or
  inconclusive about whether the call worked, when its `next` says to, or when
  you need a fresh ref.

## Refs and refused calls

- When a ref fails to resolve, call `snapshot` and use the ref it prints for
  that node; if that ref fails the same way, use a Browser Tool with a selector such as
  `role=button[name="Save"]`. Pass a ref alone, such as `e36`. A ref names
  an element; a Page Object has an id of its own.
  [Page state](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-state.md#structural-refs)
  says what each failure reason means. Refs belong to one document: after a
  full load, call `snapshot` before you use a ref, since a ref printed before
  the load can name another element on the new page.
- The page state marks each Page Object Root with its class and the Page
  Object's id, such as `e9 ListItem po3`; a root of several classes lists
  them under `pom`, with the id under `id`. A rooted Page Object Tool takes
  that id, for a page, a single child and a collection item alike:
  `ListItem.archive({ id: "po3" })`. Pass its action arguments under `args`.
  A root-less Page Object Tool takes its arguments directly. An id stays
  with its Page Object while the root's element is on the page; when a call
  answers that the Page Object is not on the page, `snapshot` prints the
  ids there are now.
  [Page Object Children](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/ayme-page-objects.md#aymechild)
  has the example.
- When a tool answers that it is unavailable, read the reason. A runtime
  reason, `a click would not reach it; e42 is in the way`, names the element
  in the way in the page state, such as an open dialog to close first, and
  stops before the ref when nothing in the way has one. A Browser Tool that
  types or selects (`type`, `fill`, `select_option`, or a `fill_form` field
  other than a checkbox or radio) gives
  `it cannot take focus; e42 is in the way` instead, for a field outside an
  open native modal dialog or inside an inert region. Any other reason is the
  app's own, such as `No item is selected`. A Page Object Tool stays listed:
  `ayme_list_tools` shows whether each tool is available and why not,
  and a tool result says which tools became available or unavailable since
  your previous call.
- When a tool answers that it is gone, what offered it is no longer there,
  such as a Page Object that is no longer present, a page that navigated or
  an App Process that stopped. Use one of the current tools instead.
