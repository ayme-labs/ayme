# Recorder engine, design 1: the smallest interface

Constraint: minimise the interface. The whole engine has **three entry points**. A caller learns two verbs (`watch`, `send`) and three shapes of plain data.

## The idea, by example

A person runs `codegen https://shop.test`. The command-line program does this:

```ts
const recorder = await startRecorder({ target: { launch: url }, cwd, signal });
console.log(`Recorder window: ${recorder.address}`);
const outcome = await recorder.ended;
```

That is everything the program knows about the engine. It cannot press Record, read an entry or see a snapshot. Whoever wants to do those things, the window or a test, opens the address and uses the same two verbs:

```ts
const connection = connectRecorder(recorder.address);
connection.watch((view) => render(view));   // the whole current state, every time it changes
await connection.send({ type: "record" });
```

So the engine has one door for starting and one door for everything that happens after. There is no second way in for tests, and no in-process shortcut for the command-line program.

## 1. The interface

### Entry points

| # | Entry | Where | For |
|---|---|---|---|
| 1 | `startRecorder(options)` | `@ayme-dev/recorder` (Node) | start one Recorder, wait for its end |
| 2 | `connectRecorder(address)` | `@ayme-dev/recorder/contract` (browser and Node, plain data only) | see the state, send commands |
| 3 | `runTraceTool(options)` | `@ayme-dev/recorder` (Node) | the `trace` command |

```ts
// ── 1 ──────────────────────────────────────────────────────────────
function startRecorder(options: {
  /** Launch a browser on a URL, or attach to a running one by its CDP address. */
  target: { launch: string; headless?: boolean } | { attach: string };
  /** The user's project folder. Playwright is resolved from here; the package is written under it. */
  cwd: string;
  /** The outside end ("stop from the terminal"). Aborting twice is the same as aborting once. */
  signal?: AbortSignal;
  /** Folder with the built window. Left out: the address serves the channel only. */
  windowDir?: string;
}): Promise<{
  /** Local address of the window and of the channel, e.g. http://127.0.0.1:41873 */
  address: string;
  /** Resolves once, when the Recorder has ended and everything is closed. Never rejects. */
  ended: Promise<RecordingOutcome>;
}>;

// ── 2 ──────────────────────────────────────────────────────────────
function connectRecorder(address: string): {
  /** Calls back at once with the full view, then again after every change. Returns "stop watching". */
  watch(listener: (view: RecorderView) => void): () => void;
  /** Resolves when the engine has taken the command or ignored it. */
  send(command: RecorderCommand): Promise<"applied" | "ignored">;
  close(): void;
};

// ── 3 ──────────────────────────────────────────────────────────────
/** Runs the user's own `playwright trace` tool on a recording's trace file. Resolves with its exit code. */
function runTraceTool(options: {
  cwd: string;
  recordingId?: string;          // left out: the latest recording
  args: readonly string[];       // passed on unchanged
}): Promise<number>;
```

### The three shapes of data

```ts
type RecorderCommand =
  | { type: "record" } | { type: "stop" } | { type: "continue" }
  | { type: "clear" }  | { type: "finish" }
  | { type: "assertVisibility" }
  | { type: "discard"; entryId: string }
  | { type: "restore"; entryId: string };

type RecorderView = {
  revision: number;                       // grows with every change
  phase: "notStarted" | "recording" | "pickingElement"
       | "wrappingUp" | "paused" | "saving" | "ended";
  /** Which commands would be applied right now. Buttons are drawn from this, not from `phase`. */
  can: Record<RecorderCommand["type"], boolean>;
  visits: { id: string; url: string }[];
  entries: TimelineEntry[];               // in order
  outcome: RecordingOutcome | null;       // set when phase is "ended"
};

type TimelineEntry = {
  id: string;
  visitId: string;
  kind: "interaction" | "assertion" | "change";   // "change": something changed with no interaction to credit
  discarded: boolean;
  settled: boolean;                       // false while the entry still waits for its "after"
  interaction?: {
    action: string; value?: string; selector: string;
    targetRef: string | null;
    targetIsNearestAncestor: boolean;     // the real target was missing from the snapshot
  };
  changedBefore: ChangeTreeNode[] | null; // Change Tree, as plain nested data
  changedBy: ChangeTreeNode[] | null;     // null for an assertion, and for an interaction that left the page
};

type RecordingOutcome =
  | { kind: "saved"; recordingId: string; packagePath: string; tracePath: string | null; warnings: string[] }
  | { kind: "empty" }                                   // Record was never pressed, or everything was cleared
  | { kind: "failed"; message: string };                // the package could not be written
```

