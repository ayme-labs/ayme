# Recorder engine, design 3: one port, placed where things really vary

Constraint for this design: put a seam only where something really differs across it, and let the engine's shape follow.

## The idea in one example

A person clicks "Add to cart". Four things happen that the engine cannot do by itself:

1. A page script holds the click back and says so.
2. Something takes a snapshot of the page.
3. Something sends the click on to the page.
4. Half a second later, Playwright reports "click on Add to cart".

All four go through Playwright, and Playwright is the thing that varies: its private calls differ by version, the browser may be launched or attached, and in a fast test there is no browser at all.

So the engine has **one port**, called `RecordedBrowser`. It speaks in the engine's words ("an input is held", "take a snapshot", "pass the input on", "Playwright reported an Interaction"), never in Playwright's. Two adapters sit behind it:

- the **stock Playwright adapter**, which holds every private Playwright detail;
- the **scripted adapter**, where a test plays the browser by hand.

Everything else in the package has no seam: the rules are plain functions, the disk is the real disk, the window server is the real server. Time is not a port of ours either: Effect's own clock already has a real and a test version.

Result: the engine is one loop that reads one queue and talks to one port.

```
 CLI ──────────────┐
 window ─ tRPC/ws ─┼─▶ front door ─▶ inbox ─▶ the loop ─▶ timeline rules (pure)
 toolbar in page ──┘                  ▲          │
                                      │          ▼
                           signals ───┴── RecordedBrowser (the one port)
                                             ├─ stock Playwright adapter
                                             └─ scripted adapter (tests)
```

---

## 1. The interface

### Entry point

```ts
// @ayme-dev/recorder
export function startRecorder(options: RecorderOptions): Promise<Recorder>;

type RecorderOptions = {
  /** The user's project. Playwright is resolved from here; `.ayme/recordings` is written here. */
  projectDir: string;
  browser:
    | { launch: { url: string; headless?: boolean; debugPort?: number } }
    | { attach: { cdpAddress: string; url?: string } };
  /** Folder with the built window page. `false`: no window is served. */
  window: { assetsDir: string; port?: number } | false;
};

interface Recorder {
  /** Local address of the recorder window, or null. */
  readonly windowUrl: string | null;
  /** Record, Stop, Continue, Clear, Finish, Assert visibility, discard, restore. */
  send(command: Command): Promise<CommandResult>;
  /** Calls the listener at once with the full state, then with every change. Returns "unsubscribe". */
  subscribe(listener: (update: RecorderUpdate) => void): () => void;
  /** The outside end (terminal stop). Safe to call many times; every call gets the same answer. */
  end(): Promise<Outcome>;
  /** Settles when the recorder has ended, whoever ended it. */
  readonly done: Promise<Outcome>;
}
```

### The contract (plain data, zod schemas, shared with the window)

```ts
// @ayme-dev/recorder/contract   (no Node, no Effect, no Playwright)
type Command =
  | { type: "record" } | { type: "stop" } | { type: "continue" }
  | { type: "clear" } | { type: "finish" } | { type: "assertVisibility" }
  | { type: "discard"; entryId: string } | { type: "restore"; entryId: string };

type CommandResult =
  | { accepted: true }
  | { accepted: false; reason: "does-not-apply-now" };   // never an error, never queued

type RecorderState =
  | { phase: "notRecording" }
  | { phase: "recording"; mode: "listening" | "pickingElement" }
  | { phase: "wrappingUp"; then: "pause" | "save" | "clear" }
  | { phase: "paused" }
  | { phase: "saving" }
  | { phase: "ended"; outcome: Outcome };

type Outcome =
  | { kind: "saved"; recordingId: string; dir: string; trace: "kept" | "lost" }
  | { kind: "empty" };                                   // Record never pressed, or all cleared

type RecorderUpdate =                                     // every update carries one shared counter
  | { type: "everything"; revision: number; state: RecorderState; entries: TimelineEntry[] }
  | { type: "state"; revision: number; state: RecorderState }
  | { type: "entry"; revision: number; entry: TimelineEntry }      // add or replace by id
  | { type: "entryRemoved"; revision: number; entryId: string }
  | { type: "cleared"; revision: number };

type TimelineEntry = {
  id: string; order: number; visit: { id: string; url: string };
  kind: "interaction" | "assertion" | "changeWithoutInteraction";
  interaction?: { action: string; value?: string; selector: string;
                  targetRef: string | null; targetIs: "exact" | "nearestAncestor" };
  changeTree?: string;            // absent for an assertion and for an Interaction that left the page
  discarded: boolean;
};
```

