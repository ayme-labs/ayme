# React

Everything about Ayme in a React app: setup, the provider, hooks, server rendering with Next.js, limits and the API of `@ayme-dev/react`.

## Setup

Install Ayme, the React package, WebMCP publication and the build plugin, and the Inspector if you want it:

```sh
npm install @ayme-dev/ayme @ayme-dev/react @ayme-dev/webmcp
npm install -D @ayme-dev/unplugin-ayme @playwright/test @ayme-dev/inspector
```

On Vite, add the plugin alongside the React plugin:

```ts
import react from "@vitejs/plugin-react";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), ayme()],
});
```

On Next.js, use the experimental Turbopack loader, as the [build plugin reference](../reference/build-plugin.md#nextjs) shows. Mark your Page Object Models as [Page Object Models](../guides/page-object-models.md) shows.

## Start Ayme at the root

Wrap the app in `AymeProvider`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AymeProvider } from "@ayme-dev/react";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AymeProvider webMCP={{ enabled: true }}>
      <App />
    </AymeProvider>
  </StrictMode>
);
```

The provider takes the [`createAyme` options](../reference/ayme.md#createayme) as props, such as `pageFactory`, `ignore` and `inspector` (`inspector={import.meta.env.DEV}` on Vite).

## Root ownership

The props must stay fixed while the provider is mounted; remount the provider and its consumers to change them. One owner may be active: nested providers and concurrent owners are rejected. Unmounting the provider stops publication and observation. React's Strict Mode cleanup and setup replay keeps the Page and the instances.

Wrap the application root, not a route component or a layout that unmounts on navigation. Unmounting the provider stops Ayme, which ends its publication and agent connection, so a tool call whose action navigates away from that component can lose its answer.

## Hooks

Call the hooks in descendants of the provider:

```tsx
import { useAyme, usePageObject } from "@ayme-dev/react";
import { ProjectsPage } from "./playwright/pom/ProjectsPage";

export default function Controls() {
  const pom = usePageObject(ProjectsPage);
  const { ayme, webMCP } = useAyme();

  return (
    <>
      <p>{webMCP.publicationStatus.message}</p>
      <button onClick={() => void pom.createProject("Launch plan")}>
        Increment
      </button>
      <button onClick={() => void webMCP.retryPublication()}>
        Retry publication
      </button>
    </>
  );
}
```

- `usePageObject(Model)` returns the session's instance of the class immediately and registers the class after commit. The session keeps one instance per class, so every component, and a remount, gets the same one; keep no per-component state in a Page Object's fields. Constructors must only initialize fields and compose locators: do not run actions, register listeners or start other activity in them. Changing the model class requires remounting the component. Unmounting it removes its registration.
- `useAyme()`'s `webMCP` is React state: `webMCP.publicationStatus` is a read-only snapshot that updates with renders.
- Hooks without an ancestor provider throw. A provider returned from a component does not supply context to hooks called in that same component.

## Server rendering

The provider and hooks render on the server without starting anything, and hydration constructs the real Page Objects. `usePeek` adds its instance in an effect, which never runs on the server. In the Next.js App Router, put `AymeProvider` and the components that call its hooks in a `"use client"` module, and render it from a server component:

```tsx
// app/projects.tsx
"use client";

import { AymeProvider, usePageObject } from "@ayme-dev/react";
import { ProjectsPage } from "../pom/ProjectsPage";

function Projects() {
  const pom = usePageObject(ProjectsPage);
  return (
    <button onClick={() => void pom.createProject("My first project")}>
      Show me how
    </button>
  );
}

export default function ProjectsWithAyme() {
  return (
    <AymeProvider
      webMCP={{ enabled: true }}
      inspector={process.env.NODE_ENV === "development"}
    >
      <Projects />
    </AymeProvider>
  );
}
```

```tsx
// app/page.tsx
import ProjectsWithAyme from "./projects";

export default function Home() {
  return <ProjectsWithAyme />;
}
```

The build needs the Turbopack loader from the [build plugin reference](../reference/build-plugin.md#nextjs). The [Next.js example](../../../apps/example-next/README.md) runs this setup, and [Server rendering](../guides/server-rendering.md) says what runs where.

## Limits

- The supported React and Next.js versions are on [Install](../start/install.md#supported-versions).
- Change the props or the model class only by remounting.

## Troubleshooting

| Error                                                                                                     | Cause                                                                                  |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `AymeProvider cannot be nested beneath another Ayme runtime owner.`                                       | A second provider beneath the first. Start Ayme once, at the root.                     |
| `The provider options must stay fixed while mounted. Remount the provider to change them.`                | A provider prop changed while mounted.                                                 |
| `Ayme hooks require an ancestor AymeProvider.`                                                            | A hook without a provider above, including in the component that renders the provider. |
| `The Page Object model and provider must stay fixed while mounted. Remount the component to change them.` | `usePageObject` got a different model.                                                 |

## API

| Export                       | Kind      | Does                                                                                                           |
| ---------------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `AymeProvider`               | Component | Starts and owns Ayme for its subtree. Props are the `createAyme` options.                                      |
| `useAyme()`                  | Hook      | Returns `{ ayme, webMCP }` from the provider above.                                                            |
| `usePageObject(Model)`       | Hook      | Returns the class's instance and registers it while the component is mounted.                                  |
| `usePeek(values, name, id?)` | Hook      | Adds the component's instance of the Peek `name` while it is mounted, reading `values` from its latest render. |
