# Quickstart: Svelte

From a SvelteKit app to a Page Object Tool your coding agent calls.

## 1. Install

```sh
npm install @ayme-dev/ayme @ayme-dev/svelte
npm install -D @ayme-dev/unplugin-ayme @playwright/test @ayme-dev/inspector
```

## 2. Add the build plugin

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit(), ayme()],
});
```

Keep SvelteKit's generated tsconfig as the base and enable decorators:

```jsonc
// tsconfig.json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": { "experimentalDecorators": true },
}
```

SvelteKit 3 and plain Svelte apps differ only in this step; see [Svelte](../frameworks/svelte.md).

## 3. Write a Page Object Model

```ts
// src/lib/pom/ProjectsPage.ts
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

Start Ayme in the root layout with publication on and the Inspector in development:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { dev } from "$app/environment";
  import { useAyme } from "@ayme-dev/svelte";

  let { children }: { children: Snippet } = $props();
  useAyme({ webMCP: { enabled: true }, inspector: dev });
</script>

{@render children()}
```

Use the Page Object in a page:

```svelte
<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { usePageObject } from "@ayme-dev/svelte";
  import { ProjectsPage } from "$lib/pom/ProjectsPage";

  const pom = usePageObject(ProjectsPage);
  let projects = $state<string[]>([]);
  let creating = $state(false);
  let name = $state("");

  function create(event: SubmitEvent) {
    event.preventDefault();
    projects.push(name);
    name = "";
    creating = false;
  }
</script>

<button onclick={() => pom.createProject("My first project")}>Show me how</button>
<button onclick={() => (creating = true)}>New project</button>
{#if creating}
  <form onsubmit={create}>
    <label>Project name <input bind:value={name} /></label>
    <button type="submit">Create</button>
  </form>
{/if}
<ul>
  {#each projects as project (project)}
    <li>{project}</li>
  {/each}
</ul>
```

## 5. Call it

Run the dev server. The Inspector opens on the page: its Tools lens lists `ProjectsPage.createProject`, and running it with a name creates the project while you watch. The "Show me how" button does the same from your own code, the way an onboarding checklist would.

To call it from your coding agent, connect the agent to the page through the WebMCP local relay, as [Connect an agent](../guides/connect-an-agent.md) shows, and ask it to create a project. It calls `ProjectsPage.createProject`.

## Next

- [Svelte](../frameworks/svelte.md): SvelteKit 3, plain Svelte, Svelte 3 and 4 markup, and reading the publication status.
- [Page Object Models](../guides/page-object-models.md): tool names, inputs and Page Object Children.
- [Goals with Jev](../guides/goals-with-jev.md): hand the page a goal instead of single calls.
