# Recorder engine source layout

The engine of the Recorder: it starts a recorder on the Playwright the project has installed, records clicks as Interactions, and ends with a Recording Package or with "empty". It is internal; the CLI (`packages/cli`) starts it, and the window (`packages/recorder-window`) knows only its `./contract` entry. Why it runs on stock Playwright: [ADR-0052](../../docs/adr/0052-the-recorder-runs-on-stock-playwright-and-uses-its-private-parts-only-under-test.md).

`src/` is cut into slices named for what they do, with layers inside a slice only where it needs them. [`eslint.config.js`](eslint.config.js) is the source of truth for which slices and layers each may use, and for where Playwright and Effect may be imported; `pnpm lint` flags a misplaced import, and `src/layout.test.ts` checks that it does.

Slices, from the bottom up:

- `contract`: the plain data shared with the CLI, the window and the toolbar: the outcome, the state with its phase and the Visits and entries recorded so far, updates with their counter, commands and their answer. Types only. It is the `./contract` entry.
- `timeline`: Visits, snapshots and Interactions in, the Visits with their entries out as they are produced, and the Recording Package at the end. `domain` holds what a recording is made of in the engine's words (`recorded.ts`), the `Timeline`, which keeps Visits and element identity with core's observation session and compares snapshots with core's trees, the rule that finds an Interaction's target (`target.ts`) and the released package text (`packageText.ts`). An entry is the contract's plain data, and the package is written from the very entries a subscriber was told. `infrastructure` writes the package where the released recorder keeps its recordings, with the recording's trace file beside it, under a temporary name that it renames, and finds a recording's trace for `trace`. No Effect: its work is promises.
- `session`: one live recorder. `domain` holds the lifecycle, one pure function (`step`) from a state and one thing that happened to a new state and a list of things to do, and the start error. `application` holds the queue with its one worker (`RecorderSession`), which feeds `step` and carries out its list in order, and the engine's one seam, the recorded browser (`RecordedBrowser`), which speaks the engine's words and never Playwright's.
- `playwright`: the stock Playwright adapter of the recorded browser. It finds the project's own Playwright, launches Chromium with it or attaches to a running one, and carries out the engine's requests on it. Launching and attaching differ only in how the adapter gets its browser and lets go of it: an attached browser's open page gets the page scripts at once, and is put back as it was found before the connection closes, never closed. `pageScripts.ts` holds what runs inside a recorded page: the gate that holds a click back, and the watch that tells of the page's activity. What a Settled Page is, core decides ([ADR-0024](../../docs/adr/0024-core-owns-the-meaning-of-a-settled-page.md)): the adapter gives core's `waitForSettled` the page's activity and nothing more, so no quiet window, deadline or retry lives in the adapter or in a page. `projectPlaywright.ts` finds the project's Playwright and holds it to the supported range; `playwrightRecorder.ts` is the one place that knows how each supported version starts Playwright's own recorder and shapes its reports. `traceTool.ts` runs the project's own `playwright trace`: after a trace is stopped it asks the tool for the position numbers of the snapshot marks the adapter left in it, and `trace` passes through to it. The only slice that may import Playwright, types included.
- `server`: the window's server. It holds no code yet.
- `engine`: the composition root and the front door. `startRecorder` picks the stock adapter; `startRecorderOn` turns a session on any recorded browser into the handle a caller gets, and is the one place Effect becomes promises. `runTrace` is the `trace` command: it says which trace file the arguments name (`latest`, a recording id or a path) and hands them to the project's own `playwright trace`.
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
- `ask` returns at once, for every request and in both adapters, and the answer comes later as a signal. The one worker never waits on the browser, so a page that is slow or stuck cannot keep a command or a time limit from being handled.
- A request that breaks while it is carried out is answered by the signal "requestFailed", which carries the request. The lifecycle says what follows for each kind of request (`failed` in `lifecycle.ts`), so that no state waits for an answer that cannot come: a new `BrowserRequest` gets its case there, with a row. Only a request for a page that is gone may be answered by nothing, since the page's closing was told.
- One trace per recording, decided by the lifecycle: `startTrace` at the first Record (Continue goes on in the trace that is running), `stopTrace` with `keep` at the save, which waits for "traceStopped" before the package is written, and without `keep` on Clear. The adapter uses Playwright's public tracing and leaves a mark in the trace for each snapshot; the package's position numbers are the stock trace tool's numbers for those marks, taken from the tool itself, never counted from the archive. A trace that cannot be stopped does not lose the recording: the package is written without it.
- Playwright's own recorder is switched on and off with `reportInteractions`, by its mode: the stock adapter starts it once and never stops it. It is on while the recorder records and through a wrap-up, whose reports are still owed, and off whenever the recorder lives on without recording.
- Requests are carried out side by side. When one must follow another, the lifecycle asks for the second when the first is answered, as Record does: Playwright reports Interactions, then the pages hold inputs back, then Record is answered.
- A command is answered in the step that handles it, or, when its answer depends on the browser, kept with `deferReply` and given with `replyDeferred`. Every path out of that state gives the answer.
- Stop, Clear, Finish and an end from outside all end a stretch of recording through one wrap-up, which carries what it leads to (`then`). A new way to end a stretch is a new value there, not a second wrap-up. While no recording is under way the lifecycle keeps no input: a click a page still holds back then is passed on at once (`aside`).
- Whether a recording is empty is the timeline's to say: `package` gives null until an Interaction is recorded, as the released recorder writes no package then.
- A new thing the timeline keeps is a member of `TimelineAddition`, which the lifecycle lists like any other thing to do. After each one the worker tells subscribers the Visits and entries if there is one more, under a new revision.

