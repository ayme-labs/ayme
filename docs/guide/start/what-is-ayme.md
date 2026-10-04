# What is Ayme

Ayme turns the Page Object Models your tests already use into tools that agents and tests call in your running app.

## Your Page Object Models become tools

A Page Object Model describes a page, or a part of one, through the elements and actions it provides. You mark the model and the actions to expose, and the build plugin compiles them into your app. When the app runs, each marked action becomes a Page Object Tool, named after its class and method and typed from the method's signature. The model stays the source of the behavior: the same class keeps working in your Playwright tests.

Your Page Object Models run in the browser on [playwright-lite](https://github.com/ayme-labs/playwright-lite), a fork of Playwright that drives the current document from inside the page. You write them against Playwright's own `Page` and `Locator` types.

## What an agent gets

Ayme publishes its tools through WebMCP, the browser's standard for offering tools on a page to agents. You turn publication on when you start Ayme. An agent connected to the page sees:

- the Page Object Tools of every Page Object currently on the page;
- Browser Tools, built-in operations on the page itself, such as reading the page, clicking an element or filling a field;
- Custom Tools your app registers for single elements;
- a goal tool that runs the Goal Loop.

Ayme also describes the page to the agent. The Structural Page State is a model-facing view of what the page presents and which Page Objects it holds, with Structural Refs the agent passes back to act on a node. After each action, the agent learns what changed.

## The Goal Loop

The calling agent can hand Ayme a goal in natural language instead of choosing every step itself. The Goal Loop drives the page toward that goal in steps, and each step is one judgement by Jev, TypeSafe's System One model, not by the calling agent's LLM. When it stops, the Goal Loop returns a Handover: why it stopped, what it did and what to do next. Requests to the model go through the Decision Endpoint, a route in your own backend that adds your key to each request.

## Tests call the same tools

Ayme's testing entry records the tools your app publishes, so a Playwright test can list, await and call them the way an agent does.

## The Inspector

The Inspector is an in-page panel that shows your page's Page Objects, its Structural Page State and its tools, and lets you run those tools by hand.

## Frameworks

Ayme has packages for Vue, React, Svelte and Angular, and works with Next.js, Nuxt and SvelteKit, including server rendering:

- [Vue](../frameworks/vue.md)
- [React](../frameworks/react.md)
- [Svelte](../frameworks/svelte.md)
- [Angular](../frameworks/angular.md)
