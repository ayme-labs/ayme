# Window trial findings

Implemented on base `acc7fcc8`, stock Playwright 1.65.0 and 1.62.1, Chromium.
This is a viability trial, not release parity. The two prototype probes use
raw CDP human input; a visible Chromium run of the 1.65 probe also passed.
No human usability session or external website was used. The released UI,
toolbar and composition sources were consulted read-only for orientation and
wording; no source files were copied.

## 1. Element details

**Verified:** `model.mjs` derives role, display text, effect kind and parent
context directly from core Change Tree nodes. Added/removed status gives the
visibility wording; before/after checked state gives the checked wording.
Other updates say “changed”. No AI data model and no locator per effect node
are needed for this screen. The adapter currently sends the small derived
rows, rather than bundling core into the browser; this is a presentation
choice, not extra observation the engine must collect.

**Inferred minimum engine contract:** an ordered entry id and revision,
visit/page identity, action with values, target ref + exact/ancestor flag,
target selector fallback, and serialized Change Tree including before state.
The window can derive the rest. References need their recording connection
and visit provenance. Non-tree targets need the selector and ancestor warning;
synthetic `s_` refs have no browser element. A display string cannot recover
an omitted target or turn a removed element back into a live one.

## 2. Highlight identity

**Verified on both versions:** same-connection `page.locator('aria-ref=…')`
finds a main-frame target, `f1e…` iframe target and open-shadow target. Public
`boundingBox()` gives main-page coordinates, so the top-frame overlay draws
all three. A removed Dismiss target has zero matches: clear the drawing and
say “gone”, without waiting on an auto-waiting action. Old-visit highlights
are rejected. Ancestor targets use the action selector instead of pretending
the ancestor is the exact target.

**Limits:** arbitrary synthetic nodes cannot highlight; no cross-origin or
transformed-iframe check, and no identity stability promise beyond the base
engine. Ref lookup does not recreate historical geometry. Fast hover requests
use a sequence guard so a late lookup cannot redraw after hover-out.

## 3. Excluding the UI

**Verified:** a fixed, pointer-transparent host, closed shadow root and
`aria-hidden` keep toolbar labels and drawing out of public ARIA snapshots and
core Change Trees. The toolbar exists only in the top frame. Its own events
stop at window capture before the recorder's document listeners; the small
gate exemption also handles either init-script order. Assert picking bypasses
the gate. Toolbar press prevents the default focus change. The probe checks
unchanged gate-cycle count and active element, no toolbar interaction selector,
and unchanged main layout bounds after use.

**Important boundary:** stock trace DOM snapshots retain the empty host and
its style attribute, although they contain no toolbar labels or closed-shadow
drawing DOM. This does not achieve literally zero trace DOM footprint.
Screenshots can show the UI. The overlay does not move layout, but it can cover
content: it initially overlapped the fixture's toast at top right, so it now
sits at bottom right. Moving/hiding it for arbitrary pages is future work.
Host mutation visibility to application observers and every CSS interference
case were not tested.

## 4. Assert visibility and mode

**Verified on both versions:** hiding `x-pw-glass` leaves stock assert picking
functional. The toolbar and window enter `assertingVisibility`; mouse movement
shows our rectangle, a trusted click produces `assertVisible`, and stock
Playwright returns to recording. No own assertion picker was implemented.
The trial's rectangle follows the composed event target, which may differ
from Playwright's semantic target for labels or other retargeted controls.

The authoritative recorder emits `modeChanged`; the adapter pushes that mode
and its own recording/finishing/finished phase to both surfaces. New documents
request state once through an exposed binding. There is no own mode polling.
Stock Playwright still has its own injected polling recorder. We do not wrap
or call `__pw_recorderState` or `__pw_recorderSetMode`: they remain stock
internals, and their top-frame-only set-mode binding was an alternative.

**Private details added by this trial:**

- `context._connection.toImpl(context)` and the server context symbol with
  description `recorderSymbol`, whose value is a recorder promise.
- That recorder's `mode()`, `setMode()`, `modeChanged` event, and mode values
  `recording`, `assertingVisibility`, `none`.
- The `aria-ref=` selector engine, frame-prefixed refs and connection-local
  ref identity. Public locator calls are used to resolve them.
- The inherited `x-pw-glass` tag hidden by the base prototype's stylesheet.

