# React

Everything about Ayme in a React app: setup, the provider, hooks, server rendering with Next.js, limits and the API of `@ayme-dev/react`.

## Setup

Install Ayme, the React package and the build plugin, with the Inspector and the Agent Connection for development, as the [React quickstart](../start/quickstart-react.md) does:

```sh
npm install @ayme-dev/ayme @ayme-dev/react
npm install -D @ayme-dev/unplugin-ayme @playwright/test @ayme-dev/inspector @ayme-dev/mcp
```

On Vite, add the plugin alongside the React plugin:

```ts
import react from "@vitejs/plugin-react";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [react(), ayme({ include: command === "serve" })],
}));
```

`include` keeps Ayme in the dev server and out of `vite build`; [Include Ayme in a build](../reference/build-plugin.md#include-ayme-in-a-build) covers the builds that keep it.

On Next.js, use the Turbopack loader, as the [build plugin reference](../reference/build-plugin.md#nextjs) shows. Mark your Page Object Models as [Page Object Models](../guides/ayme-page-objects.md) shows.

## Start Ayme at the root

Wrap the app in `AymeProvider`, with the Inspector and the Agent Connection in development:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AymeProvider } from "@ayme-dev/react";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AymeProvider
      inspector={import.meta.env.DEV}
      agentConnection={import.meta.env.DEV}
    >
      <App />
    </AymeProvider>
  </StrictMode>
);
```

The provider takes the [`createAyme` options](../reference/ayme.md#createayme) as props, such as `pageFactory`, `ignore`, `pageObjects`, `inspector` and `agentConnection`. Your coding agent then connects to the page as [Connect an agent](../guides/connect-an-agent.md) shows.

## Root ownership

The props must stay fixed while the provider is mounted; remount the provider and its consumers to change them.

Only one owner can run Ayme in a document. A provider nested inside another provider throws. A second provider elsewhere in the tree, or a `createAyme().start()` outside React, is rejected while the first owner runs. Unmounting the provider stops publication and observation.

In development, Strict Mode runs the provider's effect twice: Ayme starts, stops and starts again on the same session. The Page and the Page Objects are kept.

Wrap the application root, not a route component or a layout that unmounts on navigation. Suppose `AymeProvider` sits in a `ProjectsLayout` that renders only under `/projects`. An agent calls a `ProjectsPage` action that clicks the Settings link. The router leaves `/projects` and unmounts `ProjectsLayout`, and the provider with it. Unmounting the provider stops Ayme and closes the agent connection. The agent can lose the answer to its call.

## Hooks

Give your pages a base class whose `present` checks the URL, as [`@ayme`](../guides/ayme-page-objects.md#ayme) shows:

```ts
// src/pom/AppPage.ts
import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

const onPage = (self: AppPage) =>
  new URLPattern({ pathname: self.path }).test(self.page.url());

@ayme({ present: onPage })
export abstract class AppPage {
  abstract readonly path: string;
  constructor(readonly page: Page) {}
}
```

```ts
// src/pom/ProjectsPage.ts
import { ayme } from "@ayme-dev/ayme";
import { AppPage } from "./AppPage";

export class ProjectsPage extends AppPage {
  readonly path = "/projects";

  @ayme.action
  async createProject(name: string) {
    await this.page.getByRole("button", { name: "New project" }).click();
    await this.page.getByRole("textbox", { name: "Project name" }).fill(name);
    await this.page.getByRole("button", { name: "Create" }).click();
  }
}
```

`SettingsPage` extends `AppPage` the same way, with `path = "/settings"`. Register both once, in the provider's `pageObjects` prop:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AymeProvider } from "@ayme-dev/react";
import App from "./App";
import { ProjectsPage } from "./pom/ProjectsPage";
import { SettingsPage } from "./pom/SettingsPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AymeProvider
      pageObjects={[ProjectsPage, SettingsPage]}
      inspector={import.meta.env.DEV}
      agentConnection={import.meta.env.DEV}
    >
      <App />
    </AymeProvider>
  </StrictMode>
);
```

On `/projects`, the agent's tool list has `ProjectsPage.createProject`. On `/settings`, it doesn't. A model with no `present` or `root` anywhere in its class chain is present while it is registered. The [quickstart](../start/quickstart-react.md)'s `ProjectsPage` extends nothing, so registered on its own, its tools are listed on every route.

Call the hooks in descendants of the provider. A component that calls an action gets the session's instance from `usePageObject`, which also registers the class while the component is mounted:

```tsx
import { usePageObject } from "@ayme-dev/react";
import { ProjectsPage } from "./pom/ProjectsPage";

export default function Controls() {
  const pom = usePageObject(ProjectsPage);

  return (
    <button onClick={() => void pom.createProject("Launch plan")}>
      Show me how
    </button>
  );
}
```

- `usePageObject(Model)` returns the session's instance of the class immediately and registers the class after commit. The session keeps one instance per class, so every component, and a remount, gets the same one; keep no per-component state in a Page Object's fields. Constructors must only initialize fields and compose locators: do not run actions, register listeners or start other activity in them. Changing the model class requires remounting the component. Unmounting it removes its registration.
- `useAyme()` returns the provider's session, `ayme`, and its WebMCP publication, `webMCP`.

