# Experimental APIs

The APIs whose shape is not settled yet, and what that means for code that uses them.

An experimental API belongs to a feature ayme keeps but whose shape is not settled yet: its names, options and behaviour may change in any release, without a migration note. Its declaration carries the TSDoc `@experimental` tag, which your editor shows; an experimental CLI flag is marked in its command's usage text instead. Its documentation opens with a note that links here.

## Peeks

- `ayme.peek(read, name, id?)` in `@ayme-dev/ayme`: adds a Peek, in [`ayme.peek`](ayme.md#aymepeek).
- `usePeek(values, name, id?)` in `@ayme-dev/react` and `@ayme-dev/vue`: the [React](../frameworks/react.md#api) and [Vue](../frameworks/vue.md#api) hook.
- `peek(read, name, id?)` in `@ayme-dev/svelte`: the [Svelte](../frameworks/svelte.md#api) composable.
- `injectPeek(values, name, id?)` in `@ayme-dev/angular`: the [Angular](../frameworks/angular.md#api) function.

## The Goal Loop

- `goalLoop` in `@ayme-dev/ayme` and `@ayme-dev/vue`: the session option that turns the Goal Loop and its `goal` tool on, in [Goals with Jev](../guides/goals-with-jev.md).
- `decisionEndpoint(url, options?)` in `@ayme-dev/ayme`: the decision function that posts each step to your Decision Endpoint, in [`decisionEndpoint`](decision-endpoint.md#decisionendpoint).
- `createDecisionEndpoint(options)` in `@ayme-dev/ayme/server`: the Decision Endpoint's handler, in [`createDecisionEndpoint`](decision-endpoint.md#createdecisionendpoint).

## Page Objects that `ayme mcp` serves

- `--page-objects <file>` of `ayme mcp` in `@ayme-dev/mcp`: names the entry the server builds and serves, in [Page Objects on a page without ayme](../guides/page-objects-without-ayme.md).

`ayme mcp` in `@ayme-dev/mcp` can serve your Page Object Models to a page that doesn't ship ayme. The entry is a module whose default export lists the classes, as `createAyme`'s `pageObjects` option takes them:

```ts
// .ayme/page-objects.ts
import { ProjectsPage } from "../src/pages/ProjectsPage";

export default [ProjectsPage];
```

Without `--page-objects`, `ayme mcp` serves `.ayme/page-objects.ts` if the project has one. `--page-objects <file>` names another entry. The server builds the entry and serves it. It also writes `.ayme/init-script.js`, which your browser automation loads into the page as an init script. The script starts ayme in the page, with the Agent Connection on, and registers the classes.

`.ayme/page-objects.ts` and `.ayme/init-script.js` are experimental with the flag: a release may rename or move them, as it may the flag.
