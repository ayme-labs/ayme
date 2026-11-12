# Recorder engine, design 2: the default case is one call

Constraint: make the most common caller trivial. That caller wants to record a URL until the person presses Finish, and then learn where the Recording Package is.

## The whole idea in one example

```ts
import { record } from "@ayme-dev/recorder";

const result = await record("https://shop.example");
```

That is a complete program. It launches the browser, serves the recorder window, starts recording, waits for Finish (or for the last page to close, or for Ctrl+C), writes the Recording Package, closes the browser, and resolves.

Everything else in this design exists so that this one call can stay that small:

- There is **one deep module**, `record`. The caller learns one function, one options object and one result type.
- Under it sits **one handle**, `Recorder`, for the callers that need more: the window, the toolbar, and tests that drive the lifecycle step by step. `record` is written on top of that handle and adds nothing the handle cannot do.
- There is **one real seam**, the browser. Everything that touches Playwright sits behind it.

---

## 1. The interface

### 1.1 `record`: the default case

```ts
function record(target: string | RecordOptions): Promise<RecordingResult>;

type RecordOptions = {
  /** Launch a browser on this URL. */
  url?: string;
  /** Or attach to a running browser by its CDP address. `url` then opens a new tab; without it the open tabs are recorded. */
  attach?: string;

  /** Folder that holds `.ayme/recordings`. Default: the current working directory. */
  projectRoot?: string;
  /** Where to find the project's Playwright. Default: resolved from `projectRoot`. */
  playwrightFrom?: string;

  /** Start recording as soon as the first page has loaded. Default: true. */
  startRecording?: boolean;
  /** Launch options. Ignored with `attach`. */
  browser?: { headless?: boolean; debugPort?: number };
  /** Port of the window's local address. Default: a free port. */
  windowPort?: number;

  /** Ctrl+C handling. Default "process": the engine listens for SIGINT and SIGTERM itself. Pass an AbortSignal to end the recording from code instead, or "none". */
  stopOn?: "process" | "none" | AbortSignal;
  /** Things worth telling the person. Default: one plain sentence per notice on stderr. */
  onNotice?: (notice: Notice) => void;
};

type RecordingResult =
  | {
      outcome: "saved";
      id: string;                 // rec_20261112T145047604Z
      directory: string;          // <projectRoot>/.ayme/recordings/<id>
      packagePath: string;
      tracePath: string | null;   // null when the browser vanished before the trace was written
      interactions: number;
      warnings: Warning[];
    }
  | { outcome: "empty" };         // Record was never pressed, or everything was cleared

type Warning =
  | { kind: "report-missing"; detail: string }   // Playwright never reported an input; wrap-up hit its time limit
  | { kind: "trace-lost"; detail: string }
  | { kind: "snapshot-shape-differs"; detail: string }  // see 3, "the shape check"
  | { kind: "playwright-untested"; version: string };

type Notice =
  | { kind: "window-ready"; url: string }
  | { kind: "recording-started" }
  | { kind: "saving" }
  | { kind: "stop-ignored-while-saving" }        // the second Ctrl+C
  | { kind: "warning"; warning: Warning };
```

What the caller must know about `record`:

- **Order of calls:** there is none. One call, one promise.
- **Cleanup:** there is none. When the promise settles, the browser is closed (or, with `attach`, left running with the gate off and nothing of ours left in its pages), the window's server is stopped, and the signal handlers are removed. This holds on success, on rejection and on Ctrl+C.
- **It resolves, not rejects, for everything the person can cause.** Finish, closing the last page, Ctrl+C and Clear-then-close all resolve. `outcome` says which.
- **It rejects only when no recording could be made or saved,** with a `RecorderError`:

```ts
class RecorderError extends Error {
  code:
    | "playwright-not-found"      // nothing resolvable from playwrightFrom
    | "playwright-unsupported"    // older than 1.62
    | "launch-failed"
    | "attach-failed"
    | "window-port-unavailable"
    | "save-failed"               // carries `directory` of the temporary folder when one was written
    | "internal";
}
```

