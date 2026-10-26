# Runtime integration

[Page Object Models](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md)
covers marking, tool names, and Page Object Children; the page for the project's
framework, linked from the
[documentation index](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md),
covers starting Ayme and registering Page Objects. Follow
[Page object design](page-object-design.md) for members, roots, and action
returns.

## Register top-level POMs at setup

Register every page POM once, at app setup: list it in the `pageObjects`
option where Ayme starts (`createAyme`, `AymeProvider`, `useAyme` or
`provideAyme`). A page is
present by its URL through the page base class of
[Page object design](page-object-design.md#write-base-classes-for-pages-and-components),
so its tools come and go with the browser's location.
[Register Page Objects](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/publish-tools.md#register-page-objects)
is the rule; the framework page shows the call in its idiom.

Register in a component only when the POM's presence is that component's
lifetime and no URL states it, such as a sidebar mounted on several routes, or
when the POM belongs in a route's chunk. Say which in a one-line comment at the
call.

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
responsibilities. Whether a tool is listed or available does not depend on
publication; [`ayme.tools`](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#aymetools)
gives the rules. An
[in-app assistant](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/in-app-assistant.md)
runs available tools through `ayme.tools`; it gets thrown errors, whereas a published
call resolves a failure as a result with `isError: true`, as
[Errors](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/errors.md#how-an-agent-sees-a-failure)
describes.

## Optional quick verification

On a page the POM is present on, check the tools and the page state:

- [`ayme.tools.list()`](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#aymetools)
  lists them, with `available` and, for a tool that cannot run now, its `reason`.
- The [Inspector](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/inspector.md)'s
  Model and Tools lenses show the Page Objects on the page and their tools; an
  unavailable tool shows dimmed with its reason.
- `(await ayme.tools.run("snapshot", {})).structure` returns the Structural Page
  State an agent receives, labelled with Page Object class names.

Confirm that the intended POM, its visible members, and its tools appear.
