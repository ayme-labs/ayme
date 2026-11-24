# Recorder engine source layout

The engine of the Recorder: it starts a recorder on the Playwright the project has installed, records every kind of input as Interactions, and ends with a Recording Package or with "empty". It is internal; the CLI (`packages/cli`) starts it, and the window (`packages/recorder-window`) knows only its `./contract` entry. Why it runs on stock Playwright: [ADR-0052](../../docs/adr/0052-the-recorder-runs-on-stock-playwright-and-uses-its-private-parts-only-under-test.md).

The slices of `src/`, from the bottom up:

- `contract`: the plain data shared with the CLI, the window and the toolbar, types only; the `./contract` entry.
- `timeline`: Visits, snapshots and Interactions in, the Visits with their entries out as they are produced, and the Recording Package at the end. Its `infrastructure` writes the package and its trace to disk and finds a recording's trace.
- `session`: one live recorder: the lifecycle (`session/domain/lifecycle.ts`), the queue's one worker (`RecorderSession`), and the engine's one seam, the recorded browser (`RecordedBrowser`).
- `playwright`: the stock Playwright adapter of the recorded browser. Its `infrastructure/live/` drives the browser, `infrastructure/in-page/` runs in a recorded page, and the plain logic beside them, such as `pageRules.ts`, decides ([docs/testing.md](../../docs/testing.md#code-a-real-browser-runs)).
- `server`: the window's server and the in-page toolbar's bridge.
- `engine`: the composition root (`engine/recorder.ts`), the front door, and the `trace` and `install` commands.
- `testing/`, beside `src/`: the package's test support (ADR-0057), imported from source as `@ayme-dev/recorder/testing`, with `startScriptedRecorder`, a real recorder on a scripted browser.

The layers inside a slice: `domain` (pure rules and types), `application` (the flows and the ports they use), `infrastructure` (Playwright, the disk, the network).

The checks:

- [`eslint.config.js`](eslint.config.js): which slices each slice may use, and the layer order across slices ([ADR-0046](../../docs/adr/0046-the-layer-order-holds-across-slices-through-one-front-door-per-layer.md)), in any import, a type written as `import("…")` included. In static and dynamic imports only: the front doors, Playwright only in the `playwright` slice, where Effect may be imported, and which files may reach `infrastructure/live/` and `infrastructure/in-page/`. Code in `in-page/` imports types only. [`src/layout.test.ts`](src/layout.test.ts) checks that lint flags each.
- [`src/publicTypes.test.ts`](src/publicTypes.test.ts): no Effect type or Playwright type is reachable from the built entry.
- [`src/outsideEnd.test.ts`](src/outsideEnd.test.ts): an end from outside finishes from every state it lists, on a browser gone silent.

Nothing checks the rules below, nor those under "Changing the lifecycle":

- Follow lint's rules for front doors, Playwright and Effect in a type written as `import("…")` too, since they bind `import type` as well, and lint does not read that form.
- Put every file of a layered slice in a layer folder, and give a layered slice no `index.ts` of its own, so the layer rule judges every file and import by its layer.
- Inside a slice, import the module itself rather than a front door, since front doors are for other slices.
- Hand an application module what it needs done on the disk or in the browser from the composition root, as the session is handed the function that saves a package and the recorded browser as a layer, since lint keeps it from importing another slice's infrastructure.
- Let nothing but promises, callbacks and plain data leave `src/index.ts`, and turn Effect into promises only in `startRecorderOn`, so a caller needs neither; `src/publicTypes.test.ts` catches only an Effect or Playwright type.
- Give each id or ref that could be taken for another a type of its own, under a name no other type in the repository has, as `EntryId`, core's `PageId`, `InputId`, `SnapshotId`, `TracePosition` and the refs in `timeline/domain/refs.ts` are, so the compiler tells them apart.
- Give a value its id type only where it is made or where it arrives, never by a cast on its way, so the type says where the value came from. In tests, write ids with the builders in `testing/ids.ts`, which serves every slice's tests since lint keeps a slice's tests out of another slice's folders; the scripted browser and the compatibility suite's harness take them as plain strings (`Written`).

## Changing the lifecycle

- Add behaviour as a state, a thing that happened or a thing to do in `session/domain/lifecycle.ts`, with a row in its table test, and change the worker only for a new kind of thing to do, since the lifecycle decides and the adapter only carries out.
- Give the window no second rule for which commands apply: `offered` reads them from the lifecycle's own answer to each.
- Add a new thing the browser can do as a member of `BrowserRequest`, carried out in the one `switch` of the stock adapter and of the scripted browser, which do nothing else there: no request leads to another, and no order is decided.
- Tell what comes of a request as a `BrowserSignal`, never as a return value, so the lifecycle sees an answer in order with what the browser noticed by itself; a new thing the browser can tell is a member of `BrowserSignal` too.
- Return from `ask` at once, for every request and in both adapters, with the answer later as a signal, so a page that is slow or stuck cannot keep a command or a time limit from being handled.
- Answer a request the browser could not carry out, because it broke on the way, with "requestFailed", and give a new `BrowserRequest` its case in `failed` with a row, so no state waits for an answer that cannot come. Only a request for a page that is gone may go unanswered, since the page's closing was told.
- When one request must follow another, have the lifecycle ask for the second once the first is answered, as Record does, since requests are carried out side by side.
- Answer a command in the step that handles it, or keep it with `deferReply` and give it with `replyDeferred` on every path out of that state, so no caller waits for an answer that never comes.
- End a stretch of recording through the one wrap-up, which carries what it leads to (`then`): a new way to end is a new value there, not a second wrap-up, so every end treats inputs still under way alike.
- Let no state wait for the browser without a time over the wait, as the wrap-up's limit and `within` give one, and give a new wait that an end from outside must pass through a state in `src/outsideEnd.test.ts`, since an end from outside always finishes, whatever the browser never answers.
- Add a new thing the timeline keeps as a member of `TimelineAddition`, which the lifecycle lists like any other thing to do, so the worker tells subscribers after it as after any other.
- Keep entries out of the lifecycle: it asks the timeline to keep a decision (`discard`, `restore`) and knows no entry, and the timeline leaves an id it does not have alone.
- Leave whether a recording is empty to the timeline: `package` gives null until an Interaction is recorded, as the released recorder writes no package then.
- Write the package text and an entry's change rows from the one Change Tree the timeline keeps for it, so the package is written from the very entries a subscriber was told.
- Send what an entry changed across the contract as change rows, plain data made for whoever shows a recorder, never as a tree or as the package's text.
- Put no quiet window, deadline or retry in the adapter or in a page, since core decides what a Settled Page is ([ADR-0024](../../docs/adr/0024-core-owns-the-meaning-of-a-settled-page.md)) and the adapter gives `waitForSettled` the page's activity and nothing more.
- Keep launching and attaching different only in how the adapter gets its browser and lets go of it, so the compatibility suite's `launch` and `attach` projects test one adapter.
- Put how each supported Playwright version starts Playwright's own recorder and shapes its reports in `playwrightRecorder.ts` alone, so a new Playwright minor touches one file.
- Take the package's trace positions from the stock trace tool's own numbers for the adapter's snapshot marks, never by counting the archive, since a reader opens a snapshot by the tool's number.
- Reach the recorder from `server` only through the handle every caller gets, attached by the composition root, so `server` needs no Effect.

## Effect

The flows and adapters are written with Effect 4; lint keeps it out of the rest.

- The documentation to use is the one shipped inside the installed package: `node_modules/effect/AGENTS.md` in this package's folder, which links to runnable examples in `node_modules/effect/ai-docs/` beside it.
- Most knowledge of Effect is from version 3, and many names changed in version 4. The rename guide: <https://github.com/Effect-TS/effect/blob/effect@4.1.4/MIGRATION.md>.
- Tests may use the Vitest helper for Effect, `@effect/vitest`. The test clock is in the stable package, at `effect/testing`.
- Check every name in the installed type definitions, `node_modules/effect/dist/*.d.ts`, never from memory.

## The supported Playwright range

[`playwright-range.json`](playwright-range.json) beside this file states the range: the oldest Playwright the recorder starts on and the newest it is verified on. The adapter, CI's per-version job and the weekly canary read it. It is not the root `playwright-range.json`, which is the published packages' `@playwright/test` range. Below the range, or with no Playwright recorder found, starting fails with an error that names the range; above it, the recorder still records.

A private part of Playwright that the adapter uses gets a test in the compatibility suite (ADR-0052), which proves the adapter works on each supported Playwright version. To verify a new Playwright minor, run the suite and the main end-to-end test on it, then move `lastVerified`.

## Testing

Run from this directory inside the repository's Devbox shell. `pnpm test` needs the build, since `src/publicTypes.test.ts` reads it; Turbo's `test` task builds first.

- Add each bug path the lifecycle model finds as a row of `session/domain/lifecycle.test.ts`, and say which spec rule a row keeps, so the table and the model stay matched.
- Take the expected package text of `timeline/domain/timeline.test.ts` from `timeline/domain/fixtures`, whose README says where each file is from, or write it out in the test, never from the code under test, since text the code made proves nothing about it.
- In `src/outsideEnd.test.ts`, end a fixture's recorder with `endWithin`, which moves its clock, since the scripted recorder's clock stands still.
- Write the compatibility suite, `playwright/infrastructure/live/stockBrowser.compat.test.ts`, in the words of the recorded browser's seam only: one test per private part of Playwright the adapter uses, and per behaviour of Playwright's recorder the engine relies on. It launches Chromium, so it is not in `pnpm test`: run it with `pnpm test:compat`. [`compatRunCheck.ts`](compatRunCheck.ts) checks each run.
- The end-to-end tests, which run the built command on real Chromium, live in [`apps/recorder-fixture`](../../apps/recorder-fixture/README.md).

## The lifecycle model

Each rule the lifecycle must keep is the comment above its check in [`lifecycle-model/Recorder.tla`](lifecycle-model/Recorder.tla); [the model's README](lifecycle-model/README.md) says what it assumes and leaves out. When a change alters the order of events, what the recorder waits for, or a promise it makes, run the model and update it, with the `verify-recorder-lifecycle` skill.

## Known limits

Users read the recorder's known limits in [the CLI's README](../cli/README.md#known-limits), and a coding agent reads what a package holds in [the `ayme-recorder` skill](../../skills/ayme-recorder/SKILL.md). Why one is so is a comment where the code makes it so, or, for one the model reproduces, under [the model's Known limits](lifecycle-model/README.md#known-limits).