- **Guarantees:** the ten lifecycle rules and the three extra checks of the lifecycle model. The ones a caller can observe: a saved package holds everything done up to Finish; Finish twice saves once; a second Ctrl+C does not cut a save short; the package folder appears complete or not at all (written to a temporary folder, then renamed).
- **Playwright newer than the newest tested version:** recording goes on and the result carries a `playwright-untested` warning. (My assumption; the brief leaves this open.)

### 1.2 `startRecorder`: for callers that need the lifecycle

```ts
function startRecorder(target: string | RecordOptions): Promise<Recorder>;

interface Recorder {
  /** Local address of the recorder window. */
  readonly windowUrl: string;

  /** Send a command. Resolves when the engine has taken it in, not when its effect is over. */
  send(command: Command): Promise<"accepted" | "ignored">;

  /** Listen. The listener is called at once with the full state, then with each change. Returns "stop listening". */
  subscribe(listener: (message: RecorderMessage) => void): () => void;

  /** Settles when the recorder has ended. Never rejects for a person's action. */
  readonly finished: Promise<RecordingResult>;

  /** End from outside, like a terminal stop. Safe to call more than once. Resolves with `finished`. */
  end(): Promise<RecordingResult>;
}
```

`record(target)` is `startRecorder(target)` followed by `recorder.finished`. With `startRecorder`, `startRecording` defaults to `false`, so a test begins in "not recording".

The plain data that crosses to the window and the toolbar (zod schemas, in the `contract` slice):

```ts
type Command =
  | { type: "record" } | { type: "stop" } | { type: "continue" }
  | { type: "clear" }  | { type: "finish" }
  | { type: "assertVisibility" }
  | { type: "discard"; entryId: string } | { type: "restore"; entryId: string }
  | { type: "highlight"; entryId: string } | { type: "clearHighlight" };

type Phase =
  | "notRecording" | "recording" | "pickingElement"
  | "wrappingUp" | "paused" | "saving" | "ended";

type RecorderState = {
  revision: number;                      // goes up with every message; an older message is ignored
  phase: Phase;
  wrappingUpFor?: "pause" | "save" | "clear";
  allowed: Command["type"][];            // what the buttons may do right now
  result?: RecordingResult;              // only in "ended"
};

type RecorderMessage =
  | { type: "snapshot"; state: RecorderState; visits: VisitView[]; entries: TimelineEntry[] }
  | { type: "state"; state: RecorderState }
  | { type: "visit"; revision: number; visit: VisitView }
  | { type: "entry"; revision: number; entry: TimelineEntry }       // add or replace by id
  | { type: "entryRemoved"; revision: number; entryId: string }
  | { type: "reset"; state: RecorderState };                        // after Clear

type TimelineEntry = {
  id: string;                            // interaction_6
  order: number;
  visitId: string;
  kind: "interaction" | "assertion" | "unassignedChange";
  action?: { name: string; selector: string; value?: string };
  target?: { ref: string | null; exact: boolean };   // exact:false = marked on the nearest ancestor present
  changedBefore?: string;                // Change Tree, serialized
  changedBy?: string;                    // Change Tree, serialized; absent for an assertion or a click that left the page
  complete: boolean;                     // false until the "after" is in
  discarded: boolean;
};
```

What a caller of the handle must know:

- **A command that does not apply is ignored,** never queued and never a toggle. `send` answers `"ignored"`. `state.allowed` tells the buttons in advance.
- **`"accepted"` does not mean "done".** Stop, Finish and Clear pass through `wrappingUp` first. The caller watches `state.phase`.
- **The first message of every subscription is a `snapshot`.** A window that reloads subscribes again and has everything. No cursor.
- **Messages carry a rising `revision`.** A listener drops any message whose revision is not higher than the last one it took.
- **Discard and restore are accepted only in `paused`.**
- **After `ended`, `send` answers `"ignored"` and `subscribe` delivers one `snapshot` and nothing more.**

### 1.3 What is not in the interface

No browser, context or page object. No Playwright type. No Effect type. No "install the gate", "start tracing", "flush" or "dispose". A caller cannot get the order wrong because there is no order to get.

---

## 2. Usage

### 2.1 The whole of `codegen <url>`