Hooks need the provider in an ancestor component, and throw without it. A hook in the component that renders the provider throws too:

```tsx
function App() {
  const pom = usePageObject(ProjectsPage); // throws: the provider is below, not above
  return <AymeProvider>…</AymeProvider>;
}
```

Move the hook into a child component rendered inside `AymeProvider`, such as `Controls` above.

## Optional: publish with WebMCP

To publish the same tools through WebMCP for agents that run in the browser, as [Publish tools](../guides/publish-tools.md) describes, install the publication package:

```sh
npm install @ayme-dev/webmcp
```

Then add `webMCP` to the provider's props:

```tsx
<AymeProvider
  inspector={import.meta.env.DEV}
  agentConnection={import.meta.env.DEV}
  webMCP={{ enabled: true }}
>
  <App />
</AymeProvider>
```

`useAyme()` returns `webMCP` as React state. `webMCP.publicationStatus` is a read-only snapshot that updates with renders. When its `state` is `"unavailable"` (no WebMCP driver found) or `"failed"`, `webMCP.retryPublication()` tries again:

```tsx
import { useAyme } from "@ayme-dev/react";

export default function PublicationStatus() {
  const { webMCP } = useAyme();

  return (
    <>
      <p>Publication: {webMCP.publicationStatus.state}</p>
      <button onClick={() => void webMCP.retryPublication()}>
        Retry publication
      </button>
    </>
  );
}
```

## Server rendering

The provider and hooks render on the server without starting anything, and hydration constructs the real Page Objects. The experimental [`usePeek`](#api) hook adds its Peek in an effect. Effects never run on the server. In the Next.js App Router, put `AymeProvider` in a `"use client"` module that the root layout renders, so it owns every page and stays mounted across navigation, and call its hooks from `"use client"` components:

```tsx
// app/ayme-runtime.tsx
"use client";

import type { ReactNode } from "react";
import { AymeProvider } from "@ayme-dev/react";

export default function AymeRuntime({ children }: { children: ReactNode }) {
  return (
    <AymeProvider
      inspector={process.env.NODE_ENV === "development"}
      agentConnection={process.env.NODE_ENV === "development"}
    >
      {children}
    </AymeProvider>
  );
}
```

```tsx
// app/layout.tsx
import type { ReactNode } from "react";
import AymeRuntime from "./ayme-runtime";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AymeRuntime>{children}</AymeRuntime>
      </body>
    </html>
  );
}
```

```tsx
// app/projects/projects.tsx
"use client";

import { usePageObject } from "@ayme-dev/react";
import { ProjectsPage } from "../../pom/ProjectsPage";

export default function Projects() {
  const pom = usePageObject(ProjectsPage);
  return (
    <button onClick={() => void pom.createProject("My first project")}>
      Show me how
    </button>
  );
}
```

```tsx
// app/projects/page.tsx
import Projects from "./projects";

export default function ProjectsRoute() {
  return <Projects />;
}
```

The build needs the Turbopack loader from the [build plugin reference](../reference/build-plugin.md#nextjs). The [Next.js example](https://github.com/ayme-labs/ayme/blob/main/apps/example-next/README.md) runs this setup, and [Server rendering](../guides/server-rendering.md) says what runs where.

## Bundle size

Ayme's runtime adds about 990 kB raw (about 295 kB transferred) to the JavaScript a page loads at start, in a build that includes it. About 860 kB raw of it is in the entry chunk. That is over Vite's 500 kB chunk warning. The Inspector is a separate chunk that loads only when it is on.

A build includes Ayme only with the plugin's `include: true`. The config above keeps Ayme in the dev server and out of `vite build`; see [Include Ayme in a build](../reference/build-plugin.md#include-ayme-in-a-build).

## Limits

- The supported React and Next.js versions are on [Install](../start/install.md#supported-versions).
- Change the props or the model class only by remounting.

## Troubleshooting

| Error                                                                        | Cause                                                                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `AymeProvider cannot be nested beneath another Ayme runtime owner.`          | A second provider beneath the first. Start Ayme once, at the root.                     |
| `The provider options changed while the provider was mounted.`               | A provider prop changed while mounted.                                                 |
| `Ayme hooks require an ancestor AymeProvider.`                               | A hook without a provider above, including in the component that renders the provider. |
| `The Page Object model or provider changed while the component was mounted.` | `usePageObject` got a different model.                                                 |

## API

| Export                       | Kind      | Does                                                                                                                                                              |
| ---------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AymeProvider`               | Component | Starts and owns Ayme for its subtree. Props are the `createAyme` options.                                                                                         |
| `useAyme()`                  | Hook      | Returns `{ ayme, webMCP }` from the provider above.                                                                                                               |
| `usePageObject(Model)`       | Hook      | Returns the class's instance and registers it while the component is mounted.                                                                                     |
| `usePeek(values, name, id?)` | Hook      | [Experimental](../reference/experimental-apis.md). Adds the component's instance of the Peek `name` while it is mounted, reading `values` from its latest render. |
