# @ayme-dev/webmcp-inspector

Browser Inspector for Ayme Page Object Models. It shows the live POM classes
and their member states, a form for each generated tool, execution history,
browser traces, and the structural page state a model sees, in an isolated
open Shadow Root.

The panel floats, or docks to the left, the right or the bottom of the page,
and collapses to the ayme logo. It remembers its layout, sizes, positions and
theme per site in the page's `localStorage`, and falls back to its defaults
when storage is unavailable. Its theme follows the system until it's
overridden.

The Inspector is a React app on `@ayme-dev/design-system`. React is bundled
into the package, so a host app of any framework, or any React version, never
shares it. Its Tailwind stylesheet is compiled at build time and injected into
the Shadow Root only; the host document's head receives just the page
highlight style.

Enable it through the Vite integration:

```ts
import { aymeWebMcp } from "@ayme-dev/unplugin-webmcp/vite";

export default {
  plugins: [aymeWebMcp({ inspector: true })],
};
```

The plugin starts the Inspector before application modules run, so default and
supplied Pages are instrumented before their first Page Object is constructed.
No component props, mount call, or custom element registration is required.

`inspector: false` (the default) omits the Inspector startup module. Inspector
diagnostics work independently of WebMCP publication, so `publish: false` is a
supported combination.

The Inspector marks its body host and structural page-state capture temporarily
hides that host from the accessibility snapshot. The host is otherwise visible
and accessible, and its styles are contained by the Shadow Root.

The playground imports `withDemoFeedback` from
`@ayme-dev/webmcp-inspector/demo` to keep its teaching delay and click cue.
Applications do not need this demo-only entry point.

## Source layout

- `src/adapter`: the runtime adapter, the only code that reads webmcp or runs
  tools. It provides the structure tree model (`adapter/structure.ts`) and
  the page model of Page Objects and their models (`adapter/pageModel.ts`).
- `src/shell`: the panel's frame: layouts, header, collapsed logo and
  preferences.
- `src/frame`: the body: the navigator, the detail pane, the Runs region, the
  shared selection, and the `Lens` and run slot contracts.
- `src/lenses`: one file per lens, with its parts in a folder of its name.
  Each contributes its tree, its search entries, its legend counts and the
  detail views of what it selects.

Below the adapter, components take only props; lint enforces it.

## Testing

The Inspector is tested the way Ayme asks its users to test: through a Page
Object Model of the panel. `@ayme-dev/webmcp-inspector/testing` exports it
(ADR-0026: only tests may import a testing entry). `Inspector` takes a
Playwright `Page` and is built from one page object per part of the panel,
each rooted at a `Locator`. The same classes run on Playwright and on
playwright-lite's `createPage()`. They are plain classes, never registered
with the Ayme runtime, so their actions never become WebMCP tools.

```ts
import { Inspector } from "@ayme-dev/webmcp-inspector/testing";

const inspector = new Inspector(page);
await inspector.open();
const addItem = await inspector.tool("ListPage.addItem");
await addItem.run({ text: "Milk" });
```

Run from this directory inside the repository's Devbox shell:

- `pnpm test` runs the unit tests in jsdom (`*.test.ts`) and the component
  tests in Chromium through vitest browser (`*.browser.test.tsx`). A
  component test renders one part with fixture props into an open shadow
  root, as the Inspector renders itself (`src/renderPart.tsx`), and drives it
  through the page objects on playwright-lite.
- `pnpm test:e2e` tests the built package, so build first; Turbo's
  `test:e2e` task does. It runs Playwright on Chromium with native WebMCP
  (`--enable-features=WebMCP,WebMCPTesting`) against the fixture pages in
  `tests/fixture`, served on port 4291: a real Page Object, the Ayme runtime
  and the built Inspector. A fixture page that fails to start, a runtime that
  never publishes, or a browser without WebMCP fails before any test
  assertion, with its own message.

playwright-lite has no `page.mouse` and no `dragTo`. The page objects drag
by dispatching pointer events to the dragged element, which works on both
runners.
