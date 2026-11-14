# Page tools

## Prefer the Page Object Tools

Use a Page Object Tool whenever one does the step, reading its schema: one
call can do what several clicks and keystrokes would. Each is named after its
class and action, such as `ListItem.archive`, across all instances of the
class. Drive the rest of the page with your browser automation; when that is
Playwright CLI, Playwright MCP or agent-browser, read
[Browser automation tools](browser-automation-tools.md).

Ayme's own Browser Tools, `snapshot`, `goal` and Custom Tools are listed only
when `ayme mcp` was started with `--browser-tools`, for an agent that has no
other browser automation. [Browser Tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/browser-tools.md)
lists them with their input. When `goal` is among your tools, read
[Goal](goal.md). To connect to the page, when its tools are missing, or when
the page left before a call answered, read [Browser setup](browser-setup.md).

## The tools follow the screen

Page Object Tools appear and disappear with their Page Objects, as the page
moves between screens. Plan with the tools of the screen you are on.

Call each tool directly, by its name in your tool list. When a call answers
that the tool doesn't exist, or your client doesn't update your tool list by
itself, `ayme_list_tools` lists the current tools and `ayme_call` runs them.

## Name a Page Object by its id

`page_objects` shows the Page Objects on the page now as a tree: each one's
class, its declared children with their values, and the id of each Page
Object that has a root, such as `ListItem po3`. A rooted Page Object Tool
takes that id, for a page, a single child and a collection item alike, with
its action arguments under `args`:
`ListItem.archive({ id: "po3", args: { … } })`. A root-less Page Object Tool
takes its arguments directly.

An id stays with its Page Object while the root's element is on the page, and
is never given to another. When a call answers that the Page Object is not on
the page, read `page_objects` for the ids there are now. An id is not a ref:
pass it only to a Page Object Tool.
[Page Object Children](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/ayme-page-objects.md#aymechild)
has the example.

## Read each answer

A Page Object Tool answers in a few fields:

- `settled`: whether the page settled after the action. `false` means it was
  still changing when the call answered.
- `result`: what the action returned, when it returned something.
- `url`: the new URL, when the action changed it.
- `loading`: the new document is still loading; wait for it with your browser
  automation before reading the page.
- `changes`: how the Page Object tree changed, in the tree `page_objects`
  shows. A Page Object that appeared is shown in full, with its children and
  its id; one that went away is marked removed; a value that changed reads
  old → new.

When `changes` shows the effect you expected, move on. When the answer is
inconclusive, read `page_objects`, or the page with your browser automation.

## Refused and failed calls

- A refused call answers with its reason alone. A runtime reason,
  `a click would not reach it; e42 is in the way`, names the element in the
  way, such as an open dialog to close first. Any other reason is the app's
  own, such as `No item is selected`. A Page Object Tool stays listed while
  it is unavailable: `ayme_list_tools` shows whether each tool is available
  and why not.
- A failed call answers with what failed alone. Read the page before you
  call it again.
- When a tool answers that it is gone, what offered it is no longer there,
  such as a Page Object that is no longer present, a page that navigated or
  an App Process that stopped. Use one of the current tools instead.