All three are zod schemas in the contract entry. Both sides check them.

### What else a caller must know

**Order of calls.** `startRecorder` first. After it resolves, `connectRecorder(address)` may be called any number of times, from anywhere, at any moment, also after a reload. There is no other ordering rule. Commands have no required order either: one that does not apply now is answered `"ignored"` and changes nothing. It is never queued and never acts as a toggle.

**What can fail, and how it is reported.**

- Starting can fail: Playwright not found from `cwd`, a Playwright older than 1.62, a private Playwright detail missing on this version, the browser not launching, the CDP address not answering. `startRecorder` rejects with a `RecorderStartError` that has a `reason` code and a sentence for the terminal. Nothing is left running.
- After a successful start nothing rejects. `ended` always resolves. A lost trace is a `warnings` line on a `saved` outcome with `tracePath: null`. A disk error is `failed`.
- `send` rejects only when the connection is gone. A bad command is a type error for TypeScript callers and a rejected message on the wire.
- `watch` never fails. If the channel drops, `connectRecorder` reconnects and the listener gets the full view again. If the Recorder has ended, the listener keeps the last view (phase `ended`, with the outcome).

**What is guaranteed.**

- The first view after connecting is complete. A listener never needs history.
- A listener never sees an older view after a newer one (`revision` only grows).
- The toolbar inside the recorded page and every window show the same `phase` and `can`, because both are drawn from the same view.
- A click or key press the person made reaches the page exactly once, in the order it was made, unless its page is gone.
- Finish saves everything done up to that moment. Pressing it twice saves once.
- Clear leaves no entry and no discard decision behind.
- `discard` and `restore` are applied only while `phase` is `paused`.
- An outside end gives a complete package or `empty`. Aborting `signal` a second time does not cut a save short.
- When `ended` resolves, the channel is closed, the gate is off in every page, Playwright's own recorder is off, a launched browser is closed, and an attached browser is left running and untouched.
- A caller sees promises, callbacks and plain data only. No Effect type appears in any of the three entries.

**How long things take.** `stop`, `finish` and `clear` are answered `"applied"` at once, but the view stays in `wrappingUp` for about half a second after a click (Playwright reports late), with a limit of two seconds. A gated click is held for one snapshot: 13 to 16 ms on a small page, about 280 ms on a page with 12,000 elements.

## 2. Usage

### The whole of `codegen <url>`

```ts
// packages/<cli>/src/codegen.ts
import { startRecorder } from "@ayme-dev/recorder";

export async function codegen(url: string, flags: { attach?: string }): Promise<number> {
  const stop = new AbortController();
  process.on("SIGINT", () => {
    if (stop.signal.aborted) console.error("Saving, please wait.");
    stop.abort();
  });

  let recorder;
  try {
    recorder = await startRecorder({
      target: flags.attach ? { attach: flags.attach } : { launch: url },
      cwd: process.cwd(),
      signal: stop.signal,
      windowDir: WINDOW_DIR,            // the built window, copied into the cli package
    });
  } catch (error) {
    console.error(error.message);       // RecorderStartError: already a sentence for the terminal
    return 1;
  }

  console.log(`Recorder window: ${recorder.address}`);
  const outcome = await recorder.ended;

  if (outcome.kind === "saved") console.log(`Saved ${outcome.packagePath}`);
  if (outcome.kind === "empty") console.log("Nothing was recorded.");
  if (outcome.kind === "failed") console.error(outcome.message);
  outcome.kind === "saved" && outcome.warnings.forEach((line) => console.warn(line));
  return outcome.kind === "failed" ? 1 : 0;
}
```