```ts
// packages/<cli>/src/codegen.ts
import { record, RecorderError } from "@ayme-dev/recorder";

export async function codegen(url: string, flags: { attach?: string }): Promise<number> {
  try {
    const result = await record({ url, attach: flags.attach });
    if (result.outcome === "empty") {
      console.log("Nothing was recorded.");
      return 0;
    }
    console.log(`Recording saved: ${result.directory}`);
    return 0;
  } catch (error) {
    if (error instanceof RecorderError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}
```

The window's address, "saving, please wait" on a second Ctrl+C, and warnings are printed by the engine's default `onNotice`. The command-line program writes none of that.

### 2.2 The window: live entries and one command

The engine serves the window's built files and a tRPC channel on one local address. The channel has two procedures. Both are thin wrappers of the handle.

```ts
// engine side: packages/recorder/src/window/infrastructure/windowRouter.ts (shape only)
const windowRouter = router({
  messages: procedure.subscription(/* recorder.subscribe → the socket */),
  send: procedure.input(CommandSchema).mutation(/* recorder.send */),
});
export type WindowRouter = typeof windowRouter;
```

```ts
// window side: packages/recorder-window (React, no Effect)
import type { WindowRouter, RecorderMessage } from "@ayme-dev/recorder/contract";

const client = createTRPCClient<WindowRouter>({ links: [wsLink({ client: createWSClient({ url }) })] });

client.messages.subscribe(undefined, {
  onData(message: RecorderMessage) {
    store.apply(message);          // snapshot replaces; entry upserts; lower revision is dropped
  },
});

// the Finish button
await client.send.mutate({ type: "finish" });
```

A reload runs the same code again and gets a fresh `snapshot`. The toolbar inside the recorded page gets the same `RecorderState` and sends the same `Command`, through a page binding inside the browser adapter. Both surfaces are listeners of one handle, so they cannot disagree for longer than a message takes to arrive.

---

## 3. What the implementation hides

Behind `record` and the handle:

- **Finding and checking Playwright.** Resolving the project's own Playwright, reading its version, refusing below 1.62, choosing `_enableRecorder` (through 1.63) or `_startRecording` (from 1.64).
- **Launch or attach.** Including what "clean up" means for each: close the browser, or leave it running with our scripts and gate removed.
- **The gate.** The page script that swallows the final click or key press, the "before" snapshot, the re-send, the settle wait (quiet for 150 ms, or 2 s), the "after" snapshot. A new page starting with the gate in the right state.
- **Pairing.** Playwright's reports arrive about half a second late. The engine matches each to the input it held.
- **Ungated input.** Typing, native select and file upload take their "before" from the snapshot inside Playwright's event.
- **The shape check.** On the first ungated report of a recording the engine compares the event snapshot's shape with a public snapshot of the same frame. If they differ, ungated input falls back to "after only" and the result carries a `snapshot-shape-differs` warning. The per-version test (section 7) asserts they do not differ.
- **Visits and identity.** Core's `StructuralObservationSession` and its identity ledger; a visit's first snapshot; the nearest-ancestor mark for a missing click target.
- **The lifecycle.** All states of the model, wrap-up with its time limit, ignoring commands that do not apply, the revision counter.
- **Assert visibility.** Playwright's picking mode, our own highlight, removing `data-pw-cursor` from `<body>`, hiding `x-pw-glass`.
- **Playwright's recorder is off whenever we are not recording.**
- **Tracing.** Start at the first Record, through pauses, stop at Finish (kept) or Clear (thrown away). A marker per snapshot, and the position numbers from the project's own `playwright trace` tool at save time.
- **The Recording Package.** The released format, the temporary folder and the rename.
- **The window's server.** Node `http` and `ws`, tRPC, a free port.
- **Process signals.** A first Ctrl+C is an outside end. A second one during wrap-up or saving is ignored with a notice.
- **Effect.** The runtime, the scope, the fibers.

---

## 4. Dependencies and adapters

