# Page tools

## Prefer the Page Object Tools

Use a Page Object Tool whenever one does the step, reading its schema: one
call can do what several clicks and keystrokes would. Each is named after its
class and action, such as `ProjectRow.remove`, across all instances of the
class. Your tool list may show the dot in a tool's name as an underscore, such
as `ProjectRow_remove`. It's the same tool. Drive the rest of the page with your browser automation; when that is
Playwright CLI, Playwright MCP or agent-browser, read
[Browser automation tools](browser-automation-tools.md).

`ayme mcp` lists none of ayme's own browser driving. To connect to the page,
when its tools are missing, or when the page left before a call answered,
read [Browser setup](browser-setup.md).

## The tools follow the screen

Page Object Tools appear and disappear with their Page Objects, as the page
moves between screens. Plan with the tools of the screen you are on.

Call each tool directly, by its name in your tool list. When a call answers
that the tool doesn't exist, or your client doesn't update your tool list by
itself, `ayme_list_tools` lists the current tools and `ayme_call` runs them.

## Name a Page Object by its id

`page_objects` shows the Page Objects on the page now as a tree. Example:
`ProjectsPage` holds a collection `projects()` of `ProjectRow`. `ProjectRow`
declares its name and its Remove button, and has the actions `remove()` and
`rename(name)`. `page_objects` shows:

```
ProjectsPage
  projects:
    - ProjectRow po1
        name: text: Launch plan
        removeButton: button "Remove"
    - ProjectRow po2
        name: text: Q4 survey
        removeButton: button "Remove"
```

One tool serves every `ProjectRow`. Name the row by the id after its class.
To remove Q4 survey, pass `po2`. To rename Launch plan, pass `po1`:

```
ProjectRow.remove({ id: "po2" })
ProjectRow.rename({ id: "po1", args: { name: "Launch plan v2" } })
```

The action's own arguments go under `args`. Leave `args` out when the action
takes none. Any class with an id is called this way, a page or single child
included. `ProjectsPage` has no id, because it has no root, so its tools take
the action's arguments directly, such as
`ProjectsPage.openNewProjectDialog({})`.

An id stays with its Page Object while the Page Object is on the page, and is
never given to another. When a call answers that the Page Object is not on
the page, read `page_objects` for the ids there are now.

## Read each answer

A Page Object Tool answers in a few fields:

- `settled`: whether the page settled after the action. `false` means it was
  still changing when the call answered, or a new document is still loading:
  wait with your browser automation before you read the page.
- `result`: what the action returned, when it returned something.
- `url`: the new URL, when the action changed it.
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
- A failed call answers with what failed, followed by `changes:` when the
  Page Object tree changed while it ran. It shows how far the action got
  before you call it again.
- When a tool answers that it is gone, what offered it is no longer there,
  such as a Page Object that is no longer present, a page that navigated or
  an App Process that stopped. Use one of the current tools instead.
