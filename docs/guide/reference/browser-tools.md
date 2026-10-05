# Browser Tools

Every built-in tool Ayme publishes, with its input.

## Browser Tools

| Tool               | Input                                             |
| ------------------ | ------------------------------------------------- |
| `click`            | `target`, `doubleClick?`, `button?`, `modifiers?` |
| `hover`            | `target`                                          |
| `type`             | `target`, `text`, `submit?`, `slowly?`            |
| `fill`             | `target`, `text`                                  |
| `fill_form`        | `fields`: `{ target, name, type, value }[]`       |
| `check`            | `target`                                          |
| `uncheck`          | `target`                                          |
| `select_option`    | `target`, `values`                                |
| `press_key`        | `key`                                             |
| `generate_locator` | `groups`: `{ targets, within? }[]`                |
| `navigate`         | `url`                                             |
| `navigate_back`    | none                                              |
| `navigate_forward` | none                                              |
| `reload`           | none                                              |

- `target` is a Structural Ref from `snapshot`, or a selector: CSS, `xpath=`, or a Playwright selector such as `role=button[name="Save"]` or `text=Save`. A selector must match exactly one element; one that matches several fails and never acts on the first. Locator expressions such as `getByRole('button', { name: 'Save' })` are rejected as an unsupported target.
- `type` replaces the field's value, or types one character at a time with `slowly: true`. `press_key` acts on the focused element.
- `fill_form` fills its fields in order and stops at the first that fails. Its `result` names the fields filled (`filled`) and the one that failed (`failed`, with its error). Fields filled before it stay filled.
- `generate_locator` turns targets into Playwright locator strings for your Page Object Model code, such as `getByRole('button', { name: 'Save' })`; a Structural Ref belongs to one capture and does not belong in code. It never acts on the page. Each group's locators are relative to its `within` container, ready for a component's `root`, or to the page without one. The result mirrors the input: each group repeats its `within` and lists `{ target, locator }` per target, in order. Each locator is Playwright's own generator's pick, test id first, and matches exactly its element, or the button or link around it. A target that cannot be resolved, or lies outside its container, gets `{ target, error }` instead, and a container that cannot be resolved gets `{ within, error }` for its group.
- `navigate` opens a path relative to the current page, or a URL on the page's own origin: through your app's router when runtime setup gives a [`navigate` function](ayme.md#createayme), otherwise through the browser Page's `goto`. A URL on another origin is refused: the new document would not run Ayme, so the connection to the page would be lost. An invalid URL, or one whose protocol is not `http:` or `https:`, is refused too. When your router function, or a router that takes over navigations through the browser's Navigation API, handles it, or only the fragment changes, the call waits for a Settled Page and returns the Change Record like a click. Otherwise the browser loads the URL as a new document, and the call answers as a [full page load](../guides/page-state.md#full-page-loads).
- `navigate_back` and `navigate_forward` move one entry back or forward in the page's history through the browser Page's `goBack` and `goForward`; `reload` reloads the page through its `reload`. Moving to an entry of the same document, such as one your client router created, waits for a Settled Page and returns the Change Record like a click. With no entry to move to, the page does not move and the call's `result` says so. Moving to an entry of another document, and a reload, load a new document, and the call answers as a [full page load](../guides/page-state.md#full-page-loads).
- An option a tool does not declare is rejected with an error naming it; it is never ignored.
- Every Browser Tool except `generate_locator` returns the action result: `page_changed`, `settled`, `changes` and, when it has one, the action's own `result`. [Page state](../guides/page-state.md) explains `changes`. An action that starts a [full page load](../guides/page-state.md#full-page-loads) answers with `loading` and `next` as well.

## snapshot and goal

| Tool       | Input                         |
| ---------- | ----------------------------- |
| `snapshot` | `names?`                      |
| `goal`     | `goal`, `maxSteps`, `values?` |

`snapshot` returns the page state, as [Page state](../guides/page-state.md) describes; `names` limits the Page Object Model definitions it includes. `goal` runs the Goal Loop and is published only when the Goal Loop is configured.

## In the Goal Loop

The single-element Browser Tools are operations the Goal Loop may choose, each for the elements its filter keeps:

| Tool             | Elements offered                                            |
| ---------------- | ----------------------------------------------------------- |
| `click`, `hover` | Not disabled, with an interactive role or a pointer cursor. |
| `type`, `fill`   | Elements text can actually be entered into.                 |
| `check`          | Checkboxes, radio buttons and switches.                     |
| `uncheck`        | Checkboxes and switches.                                    |
| `select_option`  | Select elements.                                            |

The loop picks the element from the page. It fills text, such as `fill`'s `text` or `select_option`'s `values`, only from the [Goal Values](../guides/goals-with-jev.md#goal-values) the calling agent passed; with none that fits a required field, choosing the tool ends the run with `needs_value`. `navigate` is an operation the loop may choose as well, with its `url` from the Goal Values in the same way. `navigate_back`, `navigate_forward` and `reload` take no input, so the loop runs them when it chooses them. `fill_form`, `press_key` and `generate_locator` are published only.

The tools act through playwright-lite inside the page; [Playwright in the browser](playwright-in-the-browser.md#synthetic-input) says how that differs from a real browser.
