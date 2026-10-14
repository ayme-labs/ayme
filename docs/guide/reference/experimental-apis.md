# Experimental APIs

The APIs whose shape is not settled yet, and what that means for code that uses them.

An experimental API belongs to a feature Ayme keeps but whose shape is not settled yet: its names, options and behaviour may change in any release, without a migration note. Its declaration carries the TSDoc `@experimental` tag, which your editor shows, and its documentation opens with a note that links here.

## Peeks

- `ayme.peek(read, name, id?)`: adds a Peek, in [`ayme.peek`](ayme.md#aymepeek).
- `usePeek(values, name, id?)`: the [React](../frameworks/react.md#api) and [Vue](../frameworks/vue.md#api) hook.
- `peek(read, name, id?)`: the [Svelte](../frameworks/svelte.md#api) composable.
- `injectPeek(values, name, id?)`: the [Angular](../frameworks/angular.md#api) function.

## The Goal Loop

- `goalLoop`: the session option that turns the Goal Loop and its `goal` tool on, in [Goals with Jev](../guides/goals-with-jev.md).
- `decisionEndpoint(url, options?)`: the decision function that posts each step to your Decision Endpoint, in [`decisionEndpoint`](decision-endpoint.md#decisionendpoint).
- `createDecisionEndpoint(options)`: the Decision Endpoint's handler, in [`createDecisionEndpoint`](decision-endpoint.md#createdecisionendpoint).
