# Quickstart: Vue

From a Vite Vue app to a Page Object Tool your coding agent calls.

## 1. Install

```sh
npm install @ayme-dev/ayme @ayme-dev/vue
npm install -D @ayme-dev/unplugin-ayme @playwright/test @ayme-dev/inspector @ayme-dev/cli
```

## 2. Add the build plugin

```ts
// vite.config.ts
import vue from "@vitejs/plugin-vue";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [vue(), ayme({ include: command === "serve" })],
}));
```

`include` keeps ayme in the dev server and out of `vite build`; [Include ayme in a build](../reference/build-plugin.md#include-ayme-in-a-build) covers the builds that keep it.

Enable decorators in your app's tsconfig, `tsconfig.app.json` in Vite's templates:

```json
{ "compilerOptions": { "experimentalDecorators": true } }
```

## 3. Write a Page Object Model

Page Objects live in `ayme/pom/`, at your project's root. Give the folder a tsconfig that extends your app's, so it compiles with the app's options:

```jsonc
// ayme/tsconfig.json
{
  "extends": "../tsconfig.app.json",
  "include": ["**/*.ts"],
}
```

Add the `#pom/*` alias to your `package.json`, so app code and tests import the Page Objects the same way from any folder:

```json
{ "imports": { "#pom/*": "./ayme/pom/*.ts" } }
```

[The `ayme` folder](../guides/ayme-folder.md) describes the rest of the folder. Then write the model:

```ts
// ayme/pom/ProjectsPage.ts
import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

@ayme
export class ProjectsPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  @ayme.action
  async createProject(name: string) {
    await this.page.getByRole("button", { name: "New project" }).click();
    await this.page.getByRole("textbox", { name: "Project name" }).fill(name);
    await this.page.getByRole("button", { name: "Create" }).click();
  }
}
```

If your Playwright tests already have a Page Object Model for this page, mark that one instead.

## 4. Start ayme and use the Page Object

Start ayme in the root component with the Inspector in development, and use the Page Object:

```vue
<!-- src/App.vue -->
<script setup lang="ts">
import { ref } from "vue";
import { useAyme, usePageObject } from "@ayme-dev/vue";
import { ProjectsPage } from "#pom/ProjectsPage";

useAyme({
  inspector: import.meta.env.DEV,
});
const pom = usePageObject(ProjectsPage);

const projects = ref<string[]>([]);
const creating = ref(false);
const name = ref("");
function create() {
  projects.value.push(name.value);
  name.value = "";
  creating.value = false;
}
</script>

<template>
  <button @click="pom.createProject('My first project')">Show me how</button>
  <button @click="creating = true">New project</button>
  <form v-if="creating" @submit.prevent="create">
    <label>Project name <input v-model="name" /></label>
    <button type="submit">Create</button>
  </form>
  <ul>
    <li v-for="project in projects" :key="project">{{ project }}</li>
  </ul>
</template>
```

## 5. Call it

Run the dev server. The Inspector opens on the page: its Tools lens lists `ProjectsPage.createProject`, and running it with a name creates the project while you watch. The "Show me how" button does the same from your own code, the way an onboarding checklist would.

To call it from your coding agent, finish [Set up your project](../guides/connect-an-agent.md#set-up-your-project): it installs Playwright at a version the `ayme` command supports, and you list `ProjectsPage` in `ayme/page-objects.ts`. Then ask the agent to create a project: it starts the `ayme` command beside its browser automation and calls `ProjectsPage.createProject`.

## Next

- [Vue](../frameworks/vue.md): the provider, root ownership, composables and Nuxt.
- [Page Object Models](../guides/ayme-page-objects.md): tool names, inputs and Page Object Children.
- [Goals with Jev](../guides/goals-with-jev.md): hand the page a goal instead of single calls.
- [Publish tools](../guides/publish-tools.md): publish the same tools through WebMCP for agents that run in the browser.
