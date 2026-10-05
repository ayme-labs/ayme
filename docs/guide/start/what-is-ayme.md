# What is Ayme

Ayme turns the Page Object Models from your Playwright tests into tools that coding agents and your own app call in the running page.

## Your Page Object Models become tools

A Page Object Model describes a page, or a part of one, through the elements and actions it provides. You mark the model and the actions to expose, and the build plugin compiles them into your app. When the app runs, each marked action becomes a Page Object Tool, named after its class and method and typed from the method's signature. The model stays the source of the behavior, and the same class keeps working in your Playwright tests.

Your Page Object Models run in the browser on [playwright-lite](https://github.com/ayme-labs/playwright-lite), an implementation of Playwright's `Page` and `Locator` that drives the current document from inside the page. You write them against Playwright's own `Page` and `Locator` types.

## What an agent gets

A coding agent such as Claude Code, Codex or Cursor connects to the page through Ayme's MCP server, which the agent starts; you turn the page side on when you start Ayme, as [Connect an agent](../guides/connect-an-agent.md) shows. Agents that run in the browser get the same tools through WebMCP, the browser's standard for offering tools on a page to agents, when you turn publication on. An agent connected to the page sees:

- the Page Object Tools of every Page Object currently on the page;
- Browser Tools, built-in operations on the page itself, such as reading the page, clicking an element or filling a field;
- Custom Tools your app registers for single elements;
- a goal tool that runs the Goal Loop.

Ayme also describes the page to the agent. The Structural Page State is a model-facing view of what the page presents and which Page Objects it holds, with Structural Refs the agent passes back to act on a node. After each action, the agent learns what changed.

## The Goal Loop

The calling agent can hand Ayme a goal in natural language instead of choosing every step itself. The Goal Loop drives the page toward that goal in steps, and each step is one judgement by Jev, TypeSafe's System One model, not by the calling agent's LLM. When it stops, the Goal Loop returns a Handover: why it stopped, what it did and what to do next. Requests to the model go through the Decision Endpoint, a route in your own backend that adds your key to each request.

## Your app calls the same actions

Your own code runs the same Page Object Actions, through the Page Object or by tool name with `ayme.tools.run`. An onboarding checklist's "Show me how" button, or an in-app assistant, can then do a task on the page while the user watches.

## Your data stays with you

Ayme runs entirely in your app's page. It has no backend and no account, and it sends nothing to Ayme. Page content leaves the page in two ways, both set up by you: a coding agent you connect reads the page through Ayme's MCP server, which runs on your machine, and each Goal Loop step goes from your own Decision Endpoint, with your key, to the model provider you chose.

## The Inspector

The Inspector is an in-page panel that shows your page's Page Objects, its Structural Page State and its tools, and lets you run those tools by hand. The [Inspector guide](../guides/inspector.md) shows how to turn it on.

![The Ayme playground with the Inspector open on its Model lens](../images/inspector-model.png)

## Frameworks

Ayme has packages for Vue, React, Svelte and Angular, and works with Next.js, Nuxt and SvelteKit, including server rendering:

- [Vue](../frameworks/vue.md)
- [React](../frameworks/react.md)
- [Svelte](../frameworks/svelte.md)
- [Angular](../frameworks/angular.md)