| Dependency | Category (DEEPENING.md) | Seam? | Adapters |
|---|---|---|---|
| Playwright and the browser | true external | **Yes, the one real seam: `RecordedBrowser`** | (1) stock Playwright, (2) a scripted browser for flow tests |
| The `Recorder` handle itself | in-process | **Yes, it is the external interface** | (1) the engine, (2) a scripted recorder the window's tests drive |
| Disk for the package | local-substitutable | A thin port, forced by the layer rule (see below) | (1) the file system, (2) in memory, for flow tests |
| Core's observation session | in-process | No. Used directly | |
| Clock | in-process | No port of ours. Effect's own `Clock`, with `TestClock` in tests | |
| HTTP and WebSocket | local-substitutable | No. Tests use the real server on a free port | |
| Process signals | in-process | No. `stopOn` takes an `AbortSignal` | |

### The browser seam

What varies across it: a real browser driven by the project's Playwright, or a script of events a test wrote.

The port speaks the recorder's language, not Playwright's:

```ts
// recording/application/RecordedBrowser.ts (an Effect service; never leaves the package)
interface RecordedBrowser {
  /** Everything the browser tells us, in the order it happened. One stream. */
  readonly events: Queue.Dequeue<BrowserEvent>;

  snapshot(pageId: PageId): Effect<PageSnapshot, PageGone>;      // public ariaSnapshot + a trace marker
  passOn(holdId: HoldId): Effect<void, PageGone>;                // re-send a held input
  whenSettled(pageId: PageId): Effect<"quiet" | "timeLimit", PageGone>;

  setGate(on: boolean): Effect<void>;                            // every page and frame, and every later document
  setCapture(mode: "off" | "recording" | "picking"): Effect<void>;  // Playwright's own recorder

  startTrace(): Effect<void>;
  stopTrace(keepAt: string | null): Effect<TraceFile | null>;   // null path = throw away
  tracePositions(trace: TraceFile, markers: TraceMarker[]): Effect<Map<TraceMarker, string>>;

  showState(state: RecorderState): Effect<void>;                 // the toolbar
  highlight(target: HighlightTarget | null): Effect<void>;
}

type BrowserEvent =
  | { type: "pageOpened"; pageId; url } | { type: "navigated"; pageId; url }
  | { type: "pageClosed"; pageId }      | { type: "lastPageClosed" }
  | { type: "inputHeld"; holdId; pageId; input: "click" | "key" }
  | { type: "gateConfirmed"; pageId; on: boolean }
  | { type: "reported"; pageId; report: InteractionReport; eventSnapshot?: string }
  | { type: "reportUpdated"; pageId; report: InteractionReport }
  | { type: "toolbarCommand"; command: Command };
```

All private Playwright use sits in the stock adapter: the two start calls, the recorder's mode, `_ariaRef`, the page `_guid`, the action's shape (wrapped through 1.62, bare from 1.63). Launch and attach are two ways the same adapter gets its browser. They differ in how the browser is acquired and released, not in the port, so they are not two adapters.

### The package store

```ts
interface PackageStore {
  reserve(): Effect<{ id: string; tempDirectory: string; tracePath: string }>;
  commit(id: string, document: RecordingDocument): Effect<SavedPackage, SaveFailed>;  // write, then rename
  discard(id: string): Effect<void>;
}
```

Said plainly: by the vocabulary this is a local-substitutable dependency and would need no port. It has one because the repository's layer rule forbids a flow (`application`) from importing a file writer (`infrastructure`). The in-memory adapter keeps flow tests off the disk, which is a modest gain.

### Seams I did not add

- No port for "launch versus attach".
- No port for "the gate". The gate is a page script plus two port methods (`setGate`, `passOn`) and two events.
- No port for the window's channel. The window server is a caller of the handle.
- No port for the toolbar. It is two members of the browser port.
- No "trace reader" port. Positions are one method of the browser port, because they depend on the Playwright version.

---

## 5. Slices and layers

Five slices, one port that matters. Folder names say what the code does.

```
packages/recorder/src/
  contract/      (not layered)
  recording/     domain · application · infrastructure · test-utils
  playwright/    infrastructure
  window/        infrastructure
  recorder/      (not layered) composition root and front door
  index.ts       re-exports recorder/: record, startRecorder, RecorderError, the result types
```

