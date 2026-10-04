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

## Reference

- [`@ayme-dev/ayme`](reference/ayme.md): the decorators, `createAyme`, the session's tools, Page Objects and publication, and the package entries.
- [Playwright in the browser](reference/playwright-in-the-browser.md): which Playwright calls a Page Object Model can make when Ayme runs it in your app.
- [Build plugin](reference/build-plugin.md): the options of `@ayme-dev/unplugin-ayme` and how its Playwright settings resolve.
