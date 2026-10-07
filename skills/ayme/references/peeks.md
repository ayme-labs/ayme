# Peeks

A Peek Tool reads app state at the moment you call it: unsaved form edits, a
component's internal state, a store, or what the server holds. When the
answer you need is state the page does not render, call the Peek Tool that
holds it before inferring that state from the page or the source.

## Reading

- `peek.<name>` reads the browser's Peek; `peek.node.<name>` reads an App
  Process, one of the app's own Node processes such as its dev server. One
  name can have both, each with its own side's values.
- The result is the Peek's name and, per live instance, its `id` and either
  its `values` or the error its read threw. A component's Peek has one
  instance per mounted component.
- A Peek Tool appears while its Peek has an instance and goes with the last
  one. When one you expect is missing, list the tools with `ayme_list_tools`
  and check that the component is mounted, or that the App Process is
  running and paired.
- Peeks exist only in development: they are live only while the session has
  `agentConnection` or `inspector` on, and reach coding agents and the
  Inspector alone. WebMCP never publishes them.

## Adding a Peek

Add one when a debugging question needs state that no Peek Tool reads yet.
Name it for the state it reads, such as `cart`; the name is the tool name.
Follow the linked README for the exact call.

| Where              | Call                                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React component    | `usePeek` ([React](https://github.com/ayme-labs/ayme/blob/main/packages/react/README.md#peek-at-component-state))                                                                                                                                                               |
| Vue component      | `usePeek` ([Vue](https://github.com/ayme-labs/ayme/blob/main/packages/vue/README.md#peek-at-component-state))                                                                                                                                                                   |
| Svelte component   | `peek`, with a getter ([Svelte](https://github.com/ayme-labs/ayme/blob/main/packages/svelte/README.md#peek-at-component-state))                                                                                                                                                 |
| Angular component  | `injectPeek` ([Angular](https://github.com/ayme-labs/ayme/blob/main/packages/angular/README.md#peek-at-component-state))                                                                                                                                                        |
| Outside components | `ayme.peek(read, name, id?)`, such as for a store ([`@ayme-dev/ayme`](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md#peek-at-app-state))                                                                                                                   |
| The app's server   | `ayme.peek` after `createAyme({ agentConnection })` and `start()`, once, in the server's entry point: `server/ayme.ts` for Express, `instrumentation.ts` for Next.js ([server state](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md#peek-at-server-state)) |

A server process has one App Process, as a document has one
[runtime owner](runtime-integration.md#keep-one-runtime-owner-at-the-root).
When the server already starts Ayme, add the Peek to that session; a second
`start()` in the process throws.

Turn `agentConnection` on behind the project's existing dev flag, as for the
page. Then call the new Peek Tool and confirm its values match what the app
holds.
