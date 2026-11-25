# ayme source layout

[`eslint.config.js`](eslint.config.js) says what each slice of `src/` holds, which slices and layers each may use, and which files are still exceptions. `pnpm lint` refuses a misplaced import of any kind, and [`src/layout.test.ts`](src/layout.test.ts) checks that it does. [`src/builtEntries.test.ts`](src/builtEntries.test.ts) checks what each built entry carries. The in-page module's page part runs alone in the document: [`inPage.node.test.ts`](src/in-page/host/inPage.node.test.ts) fails on a function that closes over host state, and [`inPage.browser.test.ts`](src/in-page/host/inPage.browser.test.ts) runs the same contract over Playwright Lite.

Lint cannot see the rules below:

- Put every file of a layered slice in a layer folder, since lint lets a file outside one use any layer.
- Give a layered slice no `index.ts` of its own, and re-export from a layer's front door only that layer's modules, or an unlayered slice's own, since lint checks an import's direction, not what a door re-exports.
- Re-export from a front door only what other slices, the entries and tests use, so the door shows what the rest of the package depends on.
- Put an entry at the top of `src/` and list it in [`tsdown.config.ts`](tsdown.config.ts), since the build makes only the entries listed there.
- Key each per-Page store by its `Page` and keep none on `globalThis`, so two Pages in one process share nothing; in `page-state`, keep module state out of `domain` and `application`. [`pageStates.ts`](src/page-state/infrastructure/pageStates.ts) says why; each store on `globalThis` says why it is the exception.
- Have `domain` and `application` reach the page only through what their Run hands them (its Page, Navigation, Page State Session and Reach) and through ports whose adapters sit in `infrastructure`, and work on refs and the Structural Page State, never an `Element`, since the `./playwright` entry runs them in Node, where the page's elements are out of reach.
- Put code that reaches the browser's own `document` in a file of its own, beside its Page-keyed twin, as [`pageState.ts`](src/page-state/infrastructure/pageState.ts) sits beside [`pageStates.ts`](src/page-state/infrastructure/pageStates.ts), so the `./playwright` entry can import the twin without the browser runtime.
- Use `@playwright/test` in `in-page` for types only, on its host side, since the host reaches the page part only through Playwright's `Page`; lint lets its values through.
- Import `typescript` only in `compiler`, have `compiler` use only `shared` and `page-objects`' `domain`, and use `compiler` only from the `./compiler` entry, since `typescript` is an optional peer and lint checks the slice, not the layer, the entry or a type import.
- Set up on import only the state a module's own exports use, so the build drops the modules an entry does not use.

## Tests

- Keep a test beside the module it is about, in its layer folder, even when it starts a whole runtime; lint lets tests use any slice so they can.
- Name the module's own file in `vi.mock` and `vi.importActual`, past the front door, since mocking a front door leaves the slice's own imports of that module alone.
- In a mock factory that keeps the rest of the module, spread the awaited original it is handed, typed as `object`, as [`registry.test.ts`](src/page-objects/infrastructure/registry.test.ts) does, since lint refuses a type import of a path past a front door.
- Put a harness several slices share at the top of [`testing/`](testing/index.ts), and one slice's harness in the folder named after that slice, which lint lets use the slice's own files ([ADR-0057](../../docs/adr/0057-test-support-lives-beside-src-and-is-never-published.md)).