### What else a caller must know

**Order of calls.** There is none to learn. `startRecorder` gives a recorder that is "not recording". Any command may be sent at any time; one that does not apply now comes back `accepted: false` and changes nothing. Pressing Finish twice saves once.

**What can fail, and how you hear of it.**

| When | How it is reported |
|---|---|
| Playwright is not installed in `projectDir`, is older than 1.62, or lacks a private member the adapter needs | `startRecorder` rejects with `RecorderStartError`, a plain `Error` with `reason: "playwright-not-found" \| "playwright-too-old" \| "playwright-changed"` and the version and member name |
| The browser cannot be launched or attached; the window port is taken | `startRecorder` rejects, `reason: "browser-unavailable" \| "port-in-use"` |
| The browser disappears while recording | Not an error. It counts as an outside end: `done` resolves `saved` (with `trace: "lost"` if the trace could not be kept) or `empty` |
| The package cannot be written | `done` and `end()` reject with `RecorderSaveError` |
| A report from Playwright never comes | Not an error. Wrapping up waits up to a time limit, then goes on; the entry is missing and a warning is logged |

No Effect type, error or name crosses this interface.

**What is guaranteed.**

- A subscriber always gets `everything` first. A window that reloads subscribes again and has recovered.
- `revision` only grows. A receiver drops any update whose revision is not above the last one it applied. The toolbar gets the same states with the same counter, so toolbar and window end up equal.
- After `done` settles, the gate is off in every page, Playwright's recorder is off, and the browser is closed (launched) or left running and clean (attached).
- `end()` during a save joins that save. Nothing the caller can call kills a save in progress.
- A `saved` outcome is a complete folder: it is written under a temporary name and renamed at the end.

---

## 2. Usage

### All of `codegen <url>`

```ts
import { startRecorder } from "@ayme-dev/recorder";
import { assetsDir } from "@ayme-dev/recorder-window";

export async function codegen(url: string, options: { attach?: string }): Promise<number> {
  const recorder = await startRecorder({
    projectDir: process.cwd(),
    browser: options.attach
      ? { attach: { cdpAddress: options.attach, url } }
      : { launch: { url } },
    window: { assetsDir },
  });
  console.log(`Recorder window: ${recorder.windowUrl}`);

  let stopping = false;
  const onStop = () => {
    if (stopping) console.log("Saving, please wait.");
    stopping = true;
    void recorder.end();                      // a second Ctrl+C lands here again: harmless
  };
  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);

  const outcome = await recorder.done;        // Finish, last page closed, or the terminal
  console.log(outcome.kind === "saved" ? `Saved ${outcome.dir}` : "Nothing was recorded.");
  return 0;
}
```

The command-line package owns the signals and the exit code. The engine owns everything else.

### The window: live entries in, a command out

The engine serves the page and a tRPC router with two procedures on one WebSocket.

```ts
// packages/recorder-window (React). It imports types only.
import type { WindowRouter } from "@ayme-dev/recorder/contract";

const client = createTRPCClient<WindowRouter>({ links: [wsLink({ client: createWSClient({ url }) })] });

client.updates.subscribe(undefined, {
  onData: (update) => store.apply(update),   // "everything" resets; others apply if revision is newer
});

await client.send.mutate({ type: "stop" });  // -> { accepted: true }
```

On reconnect tRPC subscribes again, the first message is `everything`, and the store is whole again. The window keeps no state the engine does not also hold.

---

## 3. What the interface hides

