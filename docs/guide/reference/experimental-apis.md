# Experimental APIs

The APIs whose shape is not settled yet, and what that means for code that uses them.

An experimental API belongs to a feature Ayme keeps but whose shape is not settled yet: its names, options and behaviour may change in any release, without a migration note. Its declaration carries the TSDoc `@experimental` tag, which your editor shows, and its documentation opens with a note that links here.

## Peeks

- `ayme.peek(read, name, id?)` in `@ayme-dev/ayme`: adds a Peek, in [`ayme.peek`](ayme.md#aymepeek).
- `usePeek(values, name, id?)` in `@ayme-dev/react` and `@ayme-dev/vue`: the [React](../frameworks/react.md#api) and [Vue](../frameworks/vue.md#api) hook.
- `peek(read, name, id?)` in `@ayme-dev/svelte`: the [Svelte](../frameworks/svelte.md#api) composable.
- `injectPeek(values, name, id?)` in `@ayme-dev/angular`: the [Angular](../frameworks/angular.md#api) function.

## Page Object root and presence

- `root` in `@ayme-dev/ayme`: the `@ayme` option that names the element anchoring a Page Object, in [Page Object root](ayme.md#page-object-root).

  Migration: a model that anchored on a member named `root` now declares it on the decorator of its class or of a base class, `@ayme({ root: (self) => self.root })`; the member's name alone anchors nothing. Without the option, the model is root-less: a top-level one has its tools listed while it is registered, with no label in the page state and no reach measurement behind its availability, and a child has its tools withdrawn.

- `present` in `@ayme-dev/ayme`: the `@ayme` option that says when a Page Object is on the page, in [Page Object presence](ayme.md#page-object-presence).

## The Goal Loop

- `goalLoop` in `@ayme-dev/ayme` and `@ayme-dev/vue`: the session option that turns the Goal Loop and its `goal` tool on, in [Goals with Jev](../guides/goals-with-jev.md).
- `decisionEndpoint(url, options?)` in `@ayme-dev/ayme`: the decision function that posts each step to your Decision Endpoint, in [`decisionEndpoint`](decision-endpoint.md#decisionendpoint).
- `createDecisionEndpoint(options)` in `@ayme-dev/ayme/server`: the Decision Endpoint's handler, in [`createDecisionEndpoint`](decision-endpoint.md#createdecisionendpoint).