`trace` is one call to `runTraceTool`. `install` does not touch the engine (assumption: it installs the consumer skill; if it must install a browser, it runs the user's own `playwright install`, which is a fourth small function in the Playwright adapter, not a new idea).

### The window: live entries and a command

```tsx
// packages/recorder-window/src/...
import { connectRecorder, type RecorderView } from "@ayme-dev/recorder/contract";

const connection = connectRecorder(location.origin);

function App() {
  const [view, setView] = useState<RecorderView | null>(null);
  useEffect(() => connection.watch(setView), []);
  if (!view) return null;
  return (
    <>
      <button disabled={!view.can.record} onClick={() => connection.send({ type: "record" })}>Record</button>
      <button disabled={!view.can.finish} onClick={() => connection.send({ type: "finish" })}>Finish</button>
      {view.entries.map((entry) => <Entry key={entry.id} entry={entry} canReview={view.can.discard} />)}
    </>
  );
}
```

A new entry is a new view with one more item in `entries`. An entry that gets its "after" is a new view where that entry has `settled: true` and its Change Trees. A reload is a new `connectRecorder` call; the first view is complete.

## 3. What the interface hides

Behind those three entries, a caller never learns about:

- **Playwright.** Finding the user's install from `cwd`, checking the version, launching or attaching, the two names of the private "start recorder" call, switching Playwright's recorder off when not recording, its picking mode, the shape of its reports, the check that a report's snapshot has the same shape as the public one, removing `data-pw-cursor`, hiding `x-pw-glass`.
- **The gate.** The page script that swallows the final click or key press, recognises its own re-sent input, holds typing while an input is held, starts in the right state on a new page, and confirms when it is off.
- **Ordering.** One inbox for everything that happens, handled one at a time.
- **Wrapping up.** The step between Stop, Finish, Clear or an outside end and the state the person asked for, with its time limit.
- **Snapshots and Visits.** When a snapshot is taken, which snapshot serves as whose "before" and "after", the first snapshot of a Visit, element identity across snapshots (core's observation session), the nearest-ancestor rule.
- **Tracing.** Start at the first Record, run through pauses, keep at Finish, throw away at Clear, the marker around each snapshot, and asking the stock trace tool for position numbers.
- **The Recording Package.** Its format, `.ayme/recordings/<id>`, `latest.yaml`, writing to a temporary folder and renaming.
- **The toolbar in the page.** It is drawn by the engine and fed the same view. Callers never talk to it.
- **The wire.** tRPC, the WebSocket, reconnecting, sending only entries that changed, dropping an older message. `connectRecorder` turns all of it back into "here is the whole view".
- **Effect.**

`can` is the piece that hides most per field. The lifecycle chart has eleven boxes; without `can`, the window and the toolbar would each carry a copy of it.

## 4. Seams and adapters

There are two seams. Both are inside the engine. Neither is in the caller's interface.

| Seam | What crosses it | Adapters | Real or for tests |
|---|---|---|---|
| **The connection** (`watch` + `send`) | views out, commands in | (a) the in-process recorder; (b) `connectRecorder`, the same shape over the channel; (c) the toolbar bridge consumes (a) like the channel server does | **Real.** Two production adapters of one shape. It is what lets the window and the toolbar agree: both read one source. |
| **The browser** (`RecordedBrowser`) | what the flows ask of Playwright: take a snapshot, pass a held input on, wait for the page to settle, switch gate / recorder / picking mode, start and stop tracing, show the view in the pages; and what comes back: held inputs, reports, pages opening, navigating and closing, gate confirmations, toolbar commands | (a) stock Playwright; (b) a scripted browser | **For tests only.** One production adapter. The second exists because wrap-up time limits and input races cannot be produced on demand in a real browser. Playwright is a third party we do not control, which is the case where a test adapter is justified. |

Things that are deliberately **not** seams:

- **Launch or attach.** One branch inside the Playwright adapter (how the context is obtained, and whether the browser is closed at the end). Nothing else varies.
- **Playwright 1.62–1.63 or 1.64+.** One `if` inside the same adapter. A per-version test covers it.
- **The package store.** Plain file system under `cwd`; tests use a temporary folder. No port.
- **Core's observation session.** In-process and pure. Used directly.
- **The clock.** Effect's own; tests swap it with Effect's `TestClock`. No port of ours.

## 5. Slices and layers

Five slices, bottom up. A slice has layers only where it has that kind of code.

| Slice | Layers | Owns |
|---|---|---|
| `contract` | none | The three data shapes as zod schemas, the wire messages, folding wire messages into a view (an older revision never replaces a newer one), and `connectRecorder`. Browser-safe. It is the `./contract` entry. |
| `recording` | `domain`, `infrastructure` | What a recording *is*. `domain`: snapshots in, timeline out. Visits, entries, "changed before" and "changed by", a newer snapshot closes the previous interaction, an assertion carries no changes, leaving the page carries no changes, the nearest-ancestor mark, discard flags, and rendering the Recording Package text. Uses core's observation session. `infrastructure`: writing the package under `.ayme/recordings/<id>`. |
| `session` | `domain`, `application` | What a live Recorder *does*. `domain`: the lifecycle as one pure function, `step(state, happening) → { state, todo[] }`, plus `can`. It mirrors the model-checked chart one to one. `application`: the Effect loop that feeds `step` and carries out its to-do list, the `RecordedBrowser` port, and the in-process `watch`/`send` recorder. |
| `playwright` | `infrastructure` | The one adapter of `RecordedBrowser` for stock Playwright, and every private Playwright detail. Also the page scripts (gate, toolbar, highlight; plain DOM code, no Effect) and running the stock trace tool. |
| `server` | none | The composition root. `startRecorder` and `runTraceTool`, the `http` + `ws` + tRPC channel server, serving the window's files, the runtime, turning Effect results into promises. |

Who may import whom (the layer order holds across slices, as in ADR-0046):

```
contract            ← everyone
recording/domain    ← session/domain, session/application, recording/infrastructure, playwright, server
session/domain      ← session/application, server
session/application ← playwright (to implement the port), server
recording/infrastructure, playwright ← server only
```

`recording` and `session/domain` import no Effect. `playwright` and `session/application` do. `contract` imports neither Effect nor Node.

Why not more slices. A `gate` slice would hold one page script and one rule that `session` already owns. A `tracing` or `package` slice would hold one function each. A `lifecycle` slice separate from sequencing would split one state machine in two, and the model shows they are one: wrap-up is defined by what is held and what is owed.

## 6. The two hard parts

Both are carried by the same small mechanism, so there is one thing to understand.

**Example first.** The person types "milk", presses Enter, and presses Finish before Playwright has reported the Enter. What must happen: Enter is held, "before" is taken, Enter is passed on, Finish is noted, the report for Enter comes in, "after" is taken, Playwright's recorder is switched off, the package is written. Six different sources produced those events. They must be handled in exactly that order.

### One inbox, one worker

Everything that happens becomes a `Happening` and goes into one queue. One fiber takes them one at a time. That is the whole ordering rule.

```ts
type Happening =
  | { _tag: "Command"; command: RecorderCommand; reply: Deferred.Deferred<"applied" | "ignored"> }
  | { _tag: "OutsideEnd" }                                   // signal, or the last page closed
  | { _tag: "InputHeld"; pageId; inputId; input }            // the gate swallowed a click or key press
  | { _tag: "InputLetThrough"; pageId; inputId }             // typing, select, upload: the gate saw it pass
  | { _tag: "Report"; pageId; action; snapshot }             // from Playwright's recorder
  | { _tag: "Picked"; pageId; action; snapshot }             // an assertion
  | { _tag: "PageOpened" | "PageNavigated" | "PageClosed"; pageId; url? }
  | { _tag: "GateConfirmed"; pageId; on: boolean }
  | { _tag: "Settled"; interactionId }                       // timer: quiet for 150 ms, or 2 s passed
  | { _tag: "WrapUpDeadline"; wrapUpId };                    // timer: stop waiting for reports

// session/application — checked Effect 4 names
const inbox = yield* Queue.unbounded<Happening>();

// adapters push from plain callbacks, in arrival order, without waiting:
Queue.offerUnsafe(inbox, { _tag: "Report", pageId, action, snapshot });

// the worker:
yield* Effect.forever(
  Effect.gen(function* () {
    const happening = yield* Queue.take(inbox);
    const { state, todo } = step(yield* Ref.get(stateRef), happening);   // pure, session/domain
    yield* Ref.set(stateRef, state);
    for (const item of todo) yield* carryOut(item);                      // browser calls, in order
    yield* SubscriptionRef.set(viewRef, viewOf(state));                  // revision + 1
  }),
).pipe(Effect.forkScoped);
```

`step` decides; `carryOut` does. A to-do item is plain data: `TakeBefore`, `PassOn`, `StartSettleTimer`, `CancelSettleTimer`, `TakeAfter`, `SetGate`, `SetPlaywrightRecorder`, `SetPicking`, `StartTracing`, `StopTracing(keep | discard)`, `StartWrapUpDeadline`, `SavePackage`, `Reply`, `End`.

How this gives each ordering rule:

- **A held click, then typing.** `InputHeld` produces `TakeBefore` then `PassOn`. The worker is busy with those two browser calls; the typing's `Report` sits in the queue behind it. In the page, the gate holds keystrokes while an input is held and re-sends them after it, so the page sees the same order.
- **A newer snapshot closes the previous interaction.** The worker never sleeps through a settle. `StartSettleTimer` forks a timer that later offers `Settled` into the same queue. If an `InputHeld`, `Report` or `Picked` with a snapshot arrives first, `step` closes the open interaction with that snapshot and adds `CancelSettleTimer`. The timer lives in a `FiberHandle` (`FiberHandle.run` replaces it, `FiberHandle.clear` cancels it). A stale `Settled` carries an old `interactionId` and `step` ignores it.
- **Assert visibility waits for a held click.** `step` answers the command `"applied"` but puts `SetPicking` after the pending `PassOn` in the to-do list.
- **A held click whose page is gone.** `PageClosed` makes `step` drop the held input. A `PassOn` already on the list fails inside `carryOut`; that failure is turned into a `PageClosed` happening, not an error.
- **Reports from before Record or after Clear.** Every report must match an `InputHeld` or `InputLetThrough` that `step` has counted as owed. An unmatched report is dropped. Playwright's recorder is also off whenever `phase` is not recording.

### Wrapping up

Wrapping up is not a separate flow that waits. It is a phase of the same `step` function, so nothing can slip in beside it.

```ts
// session/domain, pure
const wrapUpDone = (s: State) =>
  s.pages.every((page) => page.gateConfirmedOff) &&   // the page confirms the gate is off
  s.held.length === 0 &&                              // held clicks are passed on
  (s.owed.length === 0 || s.wrapUp.deadlinePassed);   // Playwright's reports are in, or time is up
```

- `stop`, `finish`, `clear` or `OutsideEnd` while recording: `step` sets `phase: "wrappingUp"` with what comes next (pause, save, clear, or clear-and-end), and adds `SetGate(off)` and `StartWrapUpDeadline`.
- While wrapping up, the worker keeps taking happenings as before. A held click still gets its "before" and is passed on. Reports still arrive and are recorded (after Clear they are counted and thrown away).
- After every happening `step` checks `wrapUpDone`. When it holds, the to-do list is: `SetPlaywrightRecorder(off)` (only now, so no report is lost), `TakeAfter` for the last open interaction, then `Reply`-and-pause, or `SavePackage`, or reset.
- The deadline is a timer that offers `WrapUpDeadline` into the queue: `Effect.sleep(Duration.millis(2000))` then `Queue.offer`, forked with `Effect.forkScoped`. It carries a `wrapUpId`, so a deadline from an earlier wrap-up is ignored.
- A second `finish` or `OutsideEnd` during wrap-up or saving only changes what comes next (pause becomes save, clear becomes clear-and-end) or is ignored. It never restarts or cancels anything.
- `SavePackage` runs inside `Effect.uninterruptible`. The runtime (`ManagedRuntime.make(layer)`) is disposed only after the outcome is published, and `ended` resolves after `dispose()`. The browser, the tracing and the server are each held with `Effect.acquireRelease`, so they close in reverse order whatever happened. That is why a second Ctrl+C cannot leave a half-written package.

Commands reach the worker the same way from every surface: the channel server and the toolbar bridge both put `{ _tag: "Command", command, reply }` in the inbox and wait on `Deferred.await(reply)`. `watch` is `Stream.runForEach(SubscriptionRef.changes(viewRef), listener)`: it starts with the current view, which is what makes a reload recover. The channel server keeps, per connection, the last revision it sent, and sends only the entries that changed since.

Names checked against the installed `effect@4.1.4` type definitions: `Queue.unbounded`, `Queue.take`, `Queue.offer`, `Queue.offerUnsafe`, `Ref.get`, `Ref.set`, `SubscriptionRef.make`, `SubscriptionRef.set`, `SubscriptionRef.changes`, `Stream.runForEach`, `Deferred.make`, `Deferred.succeed`, `Deferred.await`, `FiberHandle.make`, `FiberHandle.run`, `FiberHandle.clear`, `Effect.gen`, `Effect.forever`, `Effect.forkScoped`, `Effect.sleep`, `Effect.uninterruptible`, `Effect.acquireRelease`, `Effect.callback`, `Effect.tryPromise`, `Duration.millis`, `Context.Service`, `Layer.effect`, `ManagedRuntime.make` (with `runPromise` and `dispose`), and `TestClock` under `effect/testing`. Not present in this version and not used: `Effect.async`, `Effect.fork`, `Context.Tag`, `Layer.scoped`.

## 7. How the three kinds of test reach the design

**1. Input in, package out.** The test is a caller like any other. It calls `startRecorder({ target: { launch: fixtureUrl, headless: true }, cwd })` with no `windowDir`, then `connectRecorder(address)`. It sends `record`, gives real input to the page, sends `finish`, awaits `ended`, and reads `outcome.packagePath` from disk. The Playwright version is chosen by `cwd`: one folder per supported version in the fixture app, each with its own stock install. To give input, the test opens its own second connection to the same browser by CDP and sends raw input events; it never needs the engine's `Page`. The same suite holds the checks for the private details (the recorder call, the snapshot shape).

**2. The window, through its page objects.** The window takes its connection as a value. A window test hands it a scripted one: an object with `watch`, `send` and `close` that plays views and records commands. That is three functions, and the views are plain data checked by the contract's schemas. End-to-end, the fixture app starts a real Recorder and opens `address` in a browser; the window's page objects drive it.

**3. Snapshots in, timeline out, no browser.** `recording/domain` is called directly: feed it Visits, snapshots as text, and interactions; read the entries and the package text. No Effect, no port, no fake.

One more kind falls out of the design: **happenings in, to-do list out.** `step` is pure, so each path the model checker found ("press Finish while a click is held") is a short table test with no browser and no clock. The scripted browser is needed only for the thin layer above: that `carryOut` and the timers do what the to-do list says.

## 8. Trade-offs

**Where this gives a lot per thing learned**

- A caller learns `startRecorder`, `watch`, `send` and one view. Every lifecycle rule, every Playwright detail and every ordering problem is on the other side.
- A new command is one more variant of `RecorderCommand`. A new thing to show is one more field of `RecorderView`. No entry point is added in either case. (Highlighting an entry's element on hover, which the window trial had, would arrive this way.)
- `can` means the lifecycle is written once. The window, the toolbar and tests cannot disagree with the engine about what is allowed.
- Reload, reconnect and stale messages are solved once, inside `connectRecorder`, by always handing over the whole view.
- Tests cross the same seam as callers. There is no test-only door into the engine.

**Where it is thin or awkward**

- **The command-line program is blind.** It cannot print "3 interactions recorded" without opening a connection to its own engine like a stranger. The same holds for a test: to press Record it goes through a local WebSocket. That is slower and has one more thing that can fail than a method call.
- **`send` says little.** `"applied"` means "taken", not "done". A caller that wants to know when Finish has finished must watch the view. One verb for eight commands also means no per-command return value, ever.
- **The whole view on every change.** Simple to consume, but the listener gets no hint of *what* changed. A window that wants to animate a new entry must compare with the previous view itself. On the wire only changed entries travel, but the fold back into a full view costs a little on each message, and a very long recording makes each view large.
- **`RecorderView` is a wide shape.** The entry count is small but this one type carries phase, permissions, Visits, entries with Change Trees, and the outcome. The interface is small in verbs, not in data. Any change to it touches the engine, the window and the toolbar together.
- **`windowDir` leaks packaging.** The engine serves the window but may not depend on the window package (the window depends on the engine's contract). So the command-line package passes the folder in. It is the one option that exists for a build reason, not a domain reason.
- **`cwd` does three jobs** (find Playwright, place the package, find a recording for `trace`). Good for the interface, awkward the day someone wants the package elsewhere. Nothing asks for that today.
- **`runTraceTool` is a guess.** It assumes `trace` means "run the stock trace tool on a recording". If `trace` should do more, this entry changes shape. It is also the weakest entry: little behaviour behind it.
- **The pure `step` function will be large.** Eleven lifecycle boxes times the gate's states, in one function. That is the price of having ordering and wrap-up in one place. It is the part to review hardest, and the part the model can be compared with line by line.
- **The `RecordedBrowser` port is wide** (about fifteen operations and ten kinds of event) and has one production adapter. The scripted adapter must be kept honest by the per-version tests, or the flow tests will pass against a browser that does not exist.
- **No escape hatch.** A caller that needs the Playwright `Page`, a single snapshot, or the timeline without a browser cannot get it through the interface. Inside the repository `recording/domain` can be imported directly; that is an internal door, and the interface does not admit it exists.
