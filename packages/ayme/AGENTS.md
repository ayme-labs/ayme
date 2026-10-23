# Ayme source layout

`src/` is cut into slices named for what they do, with layers inside a slice only where it has them so far. [`eslint.config.js`](eslint.config.js) is the source of truth for which slices and layers each may use; `pnpm lint` flags a misplaced import, and `src/layout.test.ts` checks that it does. Every kind of import counts: static, dynamic, type-only and a type written as `import("…")`. A dynamic `import()` names its module with a string literal, so lint can read it.

Slices, from the bottom up:

- `shared`: the JSON contracts and tool descriptors, the error types, the Caller names, schema validation, the Goal Loop's contract with its Caller (the `goal` tool's input and the Handover), and small helpers: the composed tree, the monotonic clock, the Inspector's page marks.
- `page-state`: the Structural Page State and its Page State Session, the interaction history it records, Change Records and the per-Caller cursors, Structural Refs and Ayme's selector engine, acting on the page and waiting for a Settled Page, Page Object labels and root placement in the captured tree, and reach: whether a click would land on an element, and the refusal when a call would not run.
- `runs`: the Run, the Run queue and executing a top-level Run, the Run log, Interactions and the Playwright call table, and the page instrumentation that records a Run's Interactions.
- `page-objects`: the `@ayme` marks, the Page Object registry and the page driver it reads the page through, the Page Object tree, instances, roots, presence and availability, action tool facts, Page Object definitions and their text, and `createPage`.
- `tools`: the Browser Tools, Custom Tools, Peek Tools, page context, screenshots and the agent's image calls the Inspector shows, and the built-in tools' input and result types.
- `goal-loop`: the Goal Loop, the Step Decision and its questions, the operations it offers, the decision wire, and the Decision Endpoint's client and handler.
- `runtime`: the composition root: `createAyme`, the runtime options, the published tools, WebMCP publication, the Inspector and the Agent Connection.

The entries (`index.ts`, `internal.ts`, `absent.ts`, `server.ts`, `testing.ts`) stay at the top of `src/` and use the slices' front doors. No slice uses an entry. `server.ts`, the `./server` entry, only re-exports the Decision Endpoint's handler from `goal-loop`.

Layers: `domain` (pure rules and types), `application` (the flows and the ports they use), `infrastructure` (the network, the DOM and Playwright Lite's page). `goal-loop`, `page-objects` and `runs` are layered. The others are not yet, each for its own reason: `page-state`'s Page State Session mixes DOM capture with its rules, and every tool in `tools` calls Playwright Lite directly. `shared` and `runtime` stay unlayered.

- Every file of a layered slice sits in a layer folder, except its `index.ts`.
- Another slice is reached through its `index.ts`, which re-exports only what other slices, the entries and tests use, and only names its own slice declares. Inside a slice, a module imports the module it needs, never its own slice's `index.ts`.
- A module sets up on import only the state its own exports use, so the build drops the modules an entry does not use: `src/builtEntries.test.ts` checks that the built `./server` and `./absent` entries carry no browser runtime.

Tests stay beside the module they are about, in its layer folder when the slice is layered, even when they start a whole runtime: the slice order holds for production code only. They still reach another slice through its `index.ts`, except `vi.mock` and `vi.importActual`, which name the module file itself, since mocking a front door leaves the slice's own imports of that module alone. A mock factory that keeps the rest of such a module spreads `await importOriginal<object>()`. Harnesses that several slices' tests share live in `src/test-utils/`; one slice's own harness lives in that slice, in its `test-utils/` layer when it is layered. Production code never imports test code.
