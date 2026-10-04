# Quickstart: React

From a Vite React app to a Page Object Tool your coding agent calls.

## 1. Install

```sh
npm install @ayme-dev/ayme @ayme-dev/react
npm install -D @ayme-dev/unplugin-ayme @playwright/test @ayme-dev/inspector
```

## 2. Add the build plugin

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), ayme()],
});
```

Enable decorators in the tsconfig that covers your Page Object Models:

```json
{ "compilerOptions": { "experimentalDecorators": true } }
```

On Next.js, use the Turbopack loader instead, as the [build plugin reference](../reference/build-plugin.md#nextjs) shows.

## 3. Write a Page Object Model

```ts
// src/pom/ProjectsPage.ts
import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

@ayme
export class ProjectsPage {
  constructor(private readonly page: Page) {}

  @ayme.action({ description: "Create a project with the given name." })
  async createProject(name: string) {
    await this.page.getByRole("button", { name: "New project" }).click();
    await this.page.getByRole("textbox", { name: "Project name" }).fill(name);
    await this.page.getByRole("button", { name: "Create" }).click();
  }
}
```

If your Playwright tests already have a Page Object Model for this page, mark that one instead.

## 4. Start Ayme and use the Page Object

Wrap the app in `AymeProvider` with publication on and the Inspector in development, and use the Page Object in a component:

```tsx
// src/main.tsx
import { StrictMode, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { AymeProvider, usePageObject } from "@ayme-dev/react";
import { ProjectsPage } from "./pom/ProjectsPage";

function Projects() {
  const pom = usePageObject(ProjectsPage);
  const [projects, setProjects] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  function create(event: FormEvent) {
    event.preventDefault();
    setProjects((current) => [...current, name]);
    setName("");
    setCreating(false);
  }

  return (
    <>
      <button onClick={() => void pom.createProject("My first project")}>
        Show me how
      </button>
      <button onClick={() => setCreating(true)}>New project</button>
      {creating && (
        <form onSubmit={create}>
          <label>
            Project name{" "}
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit">Create</button>
        </form>
      )}
      <ul>
        {projects.map((project) => (
          <li key={project}>{project}</li>
        ))}
      </ul>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AymeProvider webMCP={{ enabled: true }} inspector={import.meta.env.DEV}>
      <Projects />
    </AymeProvider>
  </StrictMode>
);
```

## 5. Call it

Run the dev server. The Inspector opens on the page: its Tools lens lists `ProjectsPage.createProject`, and running it with a name creates the project while you watch. The "Show me how" button does the same from your own code, the way an onboarding checklist would.

To call it from your coding agent, connect the agent to the page through the WebMCP local relay, as [Connect an agent](../guides/connect-an-agent.md) shows, and ask it to create a project. It calls `ProjectsPage.createProject`.

## Next

- [React](../frameworks/react.md): the provider, root ownership, hooks and Next.js.
- [Page Object Models](../guides/page-object-models.md): tool names, inputs and Page Object Children.
- [Goals with Jev](../guides/goals-with-jev.md): hand the page a goal instead of single calls.
