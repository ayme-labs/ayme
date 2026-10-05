# Inspector source layout and testing

`src/` is cut into slices named for what they do, with layers inside each slice. [`eslint.config.js`](eslint.config.js) is the source of truth for which slices and layers each may use, and for what may read the runtime; `pnpm lint` flags a misplaced import.

Slices, from the bottom up:

- `shared`: the look at the page, what each Playwright call does, rendering into the shadow root, shared UI bits.
- `panel`: the dockable panel, its preferences and its body layout.
- `navigation`: the selection, the lens contract, the run slot, the navigator and the page highlights.
- `page-model`: the Page Object tree and the Model lens.
- `structure`: the page state tree, member selection and the Structure lens.
- `runs`: running a tool, its steps and the trace, and Runs.
- `tools`: the tool list, the run card and its fields, and ref picking.
- `demo`: the wrapper on the runtime's Pages: the trace Runs records, and demo mode's pause and click cue.
- `app`: the composition root: mounting, the stylesheet and the wiring of every slice.
- `testing`: the Inspector POM; its `index.ts` is the `./testing` entry.

Layers, only where a slice has that kind of code: `domain` (pure rules and types), `application` (interaction policy), `infrastructure` (the runtime, the host document, storage, the trace), `presentation` (UI-logic hooks and containers), `view` (components that take props and callbacks), `test-utils` (test-only data and harnesses).

- Every file of a layered slice sits in a layer folder, except its `index.ts`.
- The layer rule holds inside a slice. Another slice is reached through its `index.ts`, which lint can't see past, so import only from the layers yours may use.
- A component with state is three files: `useX` in `presentation/` holds the logic, `XView` in `view/` the markup, and the `X` container wires them.
- When an import runs against the slice order, move the shared part down into the lower slice.

## How the slices work

- `shared` keeps the Inspector's look at the page live: page changes, input,
  focus and registry changes schedule a refresh (debounced, one at a time),
  and each refresh is one unrecorded peek at the page state, so the
  Inspector never changes what agents see.
- `page-model` holds the Page Objects on the page and their models, indexed
  by member path, so members, their groups and owners resolve by lookup.
  `structure` builds the structure tree model from the projected page state.
- Each lens contributes its tree, its search entries, its legend counts and
  the detail views of what it selects, through `navigation`'s `Lens`
  contract. Detail views run tools through the run slot, which the run card
  in `tools` fills: the typed form built from a tool's schema, the item
  picker and the last result. `RefField` is the ref field's control, and
  `KeyField` records or searches the key `press_key` presses. `ValueRows`
  edits a map of labelled strings or numbers, such as `goal`'s `values`, as
  rows whose type is guessed until the person fixes it. `fill_form`
  has its own form, `FillFormFields`: every field on the page, holding the
  value it shows, sending the ones the person changes. `generate_locator`
  has `LocatorGroups`: one group per page object class, each with a
  container and the targets picked on the page or from a structure tree
  that opens inside the group, each showing the locator the last run gave it.
- `runs` holds Runs, the timeline of the runs made from the panel, and
  which runs belong to the selection.
- `shared`'s `describeCall` says what a call on the runtime's Page does:
  whether it acts, clicks or waits, which elements it hit-tests, and the step
  Runs records. Its tables classify every method of Playwright's Locator,
  Page, Keyboard and Mouse, so a Playwright release that adds one fails
  typecheck until it is classified. The `demo` wrapper only applies that:
  it records the step, lets hit-tested elements pass through the panel, and
  in demo mode pauses before each action and cues each click.

Only infrastructure code, and the mount that installs the Inspector's
instrumentation, reads `@ayme-dev/ayme` at runtime; components take props.

## Testing

The Inspector is tested the way Ayme asks its users to test: through a Page
Object Model of the panel. `@ayme-dev/inspector/testing` exports it
(ADR-0026: only tests may import a testing entry). `Inspector` takes a
Playwright `Page` and is built from one page object per part of the panel,
each rooted at a `Locator`. The same classes run on Playwright and on
playwright-lite's `createPage()`. They are plain classes, never registered
with the Ayme runtime, so their actions never become WebMCP tools.

On Playwright, register the `ayme-inspector` selector engine before the page
is created. The engine shares its name with the Inspector's host element but
is a different thing: `ayme-inspector=<css>` is a Playwright selector. It
reaches into the closed Shadow Root through a test-only hook the mount leaves
on its host element; the hook is not public API.

```ts
import { selectors } from "@playwright/test";
import {
  Inspector,
  registerInspectorSelectors,
} from "@ayme-dev/inspector/testing";

test.beforeAll(() => registerInspectorSelectors(selectors));

const inspector = new Inspector(page);
await inspector.open();
const addItem = await inspector.tool("ListPage.addItem");
await addItem.run({ text: "Milk" });
```

Run from this directory inside the repository's Devbox shell:

- `pnpm test` runs the unit tests in jsdom (`*.test.ts`) and the component
  tests in Chromium through vitest browser (`*.browser.test.tsx`). A
  component test renders one part with fixture props into an open shadow
  root it owns (`src/testing/renderPart.tsx`), with the Inspector's
  stylesheet and themed root, and drives it through the page objects on
  playwright-lite.
- The end-to-end tests, which run the built package on fixture pages, live in
  [`apps/inspector-fixture`](https://github.com/ayme-labs/ayme/tree/main/apps/inspector-fixture).
  The app builds its Page Objects with the Ayme plugin, which depends on this
  package, so the tests can't live here.

playwright-lite's `page.mouse` and `dragTo` don't follow pointer capture. The
page objects drag by dispatching pointer events to the dragged element, which
works on both runners.
