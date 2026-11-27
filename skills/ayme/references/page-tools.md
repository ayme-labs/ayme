# Page tools

The commands are written `ayme <command>`; run them as
[Browser automation tools](browser-automation-tools.md) says. Each one
prints its answer and exits. An error goes to standard error with exit
code 1. Add `--json` for a Session's answer as JSON.

## Prefer the Page Object Tools

Use a Page Object Tool whenever one does the step: one call can do what
several clicks and keystrokes would. Each is named after its class and
action, such as `ProjectRow.remove`, across all instances of the class.
Drive the rest of the page with your browser automation.

- On each new screen, starting with the first one, run `ayme page-objects`
  before you take a snapshot. When a Page Object Tool does the next step,
  call it; take a snapshot only when none does.
- After a navigation, run `ayme page-objects` again. If the step is still to
  do, call its tool again, with the id the new listing shows.

## Read the screen

`ayme page-objects` prints the Page Object Tree of the screen: the Page
Objects on the page now. Example: `ProjectsPage` holds a collection
`projects()` of `ProjectRow`. `ProjectRow` declares its name and its Remove
button, and has the actions `remove()` and `rename(name)`:

```
Tab: Projects (http://localhost:5173/projects)
ProjectsPage
  projects:
    - ProjectRow po1
        name: text: Launch plan
        removeButton: button "Remove"
    - ProjectRow po2
        name: text: Q4 survey
        removeButton: button "Remove"
This screen has 3 Page Object Tools: ayme -s=default tools lists them with their parameters.
```

The first line names the tab ayme works on: the browser's most recently
active tab. `--tab=<url>` reads another tab, by the URL that line shows.

`ayme tools` lists each Page Object Tool of the screen with its parameters,
and marks a tool that cannot run now: `ProjectRow.remove (unavailable: …)`
with the app's reason, or `(unavailable)` alone when the app gave none.

## Name a Page Object by its id

One tool serves every `ProjectRow`. Name the row by the id after its class.
`--params` takes the tool's input as one JSON object: the id as `id` and the
action's own arguments under `args`. To remove Q4 survey, pass `po2`. To
rename Launch plan, pass `po1`:

```sh
ayme call ProjectRow.remove --params '{"id": "po2"}'
ayme call ProjectRow.rename --params '{"id": "po1", "args": {"name": "Launch plan v2"}}'
```

Leave `args` out when the action takes none. `ProjectsPage` has no id,
because it has no root, so its tools take the action's arguments directly.
Leave `--params` out for a tool that takes none:
`ayme call ProjectsPage.openNewProjectDialog`. For long input, write the
object to a file and pass `--params @<file>`.

The id chooses the tab: a call runs on the tab its Page Object is on. An id
stays with its Page Object while the Page Object is on the page, and is
never given to another. When a call answers that the Page Object is not on
the page, run `ayme page-objects` for the ids there are now.

## Read each answer

`ayme call` answers in a few lines:

- `settled`: whether the page settled after the action. It is `false` after
  an action that started loading a new document, even when the answer
  already comes from the new page.
- `result`: what the action returned, when it returned something.
- `url`: the new URL, when the action changed it.
- `changes`: how the Page Object Tree changed. A Page Object that appeared
  is shown in full, with its children and its id; one that went away is
  marked removed; a value that changed reads old → new.

Read `url` and `changes` before you wait for anything. When they show the
effect you expected, move on, whatever `settled` says. When they do not,
or `changes` is missing after a load, wait with your browser automation,
then run `ayme page-objects`.

## Refused and failed calls

- A refused call answers with its reason alone, such as
  `RuntimeStateError: ProjectRow "po2" is unavailable: No item is selected.`,
  the app's own reason. Input that does not match the tool's parameters is
  refused before the action runs, with a sentence for each problem.
- A failed call answers with what failed, followed by `changes:` when the
  Page Object Tree changed while it ran. It shows how far the action got
  before you call it again.
- When no tab is open, a command says so. Open one with your browser
  automation.