**Inherited private dependencies**, unchanged: `_startRecording` /
`_stopRecording` on 1.65, `_enableRecorder` / `_disableRecorder` on 1.62; API
sink actionAdded/actionUpdated/signalAdded shapes and action event snapshots;
`_ariaRef` for target hints; recorder key-versus-fill classification in the
gate; page `_guid` for package page identity. The gate's internal frame-entry
selector syntax remains in use. The trial uses no utility-context ref stamping
(`stamp: none`), no fork and no `page.pickLocator()`.

## 5. Trace noise

**Verified:** trace audit groups around toolbar mode delivery contain no
Playwright calls. Exposed binding calls from the page and CDP
`Runtime.evaluate` state/drawing delivery bypass Playwright instrumentation.
Creating a CDP session does appear once as setup. Public highlight resolution
adds a `queryCount` and locator `waitForSelector` action per successful hover
(on these versions the bounding-box request itself is not another trace action).
An absent ref adds the count only. The dirty notification is free; the ensuing
public `ariaSnapshot` is traced. Existing settle evaluations, gate input
replay, target lookup and trace-point evaluations remain noisy.

`trace-audit.py` reads the unmodified stock trace. Its group windows are bounded
by tracing.group/groupEnd. Probe-only locator positioning and focus inspections
also appear in the total method counts; totals are not production overhead.
A future hover implementation could resolve geometry in the same server
utility context without instrumentation, but this trial did not verify that
alternative. CDP delivery makes this adapter Chromium-specific.

## 6. Streams and commands

The trial uses **EventSource + HTTP POST**, standard Node and browser APIs,
with no new dependencies. Live messages are:

- `entry`: upsert one id with visit, order, action/target and effect rows;
- `remove`: remove one provisional or superseded entry;
- `state`: authoritative phase and recorder mode.

Commands are `assert`, `highlight(visitId, ref | selector)` / clear highlight,
and idempotent `finish`. A connection gets current entries once for bootstrap;
changes never resend the timeline. EventSource reconnect bootstraps current
entries. There is no sequence cursor or robust reconnect deletion recovery:
upgrade this before using a persistent/reviewable session.

**Inferred production interface:** tRPC WebSocket subscriptions for visit
upserts, entry upserts/removals, recording state and errors, with a snapshot +
revision cursor for reconnect. Mutations for assert mode, hover/clear, and
finish returning output location. This trial tests payload shape and lifetime,
not tRPC transport compatibility. Keep the browser-page bridge separate from
the window transport: CDP/bindings serve the injected toolbar; tRPC serves the
local-URL window.

The base engine has no live ambient-change stream. This adapter installs a
debounced MutationObserver that notifies Node, then enqueues a read against
the visit's last snapshot. It emits one provisional change per visit and
updates it in place, without advancing engine state or changing attribution.
On the next finalized interaction that provisional item is replaced by the
engine's actual unassigned change; at Finish it becomes the trailing change.
**This is a trial seam:** the real engine must own this stream and its identity,
especially to handle transient changes and navigation. A late result is shown
as unassigned, not asserted to be caused by an earlier interaction.

## 7. Easier and harder

**Demonstrated:** a local URL removes the second Chromium, dock/focus code and
window-launch lifecycle. Core supplies useful structural display data. Entry
upserts replace complete-timeline broadcasts. One recorder mode source replaces
toolbar polling and duplicate phase logic. Plain DOM works without a fork's
injection slot, and stock assert picking can keep doing its job.

**Harder / still open:** hidden PW visuals require our own geometry and picking
feedback; a public hover lookup adds trace noise; server mode access is private;
closed shadow roots leave a trace host; browser ref lifetime is narrower than
historical timeline lifetime; live ambient updates need an engine stream;
reconnect and error recovery need a real protocol. The small trial projection
does not match every released effect phrase or every target-label heuristic.

## Commands deliberately not built

- **Pause:** authoritative phase transition, drain pending gated inputs and
  recorder events, disable capture/gate together, keep observation/review policy
  explicit. Toolbar and window consume that one state.
- **Resume:** new baseline to separate changes made while paused; enable gate
  and recorder atomically, preserve visits and ids, publish the transition.
- **Clear:** drain or invalidate queued work with a recording generation, reset
  entries/baselines/trace-output policy, and broadcast reset/removals.
- **Discard:** paused-only inclusion flag on a stable entry id, revision event,
  and package writer honoring that flag; preserve source trees and trace points.
- **Restore:** reverse that flag and republish the same id/order; recompute any
  derived presentation or output that depends on included entries.

These are engine requirements inferred from the trial, not verified behaviours.

## Documentation versus code

No pre-existing documentation/code disagreement was found. The base findings'
“nothing watches the page in between” still describes the base engine; the new
adapter's provisional mutation stream is explicitly described above.
