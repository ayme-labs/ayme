# Page tools

Run the commands as [Browser automation tools](browser-automation-tools.md)
says; here they are written `ayme <command>`. Each one prints its answer and
exits. An error goes to standard error, with exit code 1. With `--json`, read
an answer's fields under `data`, as
[What the agent sees](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md#what-the-agent-sees)
shows.

A Page Object Tool is named after its class and action, such as
`ProjectRow.remove`. Drive the rest of the page with your browser
automation.

## Read the screen

`ayme page-objects` prints the Page Object Tree: the Page Objects on the
page now. In this example, `ProjectsPage` holds a collection `projects()` of
`ProjectRow`, and each `ProjectRow` declares its name and its Remove button
and has the actions `remove()` and `rename(name)`:

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

- The first line names the Tab: the browser tab ayme works on.
  [Sessions](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md#sessions)
  says how to read another.
- A declared element shows at most 40 lines of what a snapshot shows of it,
  with long lines cut. Take a snapshot for more.
- `ayme tools` lists each Page Object Tool of the screen with its
  parameters, and marks one that cannot run now:
  `ProjectRow.remove (unavailable: …)` with the app's reason, or
  `(unavailable)` when the app gave none.
- `destructive` after a tool's name says its author marked it as an action
  that cannot be undone.

## Pass the input

`--params` takes the tool's input as one JSON object. One tool serves every
`ProjectRow`, so name the row by the id after its class: the id goes in
`id`, and the action's own arguments in `args`. To remove Q4 survey and
rename Launch plan:

```sh
ayme call ProjectRow.remove --params '{"id": "po2"}'
ayme call ProjectRow.rename --params '{"id": "po1", "args": {"name": "Launch plan v2"}}'
```

- Leave `args` out when the action takes no arguments, and `--params` out
  when the tool takes no input: `ayme call ProjectsPage.openNewProjectDialog`.
- `ProjectsPage` has no root, so it has no id, and its tools take the
  action's arguments directly, without `id` and `args`.
- For long input, write the object to a file and pass `--params @<file>`,
  within the limits
  [What the agent sees](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md#what-the-agent-sees)
  gives.

## Which Tab a call runs on

- A tool that takes an id runs on the Tab its Page Object is on. Leave
  `--tab` out of that call.
- Any other tool runs on the Tab `--tab` names, or else on the most recently
  active one.
- An id stays with its Page Object while it is on the page, and is never
  given to another. When a call answers that the Page Object is not on the
  page, run `ayme page-objects` for the current ids.

## Read the answer

`ayme call` answers in a few lines:

- `settled`: whether the page settled after the action. It is `false` after
  an action that started loading a new document, even when the answer
  already comes from the new page.
- `result`: what the action returned, when that is a JSON value.
- `url`: the new URL, when the action changed it.
- `changes`: how the Page Object Tree changed. A Page Object that appeared
  is shown in full, with its children and its id; one that went away is
  marked removed; a value that changed reads old → new.

Read `url` and `changes` first. When they show the effect you expected, move
on, whatever `settled` says. When they do not, or `changes` is missing after
a load, wait with your browser automation, then run `ayme page-objects`.

## When a call does not run through

- **Refused**: the answer is the reason alone, such as
  `RuntimeStateError: ProjectRow "po2" is unavailable: No item is selected.`
  Input that does not match the tool's parameters is refused before the
  action runs, with a sentence for each problem.
- **Failed**: the answer says what failed, then `changes:` when the Page
  Object Tree changed while the action ran. Read how far the action got
  before you call it again.
- **A dialog**: when an answer says a dialog `is open on the tab`, answer the
  dialog with your browser automation. Then the end of that answer tells you
  what to do:
  - `… then run this command again.`: the dialog was open before the command
    started, so the command did nothing. Run it again.
  - `The action stopped there: …`: the action ran up to the dialog and
    stopped. Part of it may have happened, so a second call can repeat it.
    Check the page with your browser automation, and do only what is left of
    the step.