| Slice | Owns | May import |
|---|---|---|
| `contract` | The plain data that leaves the engine: `Command`, `RecorderState`, `RecorderMessage`, `TimelineEntry`, `RecordingResult`, `Notice`, as zod schemas; the `Recorder` handle type; the `WindowRouter` type. Browser-safe. It is the `./contract` entry the window imports. | zod only |
| `recording/domain` | The pure rules. The **timeline** (pairing reports with held inputs, which snapshot is whose "before" and "after", "a newer snapshot closes the previous interaction", no changes on an assertion or on a click that left the page, the ancestor mark, discard flags), on top of core's observation session. The **lifecycle** rules (which command applies in which phase, when wrap-up is over). The **package document** (timeline + header + positions → the released format). | `contract`, `@ayme-dev/core` |
| `recording/application` | The flows: the session loop, the gate cycle, wrap-up, save. The two ports, `RecordedBrowser` and `PackageStore`. | `recording/domain`, `contract`, `effect` |
| `recording/infrastructure` | `PackageStore` on the file system. | the two layers above, `node:fs` |
| `recording/test-utils` | The scripted browser, the in-memory store. | the layers above |
| `playwright/infrastructure` | The stock Playwright adapter of `RecordedBrowser`: loading and version, launch and attach, private calls, tracing and positions, settle. The page scripts (gate, toolbar, highlight) as plain script files with no Effect. | `recording/application` (the port), `contract`, `effect` |
| `window/infrastructure` | The HTTP server, the WebSocket, the tRPC router, serving the window's built files. | `contract` only (it takes a `Recorder`) |
| `recorder` | `record` and `startRecorder`. Builds the layers, owns the runtime, turns the Effect inside into the promise handle, handles signals and notices. | everything |

Rules lint would hold:

