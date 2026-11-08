# Build an in-app assistant

How to give the assistant inside your app, such as an onboarding helper, your Page Object Actions and the page state as its tools.

## Your Page Objects are its tools

An assistant in your app needs two things: actions it can take on the page, and a way to see what the page shows. Your Page Object Models already provide the first, and Ayme provides the second. The assistant works on the same page the user is looking at, so the user watches it act.

```tsx
// OnboardingAssistant.tsx
import { useAyme, usePageObject } from "@ayme-dev/react";
import { ProjectsPage } from "./pom/ProjectsPage"; // the model from the quickstart

export function OnboardingAssistant() {
  const { ayme } = useAyme();
  const projects = usePageObject(ProjectsPage);

  // A tool for the assistant: create a project while the user watches.
  async function createProject(name: string) {
    await projects.createProject(name);
  }

  // A tool for the assistant: read what the page shows.
  async function getPageState() {
    const { structure } = await ayme.tools.run("snapshot", {});
    return structure;
  }

  // Hand createProject and getPageState to your assistant framework as tools.
}
```

- `usePageObject` returns the same `ProjectsPage` instance the rest of your app uses, so the assistant's actions go through the page's own `Page`. Vue and Svelte use the same names, and Angular uses `injectAyme` and `injectPageObject`.
- `snapshot` returns the Structural Page State, the same view of the page a coding agent gets; [Page state](page-state.md) describes it.
- Each action the assistant takes is recorded like any other, so a coding agent connected to the same page sees what the assistant changed.

## Hand it every tool

To give the assistant every tool Ayme knows instead of picking a few, read them from `ayme.tools`:

```ts
const tools = ayme.tools.list().filter(({ available }) => available);
// each has name, agentDescription and inputSchema

// Call this when the assistant's model picks a tool, with the input it chose:
async function runTool(name: string, input: unknown) {
  return ayme.tools.run(name, input);
}
```

The list holds `snapshot`, your Page Object Tools, the Browser Tools and your [Custom Tools](custom-tools.md). It also holds `goal` when the Goal Loop is configured, and the [Peek Tools](../reference/ayme.md#aymepeek) while the Inspector or the Agent Connection is on. The entry for the quickstart's `createProject` reads:

```ts
{
  name: "ProjectsPage.createProject",
  className: "ProjectsPage",
  inputSchema: { … }, // JSON Schema, as most assistant frameworks expect
  group: "pageObject",
  available: true,
}
```

- Give the assistant `name`, `inputSchema`, and `agentDescription` when the tool has one. `agentDescription` is the text Ayme gives coding agents.
- `createProject` has no description and returns no Page Object, so it has no `agentDescription`. If your framework requires a description, use the tool's name.
- An action that returns another Page Object gets one that names it. `ProjectsPage.openNewProjectDialog` from [Page Object Models](ayme-page-objects.md) has `agentDescription: "Shows NewProjectDialog."` and `returnPoms: ["NewProjectDialog"]`.
- To write your own wording, read `authorDescription`, which holds what the author wrote, and `returnPoms`.
- A tool whose action cannot run now has `available: false`, and a `reason` when there is one. The filter above leaves those out. An assistant that shows its tools can show the reason instead.
- `ayme.tools.subscribe(listener)` tells you when the list changes, such as when a Page Object appears or a tool becomes available.

A Custom Tool that highlights an element suits an assistant well: it can point at things before it acts on them.

## Let Jev do the steps

For a request such as "create a project called Launch plan", the assistant can hand the whole task to the Goal Loop instead of choosing every step:

```ts
const handover = await ayme.tools.run("goal", {
  goal: "create a project called Launch plan",
  maxSteps: 8,
});
```

Jev picks one action per step until the goal is met, and the Handover says what it did and what is left. [Goals with Jev](goals-with-jev.md) sets up the Decision Endpoint it needs.
