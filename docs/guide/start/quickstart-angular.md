# Quickstart: Angular

From an Angular app to a Page Object Tool your coding agent calls.

## 1. Install and configure

```sh
ng add @ayme-dev/angular
npm install -D @ayme-dev/inspector @ayme-dev/mcp
```

`ng add` installs Ayme, the build plugin and `@playwright/test`, switches the build and serve builders to `@angular-builders/custom-esbuild`, adds the plugin, and adds `provideAyme()` to the application config. New Angular workspaces already enable `experimentalDecorators`. [Angular](../frameworks/angular.md) lists the manual steps.

## 2. Write a Page Object Model

```ts
// playwright/pom/ProjectsPage.ts
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

## 3. Start Ayme and use the Page Object

Turn the Inspector and the Agent Connection on in development where `ng add` added `provideAyme()`:

```ts
// src/app/app.config.ts
import { ApplicationConfig, isDevMode } from "@angular/core";
import { provideAyme } from "@ayme-dev/angular";

export const appConfig: ApplicationConfig = {
  providers: [
    provideAyme({ inspector: isDevMode(), agentConnection: isDevMode() }),
  ],
};
```

Use the Page Object in a component, and render `<app-projects />` in your app:

```ts
// src/app/projects.ts
import { Component, signal } from "@angular/core";
import { injectPageObject } from "@ayme-dev/angular";
import { ProjectsPage } from "../../playwright/pom/ProjectsPage";

@Component({
  selector: "app-projects",
  template: `
    <button (click)="pom.createProject('My first project')">Show me how</button>
    <button (click)="creating.set(true)">New project</button>
    @if (creating()) {
      <form (submit)="$event.preventDefault(); create(name.value)">
        <label>Project name <input #name /></label>
        <button type="submit">Create</button>
      </form>
    }
    <ul>
      @for (project of projects(); track project) {
        <li>{{ project }}</li>
      }
    </ul>
  `,
})
export class Projects {
  protected readonly pom = injectPageObject(ProjectsPage);
  protected readonly projects = signal<string[]>([]);
  protected readonly creating = signal(false);

  protected create(name: string) {
    this.projects.update((current) => [...current, name]);
    this.creating.set(false);
  }
}
```

## 4. Call it

Run the dev server. The Inspector opens on the page: its Tools lens lists `ProjectsPage.createProject`, and running it with a name creates the project while you watch. The "Show me how" button does the same from your own code, the way an onboarding checklist would.

To call it from your coding agent, register Ayme's MCP server in the agent and connect it to the page, as [Connect an agent](../guides/connect-an-agent.md) shows. Then ask it to create a project: it calls `ProjectsPage.createProject`.

## Next

- [Angular](../frameworks/angular.md): manual setup, the API, server rendering and bundle size.
- [Page Object Models](../guides/page-object-models.md): tool names, inputs and Page Object Children.
- [Goals with Jev](../guides/goals-with-jev.md): hand the page a goal instead of single calls.
- [Publish tools](../guides/publish-tools.md): publish the same tools through WebMCP for agents that run in the browser.
