# ayme source layout

[`eslint.config.js`](eslint.config.js) says what each slice of `src/` holds, which slices and layers each may use, and which files are still exceptions. `pnpm lint` refuses a misplaced import of any kind, and [`src/layout.test.ts`](src/layout.test.ts) checks that it does. [`src/builtEntries.test.ts`](src/builtEntries.test.ts) checks what each built entry carries.

Lint cannot see the rules below:

- Put every file of a layered slice in a layer folder, since lint lets a file outside one use any layer.
- Keep module state in an `infrastructure` store keyed by its `Page`, never in `domain` or `application` or on `globalThis`, so two Pages in one process share nothing. [`pageStates.ts`](src/page-state/infrastructure/pageStates.ts) says why; each store on `globalThis` says why it is the exception.
- Have `domain` and `application` work on refs and the Structural Page State, never an `Element`, since the `./playwright` entry runs them in Node, where the page's elements are out of reach.
- Put code that reaches the browser's own `document` in a file of its own, beside its Page-keyed twin, as [`pageState.ts`](src/page-state/infrastructure/pageState.ts) sits beside [`pageStates.ts`](src/page-state/infrastructure/pageStates.ts), so the `./playwright` entry can import the twin without the browser runtime.
- Set up on import only the state a module's own exports use, so the build drops the modules an entry does not use.
- Re-export from a front door only what other slices, the entries and tests use, so the door shows what the rest of the package depends on.
- Write the in-page module's page part to run alone in the document: the build turns its files into self-contained functions ([`build/inPageModule.ts`](build/inPageModule.ts)), and the [contract suite](testing/in-page/inPageContract.testSupport.ts), run over the built package in Node, catches one that closes over host state.

## Tests

- Keep a test beside the module it is about, in its layer folder, even when it starts a whole runtime; lint lets tests use any slice so they can.
- Mock a module by its own file, past the front door, since mocking a front door leaves the slice's own imports of that module alone.
- Type the original module as `object` in a mock factory that spreads it, since lint refuses a type import of a path past a front door.
- Put a harness several slices share at the top of [`testing/`](testing/index.ts), and one slice's harness in the folder named after that slice, which lint lets use the slice's own files ([ADR-0057](../../docs/adr/0057-test-support-lives-beside-src-and-is-never-published.md)).
