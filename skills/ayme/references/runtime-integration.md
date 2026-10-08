# Runtime integration

[Page Object Models](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md)
covers marking, tool names, and Page Object Children; the page for the project's
framework, linked from the
[documentation index](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md),
covers starting Ayme and registering Page Objects. Follow
[Page object design](page-object-design.md) for members, roots, and action
returns.

## Register top-level POMs

Register page POMs and independent global components, such as a sidebar, with
the framework's page-object consumer (`usePageObject`, or `injectPageObject` in
Angular) in the component that owns their lifetime.

Child POMs exposed through the registered POM's compiled members are discovered
recursively and need no separate registration. An unrelated marked class or a
POM only returned from an action is not registered, so its tools are never live.

## Keep one runtime owner at the root

One owner per document starts Ayme. Put it at the application root, not in a
per-route or per-page layout, as each framework page explains:
[Vue](https://github.com/ayme-labs/ayme/blob/main/docs/guide/frameworks/vue.md#root-ownership),
[React](https://github.com/ayme-labs/ayme/blob/main/docs/guide/frameworks/react.md#root-ownership),
[Svelte](https://github.com/ayme-labs/ayme/blob/main/docs/guide/frameworks/svelte.md#limits)
and
[Angular](https://github.com/ayme-labs/ayme/blob/main/docs/guide/frameworks/angular.md#root-ownership).

When the app already has an owner, configure the
[`createAyme` options](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#createayme)
there; never add a second one.

## Separate publication from direct consumers

POM registration, WebMCP publication, and assistant adapters are separate
responsibilities. A tool is listed once its POM is registered, and available
while its POM is available, whether or not it is published. An
[in-app assistant](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/in-app-assistant.md)
runs available tools through `ayme.tools`; it gets thrown errors, whereas a published
call resolves a failure as a result with `isError: true`, as
[Errors](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/errors.md#how-an-agent-sees-a-failure)
describes.

## Optional quick verification

After mounting the component, check the tools and the page state:

- `ayme.tools.list()` lists the tools, each with whether it is `available`.
- The [Inspector](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/inspector.md)'s
  Model and Tools lenses show the Page Objects on the page and their available tools.
- `(await ayme.tools.run("snapshot", {})).structure` returns the Structural Page
  State an agent receives, labelled with Page Object names.

Confirm that the intended POM, its visible members, and its tools appear.
