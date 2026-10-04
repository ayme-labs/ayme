# @ayme-dev/inspector

Browser Inspector for Ayme Page Object Models, in an isolated closed Shadow
Root. Its navigator has three lenses: Model (the Page Objects on the page and
the Page Object Models it knows, with their member states), Structure (the
Structural Page State a model sees, each node tagged with its member) and
Tools (every published tool). Every detail runs its tools through one run
card; a tool's page and a structure node's detail also show what the model
sees of them. Runs lists the runs made from the panel with their arguments, steps and
result, which can be copied.

The panel floats, or docks to the left, the right or the bottom of the page,
and collapses to the ayme logo. It remembers its layout, sizes, positions and
theme per site in the page's `localStorage`, and falls back to its defaults
when storage is unavailable. Its theme follows the system until it's
overridden.

The Inspector is a React app on `@ayme-dev/design-system`. React is bundled
into the package, so a host app of any framework, or any React version, never
shares it. Its Tailwind stylesheet is compiled at build time and injected into
the Shadow Root only; the host document's head receives just the page
highlight style and, while the panel is docked, a style that pads the page's
root on the docked side so the panel sits beside the page. That style is
removed when the panel floats, collapses or unmounts.

Enable it through the Vite integration:

```ts
import { ayme } from "@ayme-dev/unplugin-ayme/vite";

export default {
  plugins: [ayme({ inspector: true })],
};
```

The plugin starts the Inspector before application modules run, so default and
supplied Pages are instrumented before their first Page Object is constructed.
No component props, mount call, or custom element registration is required.

`inspector: false` (the default) omits the Inspector startup module. Inspector
diagnostics work independently of WebMCP publication, so the Inspector works
while publication is off.

The Inspector mounts on an `<ayme-inspector>` element at the end of the body,
so the page's `div` rules and queries never match it; it is not a registered
custom element. Structural page-state capture temporarily hides that host from
the accessibility snapshot. The host is otherwise visible and accessible, and
its styles are contained by the Shadow Root.

The Inspector paints above the page's own UI: its host takes the highest
z-index there is. Only the browser's top layer (modal dialogs, popovers,
fullscreen), or page content at that same z-index after the host, covers it.
Outside the panel and the collapsed logo, the page keeps its pointer. A
runtime pointer action, such as an agent's click, whose target is under the
panel passes through it: the panel ignores the pointer until that action ends.
A person moves, docks or collapses the panel instead.

The Shadow Root is closed, so no locator on the host page, whether
Playwright's or the runtime's, sees inside it: a Page Object member never
matches the Inspector's own text.

The playground imports `withDemoFeedback` from
`@ayme-dev/inspector/demo` to keep its teaching delay and click cue.
Applications do not need this demo-only entry point.

## Source layout

- `src/adapter`: the runtime adapter, the only code that reads `@ayme-dev/ayme` or runs
  tools. It provides the structure tree model (`adapter/structure.ts`), the
  page model of Page Objects and their models (`adapter/pageModel.ts`), and
  the page model indexed by member path (`adapter/memberIndex.ts`), which
  resolves members, their groups and owners by lookup.
  It keeps the structure live: page changes, input, focus and registry changes schedule a
  refresh (debounced, one at a time), and each refresh is one unrecorded
  peek at the page state, so the Inspector never changes what agents see.
- `src/shell`: the panel's frame: layouts, header, collapsed logo and
  preferences.
- `src/frame`: the body: the navigator, the detail pane, the Runs region, the
  shared selection, and the `Lens` and run slot contracts.
- `src/lenses`: one file per lens, with its parts in a folder of its name.
  Each contributes its tree, its search entries, its legend counts and the
  detail views of what it selects.
- `src/detail`: parts any detail view can use, such as "What the model
  sees", the syntax-highlighted definitions and schemas an agent receives.
- `src/runCard`: the run card that fills the run slot: the typed form built
  from a tool's schema, the item picker and the last result. Each field's
  control is chosen by its kind; `RefField` is the ref field's, and
  `KeyField` records or searches the key `press_key` presses.
  `fill_form` has its own form, `FillFormFields`: every field on the page,
  holding the value it shows, sending the ones the person changes.
- `src/runs`: Runs, the timeline of the runs made from the panel, and which
  runs belong to the selection.

Below the adapter, components take only props; lint enforces it.

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
  root it owns (`src/renderPart.tsx`), with the Inspector's stylesheet and
  themed root, and drives it through the page objects on playwright-lite.
- The end-to-end tests, which run the built package on fixture pages, live in
  [`apps/inspector-fixture`](https://github.com/ayme-labs/ayme/tree/main/apps/inspector-fixture).
  The app builds its Page Objects with the Ayme plugin, which depends on this
  package, so the tests can't live here.

playwright-lite's `page.mouse` and `dragTo` don't follow pointer capture. The
page objects drag by dispatching pointer events to the dragged element, which
works on both runners.
