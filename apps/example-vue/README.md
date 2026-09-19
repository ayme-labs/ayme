# Ayme WebMCP playground

This browser playground combines a functional list app with an Ayme inspector so the same Page Object behavior can be exercised by a person or an agent. It is published at [ayme-labs.github.io/ayme](https://ayme-labs.github.io/ayme/).

- The demo app lets you add items and archive them through a confirmation dialog.
- `ListPage` is a normal TypeScript class using `Page` and `Locator` types from Playwright. Vite bundles that same class for WebMCP and constructs it with the DOM-backed browser implementation.
- `@WebMCP` and `@WebMCP.tool()` choose the production WebMCP surface. Tool descriptions come from the decorator.
- Registered page tools use their fully qualified POM method name, such as `ListPage.addItem`. A collection component action is registered once, at its collection path, such as `ListPage.items.archive`.
- A collection component action receives a generated `index` followed by an `args` object derived from its TypeScript method parameters: `ListPage.items.archive({ index: 0, args: {} })`.
- The bundler-neutral POM compiler reads the nearest `tsconfig.json` and derives each decorated method's input schema and each public `Locator` member as POM metadata. The Vite plugin is a thin adapter that places this metadata in the browser bundle. It derives nested, JSON-shaped object inputs too; the decorator does not duplicate parameter types or schemas.
- POM metadata also describes components constructed from a locator root, including repeated components exposed as paths such as `items[0].archiveButton`.
- `App.vue` calls `useAymeWebMcp()` to own the runtime and `usePageObject(ListPage)` to register the imported POM instance.
- The runtime publishes the same registered tool objects to `document.modelContext` and the in-page debug console.
- The in-page inspector separates the App Model view (POM metadata, actions, executions, and traces) from the Page State view, which renders a YAML snapshot of the demo application with capture-scoped refs and POM decorations.
- The POM inspector probes registered members against the current DOM and refreshes when the demo changes. It does not use framework bindings or element identity.
- The browser runtime is DOM-backed. It supports the locator operations used by the POM, including role/name lookup, filling, clicking, and visible/hidden waits, without requiring Playwright at runtime.

## Try with your agent

Start with the repository's [Ayme setup skill](../../skills/ayme/SKILL.md), then follow the [browser setup guide](../../skills/ayme/references/browser-setup.md) to connect a local MCP relay. The hosted playground has no hosted agent backend; the relay runs on your machine and discovers the tools exposed by this page. The [playground onboarding guide](./ONBOARDING.md) condenses the hosted flow.

The hosted bundle initializes the pinned WebMCP polyfill before the Vue app starts. Use the setup guide's `webmcp_list_sources`, `webmcp_list_tools`, and tool invocation flow to exercise the list actions.

## User interface

The demo UI is built entirely from [shadcn-vue](https://www.shadcn-vue.com/) components copied into `src/components/ui`, on Tailwind CSS v4 with the default Neutral theme in light mode. The app carries no custom CSS: `src/style.css` holds only the Tailwind import and the theme tokens, and layout is expressed with Tailwind utilities in the templates. Add components with the shadcn-vue CLI or by copying the upstream source; do not hand-write new ones.

## Application setup

Call the lifecycle API once in the application root, before registering Page Objects:

```ts
import { useAymeWebMcp, usePageObject } from "@ayme-dev/webmcp-vue";
import { ListPage } from "./playwright/pom/ListPage";

useAymeWebMcp();
usePageObject(ListPage);
```

Enable publication with `aymeWebMcp({ publish: true })` in Vite configuration. No page argument or application watcher is required. Components can call `usePageObject` for their own scope, and disposal is automatic.

This example passes a custom page from `useDemoTrace` to add slow typing, click cues, and trace recording. `useDemoRelay` loads the local relay after publication becomes active. `useDemoInspector` manages the debug panel and DOM highlights. These helpers support the demo and are optional for applications.

Disabling publication does not remove Ayme or Page Object code from the bundle. Production code removal is tracked separately in issue #39.

Run from this directory inside the repository's Devbox shell:

```sh
pnpm install
pnpm run typecheck
pnpm run test:e2e
```

The browser test injects a minimal `document.modelContext`, verifies the two published tools and their compiler-derived schemas, exercises direct list interaction, then invokes the published collection WebMCP tool and the same tool through the debug console against the real DOM-backed runtime.
