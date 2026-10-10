# Build an in-app assistant

How to give the assistant inside your app, such as an onboarding helper, your Page Object Actions and the page state as its tools.

## Your Page Objects are its tools

An assistant in your app needs two things: actions it can take on the page, and a way to see what the page shows. Your Page Object Models already provide the first, and Ayme provides the second. The assistant works on the same page the user is looking at, so the user watches it act.

```tsx
// OnboardingAssistant.tsx
import { useAyme, usePageObject } from "@ayme-dev/react";
import { Sidebar } from "../playwright/pom/Sidebar";

export function OnboardingAssistant() {
  const { ayme } = useAyme();
  const sidebar = usePageObject(Sidebar);

  async function toggleSidebar() {
    await sidebar.toggle();
  }

  async function getPageState() {
    const { structure } = await ayme.tools.run("snapshot", {});
    return structure;
  }

  // Hook these up with whatever assistant framework you're using.
  // ...
}
```

- `usePageObject` returns the same `Sidebar` instance the rest of your app uses, so the assistant's actions go through the page's own `Page`. Vue and Svelte use the same names, and Angular uses `injectAyme` and `injectPageObject`.
- `snapshot` returns the Structural Page State, the same view of the page a coding agent gets; [Page state](page-state.md) describes it.
- Each action the assistant takes is recorded like any other, so a coding agent connected to the same page sees what the assistant changed.

## Hand it every tool

To give the assistant every tool Ayme knows instead of picking a few, read them from `ayme.tools`:

```ts
const tools = ayme.tools.list().filter(({ available }) => available); // name, description and inputSchema of each
const result = await ayme.tools.run(name, input);
```

The list holds your Page Object Tools, the Browser Tools, your [Custom Tools](custom-tools.md) and `goal`, each with a JSON Schema for its input, which is what most assistant frameworks expect for a tool. `ayme.tools.list()` holds every tool of a Page Object on the page, available or not: a tool whose action cannot run now has `available: false` and, when there is one, its `reason`. The filter leaves them out; an assistant that shows its tools can show the reason instead. `ayme.tools.subscribe(listener)` tells you when the list changes, such as when a Page Object appears on the page or a tool becomes available. A Custom Tool that highlights an element is a natural fit: the assistant can point at things before it acts on them.

## Let Jev do the steps

For a request such as "create a project called Launch plan", the assistant can hand the whole task to the Goal Loop instead of choosing every step:

```ts
const handover = await ayme.tools.run("goal", {
  goal: "create a project called Launch plan",
  maxSteps: 8,
});
```

Jev picks one action per step until the goal is met, and the Handover says what it did and what is left. [Goals with Jev](goals-with-jev.md) sets up the Decision Endpoint it needs.
