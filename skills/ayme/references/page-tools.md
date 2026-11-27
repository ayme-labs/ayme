# Page tools

The commands are written `ayme <command>`; run them as
[Browser automation tools](browser-automation-tools.md) says. Each one
prints its answer and exits. An error goes to standard error with exit
code 1. Add `--json` for a Session's answer as JSON: read its fields under
`data`, as
[What the agent sees](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md#what-the-agent-sees)
shows.

A Page Object Tool is named after its class and action, such as
`ProjectRow.remove`. Drive the rest of the page with your browser
automation.

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

The first line names the Tab ayme works on;
[Sessions](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md#sessions)
says how to read another.

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
object to a file and pass `--params @<file>`, within the limits
[What the agent sees](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md#what-the-agent-sees)
gives.

The id chooses the Tab: `ayme call` runs the tool on the Tab its Page
Object is on, so leave `--tab` out of that call. A tool without an id runs
on the Tab `--tab` names, or else on the most recently active one. An id
stays with its Page Object while the Page Object is on the page, and is
never given to another. When a call answers that the Page Object is not on
the page, run `ayme page-objects` for the ids there are now.

## Read each answer

`ayme call` answers in a few lines:

- `settled`: whether the page settled after the action. It is `false` after
  an action that started loading a new document, even when the answer
  already comes from the new page.
- `result`: what the action returned, when that is a JSON value.
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
- A failed Run answers with what failed, followed by `changes:` when the
  Page Object Tree changed while it ran. It shows how far the action got
  before you call it again.
- When an answer says a dialog `is open on the tab`, answer the dialog with
  your browser automation. Then the end of that answer tells you what to do:
  - `… then run this command again.`: the command did nothing, because the
    dialog was open before it started. Run it again.
  - `The action stopped there: …`: the action ran up to the dialog and
    stopped. Part of it may have happened, so a second call can repeat it.
    Check the page with your browser automation, and do only what is left
    of the step.
