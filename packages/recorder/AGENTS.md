# Recorder engine source layout

The engine of the Recorder: it starts a recorder on the Playwright the project has installed and ends it with an outcome. It is internal; the CLI (`packages/cli`) starts it, and the window (`packages/recorder-window`) knows only its `./contract` entry. Why it runs on stock Playwright: [ADR-0052](../../docs/adr/0052-the-recorder-runs-on-stock-playwright-and-uses-its-private-parts-only-under-test.md).

`src/` is cut into slices named for what they do, with layers inside a slice only where it needs them. [`eslint.config.js`](eslint.config.js) is the source of truth for which slices and layers each may use, and for where Playwright and Effect may be imported; `pnpm lint` flags a misplaced import, and `src/layout.test.ts` checks that it does.

Slices, from the bottom up:

- `contract`: the plain data shared with the CLI, the window and the toolbar: the outcome, the state, updates with their counter, commands and their answer. Types only. It is the `./contract` entry.
- `timeline`: pure rules, snapshots in, entries and the package document out. It holds no code yet.
- `session`: one live recorder. `domain` holds the lifecycle, one pure function (`step`) from a state and one thing that happened to a new state and a list of things to do, and the start error. `application` holds the queue with its one worker (`RecorderSession`), which feeds `step` and carries out its list, and the engine's one seam, the recorded browser (`RecordedBrowser`), which speaks the engine's words and never Playwright's.
- `playwright`: the stock Playwright adapter of the recorded browser. It finds the project's own Playwright and launches Chromium with it. The only slice that may import Playwright, types included.
- `server`: the window's server. It holds no code yet.
- `engine`: the composition root and the front door. `startRecorder` picks the stock adapter; `startRecorderOn` turns a session on any recorded browser into the handle a caller gets, and is the one place Effect becomes promises.
- `testing`: the `./testing` entry (ADR-0026): `startScriptedRecorder`, a real recorder on a scripted browser that a test plays by hand.

Layers: `domain` (pure rules and types), `application` (the flows and the ports they use), `infrastructure` (Playwright, the disk, the network). `contract`, `engine` and `testing` aren't layered.

- Every file of a layered slice sits in a layer folder, except its `index.ts`.
- Another slice is reached through its `index.ts`.
- `src/index.ts` is the package's front door. Nothing but promises, callbacks and plain data leaves it: `src/frontDoor.test.ts` fails when an Effect type or a Playwright type is reachable from the built entry.

The lifecycle decides and the adapter only carries out. To add behaviour, add a state, a thing that happened or a thing to do to `session/domain/lifecycle.ts`, with a row in its table test, then let the worker carry it out through the recorded browser. A new thing the browser can tell or do is a member of `RecordedBrowser`, implemented by the stock adapter and by the scripted browser.

## Effect

The flows and adapters are written with Effect 4. The pure rules, the contract, the front door and anything injected into a page are not; lint enforces where `effect` may be imported.

- The documentation to use is the one shipped inside the installed package: `node_modules/effect/AGENTS.md` in this package's folder, which links to runnable examples in `node_modules/effect/ai-docs/` beside it.
- Most knowledge of Effect is from version 3, and many names changed in version 4. The rename guide: <https://github.com/Effect-TS/effect/blob/effect@4.1.4/MIGRATION.md>.
- Production code uses only the stable `effect` package: no `@effect/*` package and no `effect/unstable/*` module, so none of Effect's own HTTP, socket or process modules. Tests may use the Vitest helper for Effect, `@effect/vitest`; its 4.1 releases need Vitest 5, so it is not installed while the repository is on Vitest 4. The test clock is in the stable package, at `effect/testing`.
- Check every name in the installed type definitions, `node_modules/effect/dist/*.d.ts`, never from memory.

## Testing

Run from this directory inside the repository's Devbox shell. `pnpm test` needs the build, since `src/frontDoor.test.ts` reads it; Turbo's `test` task builds first.

- `session/domain/lifecycle.test.ts`: the lifecycle as a table. No browser, no clock.
- `src/recorder.test.ts`: the handle, on the scripted browser.
- `src/startRecorder.test.ts`: starting on stock Playwright, as far as it goes without a browser.
- The end-to-end tests, which run the built command on real Chromium, live in [`apps/recorder-fixture`](../../apps/recorder-fixture/README.md).
