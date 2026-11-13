# Recorder engine source layout

The engine of the Recorder: it starts a recorder on the Playwright the project has installed, records clicks as Interactions, and ends with a Recording Package or with "empty". It is internal; the CLI (`packages/cli`) starts it, and the window (`packages/recorder-window`) knows only its `./contract` entry. Why it runs on stock Playwright: [ADR-0052](../../docs/adr/0052-the-recorder-runs-on-stock-playwright-and-uses-its-private-parts-only-under-test.md).

`src/` is cut into slices named for what they do, with layers inside a slice only where it needs them. [`eslint.config.js`](eslint.config.js) is the source of truth for which slices and layers each may use, and for where Playwright and Effect may be imported; `pnpm lint` flags a misplaced import, and `src/layout.test.ts` checks that it does.

Slices, from the bottom up:

- `contract`: the plain data shared with the CLI, the window and the toolbar: the outcome, the state, updates with their counter, commands and their answer. Types only. It is the `./contract` entry.
- `timeline`: Visits, snapshots and Interactions in, the Recording Package out. `domain` holds what a recording is made of in the engine's words (`recorded.ts`), the `Timeline`, which keeps Visits and element identity with core's observation session and compares snapshots with core's trees, the rule that finds an Interaction's target (`target.ts`) and the released package text (`packageText.ts`). `infrastructure` writes the package where the released recorder keeps its recordings. No Effect: its work is promises.
- `session`: one live recorder. `domain` holds the lifecycle, one pure function (`step`) from a state and one thing that happened to a new state and a list of things to do, and the start error. `application` holds the queue with its one worker (`RecorderSession`), which feeds `step` and carries out its list in order, and the engine's one seam, the recorded browser (`RecordedBrowser`), which speaks the engine's words and never Playwright's.
- `playwright`: the stock Playwright adapter of the recorded browser. It finds the project's own Playwright, launches Chromium with it and carries out the engine's requests on it. `pageScripts.ts` holds what runs inside a recorded page, such as the gate that holds a click back. The only slice that may import Playwright, types included.
- `server`: the window's server. It holds no code yet.
- `engine`: the composition root and the front door. `startRecorder` picks the stock adapter; `startRecorderOn` turns a session on any recorded browser into the handle a caller gets, and is the one place Effect becomes promises.
- `testing`: the `./testing` entry (ADR-0026): `startScriptedRecorder`, a real recorder on a scripted browser that a test plays by hand.

Layers: `domain` (pure rules and types), `application` (the flows and the ports they use), `infrastructure` (Playwright, the disk, the network). `contract`, `engine` and `testing` aren't layered.

The layer order holds across slices as it holds inside one ([ADR-0046](../../docs/adr/0046-the-layer-order-holds-across-slices-through-one-front-door-per-layer.md)): domain uses domain, application uses application and domain, and infrastructure uses any layer.

- Every file of a layered slice sits in a layer folder. A layered slice has no `index.ts` of its own.
- Each layer that other code uses has a front door, the `index.ts` inside that layer's folder. Another slice imports the door of the layer it uses, such as `../../timeline/domain`, so lint judges the import by that layer. Inside a slice, import the module itself.
- An unlayered slice is reached through its own `index.ts`.
- An application module never imports another slice's infrastructure. What it needs done on the disk or in the browser it is handed: the composition root (`engine/recorder.ts`) gives the session the function that saves a package, and the recorded browser as a layer.
- `src/index.ts` is the package's front door. Nothing but promises, callbacks and plain data leaves it: `src/frontDoor.test.ts` fails when an Effect type or a Playwright type is reachable from the built entry.

The lifecycle decides and the adapter only carries out. To add behaviour, add a state, a thing that happened or a thing to do to `session/domain/lifecycle.ts`, with a row in its table test. The worker needs a change only for a new kind of thing to do.

The engine asks the browser and the browser tells the engine, and both are plain data in `lifecycle.ts`:

- A new thing the browser can do is a member of `BrowserRequest`. The stock adapter and the scripted browser each carry it out in their one `switch`, and do nothing else there: no request leads to another, and no order is decided.
- A new thing the browser can tell is a member of `BrowserSignal`. What comes of a request is told that way too, never returned: the browser's signals are one stream, so the lifecycle sees an answer in order with what the browser noticed by itself.
- A request completes when the browser has done it. Only what takes the page's own time, the wait for a Settled Page, completes at once and is answered later.
- A new thing the timeline keeps is a member of `TimelineAddition`, which the lifecycle lists like any other thing to do.

## Effect

The flows and adapters are written with Effect 4. The pure rules, the contract, the front door and anything injected into a page are not; lint enforces where `effect` may be imported.

- The documentation to use is the one shipped inside the installed package: `node_modules/effect/AGENTS.md` in this package's folder, which links to runnable examples in `node_modules/effect/ai-docs/` beside it.
- Most knowledge of Effect is from version 3, and many names changed in version 4. The rename guide: <https://github.com/Effect-TS/effect/blob/effect@4.1.4/MIGRATION.md>.
- Production code uses only the stable `effect` package: no `@effect/*` package and no `effect/unstable/*` module, so none of Effect's own HTTP, socket or process modules. Tests may use the Vitest helper for Effect, `@effect/vitest`; its 4.1 releases need Vitest 5, so it is not installed while the repository is on Vitest 4. The test clock is in the stable package, at `effect/testing`.
- Check every name in the installed type definitions, `node_modules/effect/dist/*.d.ts`, never from memory.

## Testing

Run from this directory inside the repository's Devbox shell. `pnpm test` needs the build, since `src/frontDoor.test.ts` reads it; Turbo's `test` task builds first.

- `session/domain/lifecycle.test.ts`: the lifecycle as a table: things that happened, in order, and the lists it must ask for. No browser, no clock.
- `timeline/domain/timeline.test.ts`: snapshots and reports in, package text out. Expected text comes from `timeline/domain/fixtures`, whose README says where each file is from, or is written out in the test; it is never produced by the code under test.
- `src/recorder.test.ts`: the handle, on the scripted browser.
- `src/recording.test.ts`: a recording on the scripted browser, where the test plays a click, a Settled Page and a report by hand and moves the clock, down to the package on disk.
- `src/startRecorder.test.ts`: starting on stock Playwright, as far as it goes without a browser.
- The end-to-end tests, which run the built command on real Chromium, live in [`apps/recorder-fixture`](../../apps/recorder-fixture/README.md).