## Effect

The flows and adapters are written with Effect 4. The pure rules, the contract, the front door and anything injected into a page are not; lint enforces where `effect` may be imported.

- The documentation to use is the one shipped inside the installed package: `node_modules/effect/AGENTS.md` in this package's folder, which links to runnable examples in `node_modules/effect/ai-docs/` beside it.
- Most knowledge of Effect is from version 3, and many names changed in version 4. The rename guide: <https://github.com/Effect-TS/effect/blob/effect@4.1.4/MIGRATION.md>.
- Production code uses only the stable `effect` package: no `@effect/*` package and no `effect/unstable/*` module, so none of Effect's own HTTP, socket or process modules. Tests may use the Vitest helper for Effect, `@effect/vitest`; its 4.1 releases need Vitest 5, so it is not installed while the repository is on Vitest 4. The test clock is in the stable package, at `effect/testing`.
- Check every name in the installed type definitions, `node_modules/effect/dist/*.d.ts`, never from memory.

## The supported Playwright range

[`playwright-range.json`](playwright-range.json) beside this file states the range: the oldest Playwright the recorder starts on and the newest it is verified on. The adapter, CI's per-version job and the weekly canary read it. It is not the root `playwright-range.json`, which is the published packages' `@playwright/test` range. Below the range, or with no Playwright recorder found, starting fails with an error that names the range; above it, the recorder still records.

A private part of Playwright that the adapter uses gets a test in the recorded browser's contract suite (ADR-0052). To verify a new Playwright minor, run the suite and the main end-to-end test on it, then move `lastVerified`.

## Testing

Run from this directory inside the repository's Devbox shell. `pnpm test` needs the build, since `src/frontDoor.test.ts` reads it; Turbo's `test` task builds first.

- `session/domain/lifecycle.test.ts`: the lifecycle as a table: things that happened, in order, and the lists it must ask for. No browser, no clock. Each bug path of the lifecycle model is a row, and a row that keeps one of the spec's rules says which.
- `timeline/domain/timeline.test.ts`: snapshots and reports in, package text out. Expected text comes from `timeline/domain/fixtures`, whose README says where each file is from, or is written out in the test; it is never produced by the code under test.
- `src/recorder.test.ts`: the handle, on the scripted browser.
- `src/recording.test.ts`: a recording on the scripted browser, where the test plays a click, a Settled Page and a report by hand and moves the clock, down to the package on disk.
- `src/recordingControls.test.ts`: Stop, Continue, Clear, the ways a recorder ends and what a save leaves on disk, on the scripted browser in the same way.
- `engine/trace.test.ts`: which trace file `trace`'s arguments name. `playwright/infrastructure/traceTool.test.ts`: the position numbers read from what the stock trace tool prints.
- `src/startRecorder.test.ts`: starting on stock Playwright, as far as it goes without a browser, on stand-ins for Playwright that the test installs in a folder. One stand-in opens a page that can never be read, which shows that the stock adapter does not make the recorder wait.
- `playwright/infrastructure/stockBrowser.contract.test.ts`: the recorded browser's contract on stock Playwright, in the seam's words only, one test per private part of Playwright the adapter uses. It launches Chromium, so it is not in `pnpm test`: run it with `pnpm test:contract`. It runs twice, as two Vitest projects: `launch`, on a browser the adapter launches, and `attach`, on a running browser it attaches to, whose own connection is another automation client; a test of attaching alone runs only in `attach`. It uses the Playwright installed in the folder `AYME_RECORDER_PLAYWRIGHT_PROJECT` names, or else this package's own; CI runs it once per supported version, and the weekly Playwright canary on the newest.
- The end-to-end tests, which run the built command on real Chromium, live in [`apps/recorder-fixture`](../../apps/recorder-fixture/README.md).