- Slice order, bottom up: `contract`, `recording`, then `playwright` and `window` side by side, then `recorder`.
- `playwright` and `window` never import each other.
- Only `playwright/` may import or `require` anything of Playwright.
- `effect` is not imported in `contract`, in `recording/domain`, in `window`, or in page scripts.
- `recording/domain` uses domain only; `recording/application` uses application and domain; infrastructure may use any layer (ADR-0046's order).

Why not more slices: the timeline, the lifecycle rules and the package document are separate files in one `domain` folder. Splitting them into slices would add front doors with one caller each. That was the fault of the withdrawn seven-slice sketch.

The other packages:

- `packages/recorder-window`: React. Imports `@ayme-dev/recorder/contract` (types and schemas) and nothing else of the engine.
- The command-line package: imports `record` and `RecorderError`.
- The fixture app: imports `startRecorder`, and the window's page objects.

---

## 6. The two hard parts

Both rest on one decision: **one mailbox, one fiber.** Everything that can happen becomes a message in a single queue: what the browser reports, what the person commands, what a timer says. One fiber takes one message at a time and finishes with it before it takes the next. The session's state is a plain value that only this fiber touches.

Effect names below were checked against the installed `effect` 4.1.4 type definitions: `Effect.gen`, `Effect.fnUntraced`, `Effect.forever`, `Effect.forkScoped`, `Effect.sleep`, `Effect.andThen`, `Effect.uninterruptible`, `Effect.acquireRelease`, `Effect.scoped`, `Effect.callback`, `Effect.tryPromise`, `Effect.catchTag`, `Queue.unbounded`, `Queue.offer`, `Queue.offerUnsafe`, `Queue.take`, `Deferred.make`, `Deferred.succeed`, `Deferred.await`, `FiberHandle.make`, `FiberHandle.run`, `FiberHandle.clear`, `Context.Service`, `Layer.effect`, `Layer.provide`, `ManagedRuntime.make` (with `runPromise` and `dispose`), `Data.TaggedError`, `Duration.millis`, and `TestClock.adjust` from `effect/testing`.

### 6.1 Strict ordering of clicks, typing and reports

Example first. The person types "milk", presses Enter, types "eggs".

1. The gate script holds Enter. Because an input is held, the page script also holds the letters of "eggs" behind it, in order.
2. The adapter puts `inputHeld(Enter)` in the mailbox.
3. The loop takes it. It snapshots ("before"), then calls `passOn`. Nothing else is handled in between, because the loop does not take the next message until these two steps are over.
4. The page script lets Enter through, then the held letters, in order.
5. The loop starts the settle wait as a separate fiber and goes back to the mailbox.
6. Playwright's report for Enter arrives as `reported`. The timeline pairs it with the held Enter, and the entry goes out to the listeners.
7. The typing report for "eggs" arrives with its event snapshot. That snapshot is newer, so it becomes Enter's "after" and the typing's "before". The settle fiber is interrupted.

```ts
// recording/application/session.ts (sketch, not working code)
type Mail =
  | { _tag: "Browser"; event: BrowserEvent }
  | { _tag: "Command"; command: Command; reply: Deferred.Deferred<"accepted" | "ignored"> }
  | { _tag: "Subscribe"; listener: Listener }
  | { _tag: "Settled"; interactionId: InteractionId; snapshot: PageSnapshot }
  | { _tag: "WrapUpTimeLimit"; wrapUp: number }
  | { _tag: "OutsideEnd" };

const session = Effect.gen(function* () {
  const browser = yield* RecordedBrowser;
  const mailbox = yield* Queue.unbounded<Mail>();
  const settle = yield* FiberHandle.make<void, PageGone>();   // at most one settle wait
  let state = initialSession();                               // plain value: lifecycle + timeline

  // the browser's ordered events flow into the same mailbox
  yield* Queue.take(browser.events).pipe(
    Effect.andThen((event) => Queue.offer(mailbox, { _tag: "Browser", event })),
    Effect.forever,
    Effect.forkScoped,
  );

  const onInputHeld = Effect.fnUntraced(function* (hold: Held) {
    const before = yield* browser.snapshot(hold.pageId);      // also closes the previous interaction
    state = timeline.held(state, hold, before);
    yield* browser.passOn(hold.holdId);                       // exactly once; next mail waits until here
    yield* FiberHandle.run(                                   // replaces, and so interrupts, an older wait
      settle,
      browser.whenSettled(hold.pageId).pipe(
        Effect.andThen(() => browser.snapshot(hold.pageId)),
        Effect.andThen((after) => Queue.offer(mailbox, { _tag: "Settled", interactionId: hold.id, snapshot: after })),
      ),
    );
  }, Effect.catchTag("PageGone", () => dropHold /* the page is gone: the click is dropped */));

  // one message at a time
  yield* Queue.take(mailbox).pipe(Effect.andThen(handle), Effect.forever);
});
```

What each accepted addition becomes:

| Addition | Where it lives |
|---|---|
| A newer snapshot closes the previous interaction | A pure timeline rule. In the flow, `FiberHandle.run` interrupting the older settle wait. |
| While an input is held, everything after it waits, typing included | The page script queues behind a hold. The loop passes holds on in arrival order and cannot do otherwise. |
| Assert visibility takes effect only when no click is held | Free. A command is a message; it is handled only after the `inputHeld` before it has been passed on. |
| A held click is dropped if its page is gone | `PageGone` from `snapshot` or `passOn`, caught in one place. |
| State messages carry a counter | The loop is the only writer of `state.revision`. |
| A new page starts with the gate matching the state | `setGate` covers later documents; the adapter holds the current value. `gateConfirmed` events let the loop check. |

`Subscribe` is a message too. The loop sends the `snapshot` and adds the listener in one step, so no change can fall between "full state" and "first delta".

The pure half is `timeline.*` and `lifecycle.*` in `recording/domain`. The loop asks them what to do and does it.

### 6.2 Wrapping up

Example first. The person clicks "Add to cart" and presses Finish at once.

1. `Command finish` is taken. The lifecycle rule says: go to `wrappingUp` for `save`. The loop publishes the state, calls `browser.setGate(false)`, and starts the time limit.
2. The loop keeps taking messages as before. A click that the gate still holds is snapshotted and passed on. `gateConfirmed(off)` arrives. Playwright's late report for "Add to cart" arrives and is paired.
3. After every message the loop asks a pure question: is the gate confirmed off on every live page, is no input held, is no report owed?
4. When the answer is yes, or when the time limit message arrives, wrap-up is over. The loop takes the last "after" snapshot, switches Playwright's recorder off, and moves on: to `paused`, to saving, or to clearing.

```ts
const beginWrapUp = Effect.fnUntraced(function* (then: "pause" | "save" | "clear" | "clearAndEnd") {
  state = lifecycle.wrapUpStarted(state, then);               // revision + 1, wrapUp id + 1
  yield* publishState;
  yield* browser.setGate(false);
  const wrapUp = state.wrapUp;
  yield* Effect.sleep(Duration.millis(WRAP_UP_LIMIT_MS)).pipe(
    Effect.andThen(() => Queue.offer(mailbox, { _tag: "WrapUpTimeLimit", wrapUp })),
    Effect.forkScoped,
  );
});

// run after every message while phase is "wrappingUp"
const maybeEndWrapUp = Effect.fnUntraced(function* (timeLimitHit: boolean) {
  if (!timeLimitHit && !lifecycle.wrapUpIsOver(state)) return;
  if (timeLimitHit) state = lifecycle.warn(state, "report-missing");
  yield* closeLastInteraction;                                // the final "after"
  yield* browser.setCapture("off");                           // only now: the reports are in
  switch (state.wrappingUpFor) {
    case "pause":       return yield* enterPaused;
    case "save":        return yield* Effect.uninterruptible(save);
    case "clear":       return yield* clearAndGoBackToNotRecording;   // trace thrown away
    case "clearAndEnd": return yield* clearAndEndEmpty;
  }
});
```

The points that carry the rules:

- **The time limit is a message.** It is handled in order like anything else. A stale one (from an earlier wrap-up) is recognised by its `wrapUp` number and ignored. In tests, `TestClock.adjust` makes it fire.
- **An outside end during wrap-up** changes what wrap-up is for (`pause` becomes `save`, `clear` becomes `clearAndEnd`), exactly as the lifecycle chart draws it. It does not start a second wrap-up.
- **A second terminal stop cannot kill a save.** A signal is only ever turned into an `OutsideEnd` message. While wrapping up or saving, the rule says "ignored", and a `stop-ignored-while-saving` notice goes out. `save` itself runs under `Effect.uninterruptible`.
- **Finish twice saves once.** The second `finish` is a command that does not apply.
- **After Clear, nothing old comes back.** Wrap-up waited for the owed reports, and Playwright's recorder is off afterwards. A report that still arrives with no input owed and no recording running is dropped by the timeline rule.

### 6.3 How the front door hides Effect

```ts
// recorder/startRecorder.ts (sketch)
export async function startRecorder(target: string | RecordOptions): Promise<Recorder> {
  const runtime = ManagedRuntime.make(
    Layer.provide(SessionLive, Layer.mergeAll(stockPlaywright(options), packageStoreOnDisk(options))),
  );
  // build the layers now, so launch and attach failures reject this promise
  const session = await runtime
    .runPromise(Effect.gen(function* () { return yield* Session; }))   // the service is read inside Effect.gen
    .catch(toRecorderError);
  ...
  return {
    windowUrl,
    send: (command) => runtime.runPromise(session.send(command)),
    subscribe: (listener) => session.subscribeUnsafe(listener),   // Queue.offerUnsafe under it
    finished,                                                      // settles, then runtime.dispose()
    end: () => (session.outsideEndUnsafe(), finished),
  };
}
```

The browser, the gate scripts, the HTTP server and the signal handlers are each an `Effect.acquireRelease` inside a layer. Disposing the runtime releases them in reverse order. That is why the caller has no cleanup to do. `toRecorderError` maps the tagged errors (`Data.TaggedError`) to `RecorderError` codes, so no Effect value or type reaches a caller.

---

## 7. How each kind of test reaches the design

**1. Input in, package out, once per supported Playwright version.**

```ts
const recorder = await startRecorder({
  url: fixtureUrl,
  playwrightFrom: installs["1.62"],          // one folder per supported version
  projectRoot: tmp,
  startRecording: true,
  stopOn: "none",
  browser: { headless: true, debugPort },
});
await giveRealInput(debugPort);              // raw CDP input, from the test's own connection
await recorder.send({ type: "finish" });
const result = await recorder.finished;
expect(readPackage(result.directory)).toMatchReleasedFormat();
```

The test crosses the same interface as the command-line program. The awkward part is honest: the engine owns the browser, so the test reaches the page through a debug port. In the attach variant the test launches the browser itself, which is simpler, and it covers attach.

The same version matrix runs the adapter's own checks: the two private start calls, the report's shape, and the event-snapshot shape check.

**2. The window, through its page objects.**

`window/infrastructure` serves any `Recorder`. The window's tests serve a scripted one:

```ts
const recorder = scriptedRecorder();          // from @ayme-dev/recorder/testing: a second adapter of the handle
const { url } = await serveWindow(recorder);
await page.goto(url);
recorder.emit({ type: "entry", revision: 4, entry });
await windowPom.timeline.entry(0).discard();
expect(recorder.commands).toEqual([{ type: "discard", entryId: entry.id }]);
```

Reload recovery is a test of "subscribe again, get a snapshot". The fixture app adds a few runs with the real engine behind the same page objects.

**3. Snapshots in, timeline out, with no browser.**

Reaches `recording/domain` directly. No Effect, no port, no fake:

```ts
const t = createTimeline();
t.visitStarted({ pageId: "p1", url, cause: "initial" });
t.held({ holdId: "h1", pageId: "p1", input: "click" }, snapshot(BEFORE));
t.reported(clickReport);
t.snapshotTaken("p1", snapshot(AFTER));
expect(t.entries()[0].changedBy).toBe(expectedChangeTree);
```

One level up, the flow tests run the session loop against the scripted browser and the in-memory store with `TestClock`. That is where the lifecycle rules and the wrap-up time limit are tested without a browser. These are the model's rules replayed against real code.

---

## 8. Trade-offs

**Where this design gives a lot per thing learned**

- The command-line program learns one function and one result type. It cannot leak a browser, lose a save to Ctrl+C, or get an order wrong.
- The window learns two procedures and one message type. Reload recovery costs it nothing.
- Every lifecycle rule lives in one place, behind one handle. The toolbar, the window, the terminal and tests all go through `send`, so a rule fixed once is fixed for all four.
- One port holds all of Playwright. A new Playwright version touches one slice.

**Where it is thin or awkward, and what the constraint costs**

- **The engine takes over the process.** By default it installs signal handlers and writes to stderr. That is unusual for a library. It is what makes the default case one line. `stopOn` and `onNotice` turn both off, and every test must remember to.
- **User-facing wording sits in the engine,** in the default `onNotice`. A thin command-line program was wanted, and this makes it thinner than usual: it no longer owns its own sentences.
- **`record` hides progress.** A caller that wants "recording started" or the window's address must pass `onNotice` or move to `startRecorder`. There is no middle step.
- **Tests come in through a side door.** The engine owns the browser, so a test cannot hand it a page. It needs `browser.debugPort` or attach mode. A design that takes a Playwright `BrowserContext` as input would make test kind 1 simpler and the common caller worse.
- **Nobody can compose the parts.** There is no public "gate", "timeline" or "package writer". Recording into an existing Playwright test, or writing a package from other input, is not possible without changing the engine. Nothing asks for it today.
- **`RecordOptions` is a bag.** Nine optional fields, some only meaningful together (`browser` is ignored with `attach`). The default caller sees none of them; the uncommon caller must read them all.
- **`RecordedBrowser` is a wide port,** eleven members and nine event kinds. It is one seam, but its scripted adapter is real work to write and keep honest. The per-version tests against real Playwright are what keep it honest, not the type.
- **One mailbox means one slow step delays everything.** A snapshot on a large page (about 280 ms in the prototype) holds up commands and reports for that long. That is the ordering the model asks for, but the Stop button will feel it.
- **`send` resolving with "accepted" before the effect is over** is a thing callers must learn. A `send` that waited for `paused` would be simpler to use in tests and wrong for buttons.
- **`PackageStore` is a port with thin justification** (see section 4).

**Assumptions I made that the brief leaves open**

- `record` starts recording by itself; `startRecorder` does not.
- A Playwright newer than the tested range records with a warning rather than refusing.
- The window's address is reported as a notice; nothing opens it automatically.
- A shape mismatch of the event snapshot degrades to "after only" for ungated input, with a warning, rather than failing the recording.
- `highlight` is a `Command` like the others, so the window needs no third procedure.
