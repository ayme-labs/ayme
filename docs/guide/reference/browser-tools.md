# Browser Tools

Every built-in tool Ayme publishes, with its input.

## Browser Tools

| Tool            | Input                                             |
| --------------- | ------------------------------------------------- |
| `click`         | `target`, `doubleClick?`, `button?`, `modifiers?` |
| `hover`         | `target`                                          |
| `type`          | `target`, `text`, `submit?`, `slowly?`            |
| `fill`          | `target`, `text`                                  |
| `fill_form`     | `fields`: `{ target, name, type, value }[]`       |
| `check`         | `target`                                          |
| `uncheck`       | `target`                                          |
| `select_option` | `target`, `values`                                |
| `press_key`     | `key`                                             |

- `target` is a Structural Ref from `snapshot`, or a selector: CSS, `xpath=`, or a Playwright selector such as `role=button[name="Save"]` or `text=Save`. A selector must match exactly one element; one that matches several fails and never acts on the first. Locator expressions such as `getByRole('button', { name: 'Save' })` are rejected as an unsupported target.
- `type` replaces the field's value, or types one character at a time with `slowly: true`. `press_key` acts on the focused element.
- `fill_form` fills its fields in order and stops at the first that fails. Its `result` names the fields filled (`filled`) and the one that failed (`failed`, with its error). Fields filled before it stay filled.
- An option a tool does not declare is rejected with an error naming it; it is never ignored.
- Every Browser Tool returns the action result: `page_changed`, `settled`, `changes` and, when it has one, the action's own `result`. [Page state](../guides/page-state.md) explains `changes`.

## snapshot and goal

| Tool       | Input              |
| ---------- | ------------------ |
| `snapshot` | `names?`           |
| `goal`     | `goal`, `maxSteps` |

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

The loop fills only the element and the required fields. `fill_form` and `press_key` are published only.

The tools act through playwright-lite inside the page; [Playwright in the browser](playwright-in-the-browser.md#synthetic-input) says how that differs from a real browser.