- Which Playwright is in use, how it is found in the user's project, and every private detail of it.
- The gate: the page script, how a held input is re-sent, how the script recognises its own re-sent input.
- The whole lifecycle: wrapping up, the time limit, what a second Stop does, what happens when a page closes under a held click.
- Which snapshot becomes whose "before" and "after"; Visits; element identity across snapshots (core's observation session); Change Trees.
- Tracing: start at first Record, through pauses, kept at Finish, thrown away at Clear; the marks around each snapshot and the position numbers the stock trace tool accepts.
- The Recording Package: its text format, folder layout, temporary folder and rename.
- The toolbar inside the recorded page, the highlight for Assert visibility, the removal of `data-pw-cursor`.
- The HTTP server, the WebSocket, tRPC.
- Effect: the runtime, fibers, queues, scopes.

---

## 4. Seams and adapters

The rule applied: a seam needs two real things behind it. Here is every candidate, and the verdict.

| Candidate | What varies across it | Verdict |
|---|---|---|
| **The recorded browser** | Stock Playwright (any supported version, launched or attached) versus no browser at all | **Port: `RecordedBrowser`.** Adapters: stock Playwright, scripted |
| Playwright version | `_enableRecorder` (to 1.63) versus `_startRecording` (from 1.64); report wrapped or bare; trace snapshot naming | **Internal seam inside the Playwright adapter**: one table per version range ("dialect"). Two dialects today. Never visible to the engine |
| Launch versus attach | How the browser is obtained, which pages already exist, what "let go" means (close it, or clean up and leave it) | **Internal seam inside the Playwright adapter**: two ways to open, one shared rest. Never visible to the engine |
| Time | Real time versus test time | **No port of ours.** Effect's `Clock` is the seam; `TestClock` is its second adapter |
| Disk | Nothing. Tests write to a temporary folder | **No port.** See the note below |
| Window channel | Nothing. One server, real in every test that needs it | **No port.** The server is a caller of the engine, not something the engine depends on |
| Terminal signals | Belongs to the command-line program | **Not in the engine.** The engine offers `end()` |
| Core's observation session, Change Tree rendering | Pure, in-process | **No seam.** Called directly |

### The port

```ts
// recording/application/RecordedBrowser.ts
class RecordedBrowser extends Context.Service<RecordedBrowser, {
  /** Everything the browser tells us, in the order it happened. */
  readonly signals: Queue.Dequeue<BrowserSignal>;

  /** The public snapshot of one page, plus where it sits in the trace. */
  readonly snapshot: (page: PageId) => Effect.Effect<PageSnapshot, PageGone>;
  /** Pass a held input on to its page. */
  readonly release: (held: HeldInput) => Effect.Effect<void, PageGone>;
  /** Ends when the page has been quiet for the quiet window, or the page's own limit passed. */
  readonly quiet: (page: PageId) => Effect.Effect<void, PageGone>;

  /** Ask every page, present and future, to switch the gate. The answer comes back as a signal. */
  readonly setGate: (gate: "on" | "off") => Effect.Effect<void>;
  /** Playwright's own recorder: off, recording, or picking an element. */
  readonly setPlaywrightRecorder: (mode: "off" | "recording" | "picking") => Effect.Effect<void>;
  /** Show this state on the toolbar of every page. */
  readonly showState: (state: RecorderState, revision: number) => Effect.Effect<void>;

  readonly startTrace: Effect.Effect<void>;
  /** Stop tracing. Keep the file and return a position per snapshot, or throw it away. */
  readonly stopTrace: (keep: { file: string } | "discard") => Effect.Effect<TracePositions>;
}>()("@ayme-dev/recorder/RecordedBrowser") {}

type BrowserSignal =
  | { kind: "pageOpened"; page: PageId; url: string; at: number }
  | { kind: "navigated"; page: PageId; url: string; at: number }
  | { kind: "pageClosed"; page: PageId; pagesLeft: number; at: number }
  | { kind: "inputHeld"; held: HeldInput; at: number }          // click, key press, or typing behind one
  | { kind: "gateConfirmed"; gate: "on" | "off" }               // every live page has switched
  | { kind: "reported"; report: InteractionReport; at: number } // Playwright's report, new or updated
  | { kind: "pickingEnded" }                                    // Playwright left picking mode
  | { kind: "command"; command: Command }                       // from the toolbar
  | { kind: "browserGone" };

type HeldInput = { id: string; page: PageId; needsBefore: boolean };
type PageSnapshot = { text: string; at: number; mark: TraceMark };
type InteractionReport = {
  reportId: string; page: PageId; action: string; selector: string; value?: string;
  snapshotAtEvent?: string;                // same shape as the public snapshot, checked per version
  targetPath: readonly (string | null)[];  // refs from the target up to the root, for "nearest ancestor"
};
```

Three choices in this port matter more than the rest.

1. **Engine words, not Playwright words.** There is no `evaluate`, no `exposeBinding`, no `locator`. A lower port would make the fake simulate a page; this one lets a test say "a click is held on page 1".
2. **One ordered queue in.** Held inputs, reports, navigations, toolbar commands and the gate's confirmation all arrive on `signals`. The gate's "I am off" comes on the same queue as its "I hold a click", so when the engine reads "off" it has already read every held input. That one fact carries rule 1 of the lifecycle model.
3. **Timestamps come with the signal.** `at` is on Playwright's clock, so the package and the trace agree. The engine never reads a clock for a timestamp.

### What the stock Playwright adapter owns

All of it private to `playwright/infrastructure`:

- Finding Playwright from `projectDir`, reading its version, picking the dialect, failing early with a clear reason.
- The dialect table: start and stop of Playwright's recorder, the shape of a report, the recorder's mode switch (`recorderSymbol`, `setMode`, `modeChanged`), `_ariaRef` for `targetPath`, the page id used by the trace, trace snapshot naming.
- Open by launch or by attach. Element refs stay on this one connection.
- The gate's page script and its host side: swallow, notify, re-send through `page.mouse` and `page.keyboard`, hold later typing while something is held, start a new page with the gate matching the current state, drop a held input whose page is gone.
- `quiet`: the settle wait inside the page.
- The trace: a mark around every snapshot, and after `stopTrace` one run of the project's own `playwright trace` to turn marks into position numbers.
- The toolbar and the highlight scripts, hiding Playwright's overlay, removing `data-pw-cursor`.

The page scripts are plain JavaScript without Effect.

### The scripted adapter

A test holds a small remote control:

```ts
browser.open("p1", "https://shop.test/");
browser.setTree("p1", cartEmpty);              // what snapshot() returns from now on
const click = browser.hold("p1");              // -> signal "inputHeld"
browser.onRelease(click, () => browser.setTree("p1", cartWithOne));
browser.report("p1", { action: "click", selector: "…" });
browser.quiet("p1");
browser.calls;   // ["setGate on", "snapshot p1", "release h1", …]  for "exactly once" checks
```

It answers `setGate` with `gateConfirmed` by itself unless the test says to delay it.

### One suite keeps both adapters honest

`recordedBrowserContract(openAdapter)` is a list of checks written against the port alone. For example: a held click reaches the page exactly once after `release`; `gateConfirmed off` never comes before a held input the page already swallowed; a new page starts with the gate in the current state; `snapshotAtEvent` has the same shape as `snapshot()` for the same frame; the positions from `stopTrace` open in the stock trace tool. It runs against the Playwright adapter **once per supported Playwright version**, in both launch and attach. That is the required test for the private details. The checks that make sense without a page also run against the scripted adapter.

### Note on the disk

The loop must write the package, and this repository's layer rule says a flow may not import code that touches the outside. So the flow is handed one function, `writePackage(dir, package)`. This is a seam with one thing behind it. It exists because of the lint rule, not because anything varies. It gets no interface of its own, no fake, and no name in the design beyond that function. Tests use a temporary folder.

---

## 5. Slices and layers

Seven slices, bottom up. A slice may import only slices listed before it, and layers keep their usual order (domain uses domain; application uses application and domain; infrastructure uses any). Each layer that others use has its own front door, as ADR-0046 "The layer order holds across slices, through one front door per layer" (`docs/adr/0046-*.md` in the repository) describes.

| Slice | Layers | Owns |
|---|---|---|
| `contract` | none | The plain-data schemas shared with the window and the toolbar: commands, states, updates, timeline entries, outcome, and the type of the window router |
| `timeline` | domain | The pure rules. Facts in (Visit started, snapshot taken, Playwright reported, page closed), timeline entries out. Which snapshot is whose "before" and "after"; a newer snapshot closes the previous Interaction; an Interaction that leaves the page and an assertion carry no changes; nearest present ancestor; discard flags; the package as data and as the released text. Wraps core's observation session |
| `recording` | domain, application | Domain: which command applies in which state, and what wrapping up still waits for. Application: the loop, wrapping up, the `RecordedBrowser` port, the live updates with their counter |
| `playwright` | infrastructure | The stock Playwright adapter and its page scripts |
| `window-server` | infrastructure | Plain `http` and `ws`, the tRPC router (`updates`, `send`), the window's files |
| `engine` | none | The composition root and the front door: builds the runtime, picks the adapter, turns Effect into promises and errors into plain errors, writes the package folder |
| `testing` | none | The `./testing` entry: the scripted adapter, `startScriptedRecorder`, the port's contract suite |

`playwright` and `window-server` never import each other. Only `engine` and `testing` know more than one of them.

Where Effect is: `recording/application`, `playwright`, `window-server` (only for start and stop), `engine`, `testing`. Where it is not: `contract`, `timeline`, `recording/domain`, the page scripts.

---

## 6. The two hard parts

Names below were checked against the installed `effect` 4.1.4 type definitions: `Effect.gen`, `Effect.fn`, `Effect.forever`, `Effect.forkScoped`, `Effect.uninterruptible`, `Effect.uninterruptibleMask`, `Effect.timeoutOption`, `Effect.andThen`, `Effect.ignore`, `Effect.acquireRelease`, `Effect.tryPromise`, `Queue.unbounded`, `Queue.take`, `Queue.offer`, `Queue.offerUnsafe`, `Stream.fromQueue`, `Stream.runForEach`, `FiberMap.make`, `FiberMap.run`, `FiberMap.remove`, `Deferred.make`, `Deferred.succeed`, `Deferred.await`, `Context.Service`, `Layer.effect`, `Layer.succeed`, `ManagedRuntime.make`, `Option.isNone`, and `TestClock.layer`, `TestClock.adjust` from `effect/testing`. I checked that each exists; exact argument order still needs checking when the code is written.

### Strict order of clicks, typing and reports

Order is kept in three places, each simple.

1. **In the page.** While one input is held, the gate holds everything after it, typing included.
2. **On the way in.** The adapter puts every signal on one queue, in the order Playwright's connection delivered it.
3. **In the engine.** One loop takes one event at a time and finishes with it before it takes the next. Commands from the window and the command line go into the same inbox.

```ts
const loop = Effect.gen(function* () {
  const browser = yield* RecordedBrowser;
  const inbox = yield* Queue.unbounded<EngineEvent>();   // signals + commands + our own timers
  const quietWaits = yield* FiberMap.make<PageId>();     // at most one "wait for quiet" per page

  // browser signals join the inbox in the adapter's order
  yield* Stream.fromQueue(browser.signals).pipe(
    Stream.runForEach((signal) => Queue.offer(inbox, signal)),
    Effect.forkScoped,
  );

  // waiting for the next event may be interrupted; handling one event may not
  const next = Effect.uninterruptibleMask((restore) =>
    restore(Queue.take(inbox)).pipe(Effect.andThen(handle)),
  );
  yield* Effect.forever(next);
});
```

A held click, as `handle` sees it:

```ts
// { kind: "inputHeld", held }
if (held.needsBefore) {
  const before = yield* browser.snapshot(held.page);     // also closes the previous Interaction
  timeline.snapshotTaken(held.page, before, { beforeOf: held.id });
}
yield* browser.release(held);                            // PageGone: the click is dropped
owedReports.add(held.id);
yield* FiberMap.run(quietWaits, held.page,               // replaces an older wait for this page
  browser.quiet(held.page).pipe(
    Effect.andThen(Queue.offer(inbox, { kind: "pageQuiet", page: held.page, after: held.id })),
    Effect.ignore,
  ));
```

Short waits (a snapshot, a release) happen inside the handler, so nothing overtakes them. Long waits (the page going quiet, a time limit) are started on the side and **come back as an event** in the same inbox, with a note of what they were for. A late one whose Interaction a newer snapshot has already closed is ignored. So is anything left over from before a Clear: each Clear raises a generation number that every such event carries.

Later events in the same handler style: `pageQuiet` takes the "after" snapshot; `reported` crosses the Interaction off `owedReports`, hands the report to the timeline, and publishes the entry; a typing report carries its own "before" (`snapshotAtEvent`), which also closes the Interaction before it. Assert visibility is accepted by the loop only when it is its turn, so no click is held at that moment.

### Wrapping up

Stop, Finish, Clear and the outside end all run the same step with a different ending.

```ts
const wrapUp = Effect.fn("wrapUp")(function* (then: "pause" | "save" | "clear") {
  ending = then;
  yield* publishState({ phase: "wrappingUp", then });

  yield* browser.setGate("off");
  // keep handling events until: the gate confirmed off, nothing held, no report owed
  const finished = yield* handleEventsUntil(
    () => gateConfirmedOff && owedReports.size === 0,
  ).pipe(Effect.timeoutOption(REPORT_TIME_LIMIT));
  if (Option.isNone(finished)) yield* warnAboutMissingReports;

  yield* browser.setPlaywrightRecorder("off");           // only after the reports are in
  yield* takeClosingSnapshots;                           // the change after the last Interaction

  if (ending === "pause") return yield* publishState({ phase: "paused" });
  if (ending === "clear") return yield* clearEverything; // also stopTrace("discard")
  return yield* Effect.uninterruptible(save);            // stopTrace({ file }), writePackage, "ended"
});
```

- `handleEventsUntil` is the same `next` as the main loop, run until the condition holds. Held clicks that arrive during wrapping up are therefore snapshotted and passed on like any other.
- "Nothing held" needs no counter: the gate's confirmation travels behind every held input on the same queue.
- The time limit can cut the wait, but never a handler: a click is never left between its "before" and its release.
- While wrapping up, Stop, Finish and Clear come back `accepted: false`. An outside end only changes `ending` (pause becomes save; clear stays clear and then ends). That is why `ending` is read again after the wait.
- `end()` is `Deferred.await(ended)`. Calling it twice awaits the same thing. The save is uninterruptible, and the runtime is disposed only after `ended` is set.
- A new page during any state starts with the gate matching the state: the adapter remembers the last `setGate`.

The time limit and the quiet wait use Effect's clock on the Node side, so a test moves them with `TestClock.adjust`.

---

## 7. How the three kinds of test reach the design

**1. Input in, package out.** In the fixture app, once per supported Playwright version: `startRecorder` with a `projectDir` that has that version installed, on a fixture page. The test gives real input over its own connection to the same browser (it attaches the recorder to a browser it started, or uses `launch.debugPort`), sends `{ type: "finish" }`, awaits `done`, and reads `.ayme/recordings/<id>` from disk. The port's contract suite runs in the same matrix.

**2. The window, through its page objects.** `startScriptedRecorder({ window: { assetsDir } })` starts the real engine, the real server and the real tRPC channel, with the scripted adapter in place of a recorded browser. Playwright opens `windowUrl`; the window's page objects press Stop; the test plays a click through the remote control and sees the entry appear; it reloads the window and sees the same timeline. No second browser, no fake server.

**3. Snapshots in, timeline out, no browser.** Two levels, both fast.

- The `timeline` slice directly: feed facts and snapshot texts, read entries. No Effect, no clock, no adapter. Most rules about "before", "after", Visits and Change Trees are tested here.
- `startScriptedRecorder` with the test clock, for order and lifecycle: each of the ten rules and three checks of the lifecycle model becomes a short script. Example, rule 4: hold a click, send Finish, release happens, the report comes 500 ms of test time later, the saved package contains the click.

---

## 8. Trade-offs

**Where it gives a lot per thing learned.**

- One port to learn, and behind it sits everything that changes when Playwright changes. A new Playwright version means a new row in the dialect table and a run of the contract suite. Nothing outside `playwright/` moves.
- The scripted adapter pays three times: lifecycle tests, timeline order tests, and window tests.
- The front door is five members. The window and the toolbar use the same commands and the same updates, so "they must agree" has one source.
- Launch versus attach never reaches the engine's flows.

**Where it is thin or awkward. This is the cost of the constraint.**

- **The hardest code lands behind the port, where only slow tests reach it.** The gate script, re-sending input, holding typing behind a held click, starting a new page with the right gate state: all of it is adapter. The fast tests prove the engine's ordering, given a browser that behaves. They prove nothing about the gate. The Playwright adapter may be half the package.
- **The port is wide.** Nine members and nine kinds of signal. The scripted adapter must copy ordering promises of the real one (for example, "confirmed off" after every held input). If the fake drifts, fast tests pass on a lie. The shared contract suite limits that, at the price of maintaining it.
- **A lower port was possible and rejected**: one shaped like Playwright (`evaluate`, bindings, mouse). It would put the gate's host side under fast tests, but the fake would have to imitate a page, and private Playwright details would leak into the flows.
- **The page's quiet time is not test time.** The settle wait runs inside the page. Test time moves only the Node-side limits. With the scripted adapter, "quiet" is something the test says.
- **`writePackage` is a one-adapter seam** that the layer rule forces. Honest name for it: indirection.
- **`launch.debugPort` exists for tests only.** Without it a test cannot give real input to a launched browser.
- **The constraint says little about the inside of the loop.** Ports and adapters decide where the outside world enters. They do not stop `handle` from growing into one long switch. That is held in check only by keeping the rules in `timeline` and `recording/domain` and keeping `handle` to "ask the rule, call the port".
- **The engine does not know the window package.** The caller passes `assetsDir`. That keeps the packages apart, but every caller must pass it.

**Open points this design leans on.**

- Playwright's reports arriving in the order things were done (assumption 15 of the lifecycle model). The contract suite should check it per version.
- The quiet window: the lifecycle model and the prototype say 150 ms; core's `waitForSettled` says 250 ms. The adapter owns the number; someone must pick one.
- Hover highlight from the window (in the window trial) is not among the listed commands and is not designed here.
