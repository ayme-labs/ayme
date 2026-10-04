# Ayme documentation

How to turn your app's Page Object Models into tools that agents and tests call.

## Start

- [What is Ayme](start/what-is-ayme.md): what Ayme does with your Page Object Models and what an agent gets from it.
- [Install](start/install.md): the supported versions of each framework, Node.js, Playwright and TypeScript.

## Guides

- [Page Object Models](guides/page-object-models.md): mark a model and its actions, how tools are named, and how children and collections work.
- [Publish tools](guides/publish-tools.md): start Ayme and turn WebMCP publication on.
- [Page state](guides/page-state.md): the Structural Page State, Structural Refs and interaction history an agent works with.
- [Custom Tools](guides/custom-tools.md): register operations of your own on one element.
- [Connect an agent](guides/connect-an-agent.md): try your tools from Claude Code or another MCP client through the WebMCP local relay.
- [Test your integration](guides/test-your-integration.md): list, await and call the tools your app publishes from Playwright tests.
- [Inspector](guides/inspector.md): turn on the in-page panel that shows your Page Objects, the page state and the tools, and run them by hand.
- [Goals with Jev](guides/goals-with-jev.md): let a decision model drive your page toward a goal, and read the Handover it returns.

## Frameworks

- [Vue](frameworks/vue.md): the provider and standalone setup, hooks, server rendering with Nuxt, limits and API.
- [React](frameworks/react.md): the provider, hooks, server rendering with Next.js, limits and API.

## Reference

- [`@ayme-dev/ayme`](reference/ayme.md): the decorators, `createAyme`, the session's tools, Page Objects and publication, and the package entries.
- [Browser Tools](reference/browser-tools.md): every built-in tool Ayme publishes, with its input.
- [Decision Endpoint](reference/decision-endpoint.md): the contract of the route that adds your key to each decision model request.
- [Errors](reference/errors.md): the errors Ayme's packages throw and how an agent sees a failure.
- [Playwright in the browser](reference/playwright-in-the-browser.md): which Playwright calls a Page Object Model can make when Ayme runs it in your app.
- [Build plugin](reference/build-plugin.md): the options of `@ayme-dev/unplugin-ayme` and how its Playwright settings resolve.
