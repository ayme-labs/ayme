# Page tools

## Prefer the Page Object Tools

Use the Page Object Tools first, reading each tool's schema: one call can do
what several clicks and keystrokes would. Use Browser Tools for what no Page
Object covers.

Once the page is connected, its tools are the Browser Tools and the Page
Object Tools it publishes. Each Page Object Tool is named after its class and action,
such as `ProjectRow.remove`, across all instances of the class. [Browser Tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/browser-tools.md)
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
  inconclusive about whether the call worked, after a full page load when its
  `next` says to, or when you need a fresh ref.

## Refs and refused calls

- When a ref fails to resolve, call `snapshot` and use the ref it prints for
  that node. If that ref fails the same way, use a Browser Tool with a
  selector, such as `role=button[name="Save"]`. Pass a ref alone, such as
  `e36`.
  [Page state](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-state.md#structural-refs)
  says what each failure reason means.
- A ref belongs to one document. After a full page load, call `snapshot`
  before you use a ref. A ref printed before the load can name another
  element on the new page.
- The page state marks each Page Object Root with its class. Example:
  `ProjectsPage` holds a collection `projects()` of `ProjectRow`.
  `ProjectRow` has the actions `remove()` and `rename(name)`. `snapshot`
  shows:

  ```
  - e5 table:
    - e6 rowgroup:
      - e7 ProjectRow:
        - e8 cell "Website redesign"
        - e9 cell:
          - e10 button "Remove"
      - e11 ProjectRow:
        - e12 cell "Mobile app"
        - e13 cell:
          - e14 button "Remove"
  ```

  One tool serves every `ProjectRow`. Name the row by the ref on its mark,
  `e11`:

  ```
  ProjectRow.remove({ ref: "e11" })
  ProjectRow.rename({ ref: "e11", args: { name: "Mobile app v2" } })
  ```

  The action's own arguments go under `args`. Leave `args` out when the
  action takes none. Any class with a mark is called this way, a single
  child included. The ref of the row's button, `e14`, is refused:
  `Cannot call ProjectRow.remove on ref "e14": it is not a root of ProjectRow.`

- A class with no root gets no mark. A page usually has none, since its base
  class makes it present by its URL. Its tools take the action's arguments
  directly, such as `ProjectsPage.openNewProjectDialog({})`.
  [Page Object root](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#page-object-root)
  has the rules.
- When a tool answers that it is unavailable, read the reason. Example: a
  native modal dialog opened over the rows above.

  ```
  - e15 dialog "Remove Mobile app?":
    - e16 button "Cancel" [active]
  ```

  `ProjectRow.remove` is now unavailable, with the reason
  `a click would not reach it; e15 is in the way`. A call on `e11` is refused
  with that reason. `e15` is the open dialog. Close it, such as with `click`
  on `e16`, then call again. When the element in the way has no ref, the
  reason ends at `a click would not reach it`.

- `type`, `fill`, `select_option` and the `fill_form` fields other than a
  checkbox or radio give `it cannot take focus; e15 is in the way` instead.
  They give it for a field outside an open native modal dialog, or inside an
  `inert` region.
- Any other reason comes from the app, such as `No item is selected`.
- An unavailable Page Object Tool stays listed. `ayme_list_tools` shows
  whether each tool is available, and why not. Each tool result says which
  tools became available or unavailable since your previous call.
- When a tool answers that it is gone, what offered it is no longer there,
  such as a Page Object that is no longer present, a page that navigated or
  an App Process that stopped. Use one of the current tools instead.
