# Bullet 2: the action sequence across the Node/browser process boundary

Throwaway proof. Worktree `ayme-tracers` at e3946304, real Playwright 1.62.1 (Chromium, headless), example-react dev server at http://127.0.0.1:4191 (shared, not touched).

## What ran

All code is in `tracers/bullet2/`; run from the worktree root with `devbox run -- node tracers/bullet2/<script>`.

| Script | What it does |
| --- | --- |
| `discover.mjs` | Lists the published tools and prints Playwright's ai-mode snapshot. |
| `common.mjs` | Imports (Playwright, `@ayme-dev/ayme/testing` dist, `@ayme-dev/core` dist), fixture injection, the ai-mode-to-core bridge, a port of `renderChangeRecord`. |
| `nodeRunAction.mjs` | The Node action sequence: in-page watcher, activity source, full-load watch, `nodeRunAction`. |
| `step1_bridge.mjs` | Checks the bridge: ref stability and capture parity with the browser `snapshot` tool. |
| `run.mjs` (`REPS=5`) | Three actions, Node vs browser, 5 reps each, plus error texts. Raw output: `out.json`; summary: `summarize.mjs`. |
| `browserNav.mjs` | The browser runtime's own answer to a full-load action, read back via sessionStorage. Raw output: `browserNav.json`. |
| `oldDocProbe.mjs` | Checks whether Node can still read the old document once the load has started. |
| `drift.mjs` | Checks `changes_before`: the page changes between the Caller's snapshot and the action. |

**Node-side capture.** I used Playwright's own `page.ariaSnapshot({ mode: "ai" })`, not bullet 1's injected capture. Refs were not resolved through an `ayme-ref` engine. Node acted through ordinary Playwright locators (`getByRole`, `#id`).

**Published tools (example-react).** `snapshot, click, hover, type, fill, check, uncheck, select_option, fill_form, press_key, generate_locator, navigate, navigate_back, navigate_forward, reload, CounterPage.increment, CounterPage.setMode, SubCounterPage.increment, SubCounterPage.setMode`.

**Fixtures.** example-react has no disabled button, no non-fillable target and no same-URL navigating control. After load, before the first capture, both sides inject the same `<div id="bullet2-fixture">` with one `page.evaluate`, appended to `body` outside React's `#root`. It holds:
- `button#b2-nav "Navigate with query"`, whose click handler sets `location.href = location.href + "&nav=1"`. The page is opened at `/?bullet2=<unique>`, so the action is a full load of the same URL plus a query.
- `button#b2-disabled [disabled]`.
- `p#b2-para`.

No app file was edited.

**Same state each time.** Each rep uses a fresh BrowserContext with `recordPublishedTools`. The sequence is: goto, wait for `CounterPage.increment`, inject, wait 300 ms, then one Caller read. On the browser that read is the `snapshot` tool. On Node it is one recorded ai-mode capture that sets the cursor. Then the action runs. The browser side acts with the published `click` Browser Tool, by refs read from its own `snapshot` result. The toggle runs unmount and then mount as two actions on the same page.

**Node `runAction` (mirrors `actionSequence.ts` + `pageState.ts`).**
1. `StructuralObservationSession.recordActionStarted`.
2. Before capture, recorded with `relation: "before"` only when `StructuralTree.reconcile(latest, capture).hasAnyChanges()`.
3. `perform()` (`locator.click()`) then `waitForSettled` with `SETTLED_PAGE_QUIET_MS` (250) and `SETTLED_PAGE_DEADLINE_MS` (2000), raced against a full-load signal.
4. After capture, `recordObservation`, then `readChange(received, before)` and `readChange(before, after)`, rendered with the ported `renderChangeRecord` (`projectStructuralNodeForest` + `renderCompactStructuralNodeForest`).

**Watcher.** One `page.exposeFunction("__b2Activity")` per Page, plus a `context.addInitScript` watcher that re-arms in every document. The watcher runs a MutationObserver on `documentElement` (subtree, attributes, childList, characterData) and listens for the same transition, animation, scroll and resize events as `pageActivitySource.ts`. It coalesces activity per `setTimeout(0)` and sends `{ token, events: [[t, kind, n]], sentAt }`. `t` is `performance.timeOrigin + performance.now()`, which is comparable with Node's same expression.

**Full-load signal.** A main-frame `request.isNavigationRequest()`. `framenavigated` and the first batch from a new document token are recorded too.

## Result 1: the bridge (ai-mode YAML into core)

**Nothing was missing.** Core exports `StructuralTree.fromAriaSnapshotYaml(yaml, refAllocator)`. Playwright's ai-mode YAML parses directly, including `[ref=eN]`, `[cursor=pointer]`, `[active]`, `[disabled]`, `/url:` and `text:`. I ported Ayme's `parseCapturedTree` wrapper, which gives ref-less nodes temporary refs and promotes their children. I reused one `SyntheticAriaRefFactory` per page and ran `findDuplicateRef()` on every capture; it found no duplicates.

**Refs are stable.**
- Two captures with no change produce identical YAML and `reconcile(...).hasAnyChanges() === false`.
- After an increment, `e11` (the output) and `e12` keep their refs.
- An element whose accessible name changes gets a new ref. The toggle button `e8 "Unmount counter"` became `e19 "Mount counter"`. Lite's capture does the same (see the toggle rows).

**Capture parity with the browser `snapshot` tool.** On this page the two structures are the same text, apart from focus state: the browser read came after the Node increment, so `[active]` is on `e12` there instead of `e1`. The ref numbering is identical too (`e1`, `e3`..`e18`).

```
Node (ai mode, through core)                 Browser snapshot tool (Lite)
- e1 [active]:                               - e1:
  - e3 main:                                   - e3 main:
    - e4 heading "React integration check"...    - e4 heading "React integration check"...
    ...                                          ...
    - e9 region "Counter":                       - e9 region "Counter":
      - e10 paragraph:                             - e10 paragraph:
        - text: "Count:"                             - text: "Count:"
        - e11 status: 0                              - e11 status: 1   (taken after the increment)
      - e12 button "Increment" [cursor=pointer]    - e12 button "Increment" [active] [cursor=pointer]
  - e15:                                       - e15:
    - e16 button "Navigate with query" ...       - e16 button "Navigate with query" ...
    - e17 button "Disabled action" [disabled]    - e17 button "Disabled action" [disabled]
    - e18 paragraph: Plain paragraph             - e18 paragraph: Plain paragraph
```

Caveats:
- example-react's Page Objects have no root, so this page shows no POM labels.
- Neither capture showed the Inspector.
- On a page with rooted POMs, the Node text would lack the POM labels and placement that `pageState.ts` adds from the registry. That difference sits in the capture, not at the boundary.

## Result 2: three actions, side by side (5 reps each; every rep gave the same result text)

Wall times are medians [min..max] in ms.
- **Node**: `nodeRunAction` start to answer, including the before and after captures over CDP. Each ai-mode capture took 1.5 to 2.8 ms.
- **Browser**: the `executePublishedTool` round trip, except for navigate, where it is the in-page answer time.

### Quiet increment

| | Node | Browser |
| --- | --- | --- |
| settled | true | true |
| page_changed | true | true |
| changes_before | absent | absent |
| wall | 303.5 [295.8..313.2] | 379.4 [376.1..393.3] |

`changes`, identical text on both sides:
```
- e1 <changed>:
  - e3 main:
    - e9 region "Counter":
      - e10 paragraph:
        - e11 <changed> status: 1
      - e12 <changed> button "Increment" [active] [cursor=pointer]
```

### Toggle: unmount, then mount on the same page

| | Node unmount | Browser unmount | Node mount | Browser mount |
| --- | --- | --- | --- | --- |
| settled | true | true | true | true |
| page_changed | true | true | true | true |
| changes_before | absent | absent | absent | absent |
| wall | 303.3 [301.7..304.6] | 378.3 [373.2..383.8] | 276.6 [275.3..282.5] | 300.6 [295.6..302.2] |

`changes` has the same structure on both sides. Only the numbering of new refs differs: Node's new button is `e19`, the browser's is `e20`.

```
unmount (Node; browser identical except e20 for e19):
- e1 <changed>:
  - e3 main:
    - e19 <added> button "Mount counter" [active] [cursor=pointer]
    - e8 <removed> button "Unmount counter" [cursor=pointer]
    - e9 <removed> region "Counter":
      - e10 <removed> paragraph:
        - text: "Count:"
        - e11 <removed> status: 0
      - e12 <removed> button "Increment" [cursor=pointer]
      - e13 <removed> button "Call Page Object" [cursor=pointer]
mount (Node e20..e25, e19 removed; browser e21..e26, e20 removed):
- e1:
  - e3 main:
    - e20 <added> button "Unmount counter" [active] [cursor=pointer]
    - e21 <added> region "Counter": ... (paragraph, status 0, both buttons, all <added>)
    - e19 <removed> button "Mount counter" [active] [cursor=pointer]
```

The mount action's `changes_before` is absent on both sides, so the cursor advanced to the unmount action's Settled Page.

Side observation: the browser's `click` by the old ref `e8` for mount fails with `RefResolutionError: Cannot click ref "e8": removed.` The button element is the same, but its name changed, so its identity changed. Mount had to use the ref from the unmount result's `changes`.

### changes_before (`drift.mjs`, 1 rep each)

`#b2-para` is changed between the Caller's read and the increment. Both sides gave identical output:
```
changes_before: - e1 [active]:\n  - e15:\n    - e18 <changed> paragraph: Drifted
changes:        (same as the quiet increment)
```

### Navigating action (full load of the same URL plus `&nav=1`)

| | Node, after = latest observation | Node, after = `ariaSnapshot` capture | Browser `click` | Browser `navigate` tool (reference) |
| --- | --- | --- | --- | --- |
| settled | false | false | false | false |
| page_changed | **false** | true (wrong) | **true** | false |
| changes | absent | whole old page `<removed>`, whole new page `<added>` (`f1e3`.. refs) | `e16 <changed> button "Navigate with query" [active]` | absent |
| loading / next | set | set | set | set |
| answer at (ms) | 16.2 [14.8..19.3] | 1047.7 [1045.5..1058.6] | 96.9..101.9 (in-page) | 5.3..6.5 (in-page) |

Load signal timings:
- Node: the navigation request arrived at 10.6 to 25.7 ms after action start in 10/10 runs, and Node noticed it within 0.2 ms.
- Browser `click`: the Navigation API `navigate` event fired at 92.7 to 97.3 ms and the in-page answer resolved about 4 ms later. `pagehide` followed 3 to 6 ms after the answer.

Old document versus the new one (`oldDocProbe.mjs`, 2 reps each, probing right after the navigation request):
- A `page.evaluate` or a pre-acquired `JSHandle.evaluate` on the old document does not return until the new document commits, about 120 ms later. Then it throws `Execution context was destroyed`.
- `page.ariaSnapshot` waits about 1.15 s and returns the **new** document, with refs re-prefixed `f1eN`.

So from the moment a full load starts, **Node cannot read the old document at all**. The "capture" variant therefore diffs two documents under one pageId: it reports a false whole-page replace and adds about 1 s of latency.

The "latest" variant behaves like the browser `navigate` tool, with an answer and no changes. However, it **loses what the action changed before the load started**: the browser `click` reports the focus change on `e16`, and Node cannot.

Reading the old document after the load starts is blocked by Playwright, not by the page (inference from two numbers): in-page script still ran in that window (the browser tool answered at about 97 ms, `pagehide` at about 100 to 104 ms), while `page.evaluate` issued at 25 ms waited until the commit at about 146 ms. That looks like Playwright's Page API holding calls while a main-frame navigation is pending. The rule "never capture after the load starts" therefore applies to Playwright's public Page API, which is the brief's target. A lower-level evaluate against the old execution context might get around it (untested).

Delivering the browser's own answer across the boundary is fragile:
- `executePublishedTool` (a `page.evaluate` awaiting the tool) failed 5/5 with `page.evaluate: Execution context was destroyed`.
- A binding the in-page `.then` calls with the answer, exposed on the context before `goto` (`browserNav.mjs`, 5 reps each):
  - For the `click` tool it delivered **0/5**, although the answer existed in-page 3 to 5 ms before `pagehide`.
  - For the `navigate` tool it delivered **5/5**, reaching Node at about 15 ms, which is after the in-page `pagehide` at about 11 ms.
  - Why the two tools differ is not known. A first run with the binding exposed after load gave 0/5 for `click` as well.
- Inference, untested: a Node runtime that wants the browser's "changes up to the load" would need the page to push a capture on the `navigate` event, through such a binding. Whether that push arrives is not settled by these runs.
- Both runtimes answer `loading` on a signal that comes before the commit: the browser on the `navigate` event, Node on the navigation request. A load that never commits (a 204, a cancelled request) is therefore reported as loading. The browser covers that case with a test (`fullLoad.browser.test.ts`). The Node behaviour in that case, where the old token and the old document both stay, was not tested.

**Watcher re-arming (10/10 runs).**
- The new document got a new token.
- Its `armed` batch reached Node.
- The new document settled through the new-token activity source 252 to 325 ms after the answer.
- `load` fired 0.2 to 15.7 ms after the answer.
- The old action's settle wait, filtered to the old token, resolved without seeing the new document.

Without the per-document token, the per-Page binding would have fed the new document's load mutations into the old action's settle wait. This is a design point: the activity source must be per Document, and a per-Page binding does not give that by itself.

The Node history kept one pageId across the load. I did not call `recordNavigation` for the new document, while the browser starts a new history per Document. A Node runtime has to open a new Visit on `framenavigated` for a cross-document commit (untested).

## Result 3: latency and batching of activity notifications

Measured over the toggle actions, 5 reps. Times are relative to action start, in-page timestamp vs Node receipt.

| | first mutation in-page | batch sent (setTimeout 0) | received in Node | mutation to receipt | send to receipt |
| --- | --- | --- | --- | --- | --- |
| unmount | 16.1..19.9 | 47.3..49.6 | 47.5..49.7 | **29.8..31.7** | -0.4..0.6 |
| mount | 12.6..14.7 | 18.6..22.4 | 18.7..22.7 | **6.0..8.2** | -0.4..0.5 |
| increment | 13.3..27.2 | | 42.1..58.1 | about 30 | |

- **Batching.** Every action produced exactly one batch, holding one MutationObserver callback of 1 or 2 records. Nothing else arrived before quiet.
- **Where the latency sits.** The process hop (CDP binding) costs under 1 ms. The `setTimeout(0)` coalescing costs 6 to 31 ms: the timer fires late while the page is busy right after the click. That is an inference; the two measured facts are mutation-to-send at 6 to 31 ms and send-to-receipt under 1 ms.
- **Consequence.** In 4/5 increment reps the batch reached Node after `click()` had resolved. Node's Settled Page therefore lands at about (receipt + 250 ms), not (mutation + 250 ms): increment settled at 299.7 ms median, versus perform at 18.5 ms.
- **No missed activity.** Because the settle wait subscribes after `perform`, a batch that arrives late still resets the quiet window. No action settled before its own mutation arrived.
- **Overall time.** Node is still faster end to end than the browser `click`. The browser's Lite click takes about 90 ms before the page reacts: its `navigate` event fired at about 95 ms, against about 20 ms for Playwright's request.

## Result 4: actionability, Node Playwright vs browser Browser Tools (Lite)

Lite is not synthetic input without checks. The browser `click` runs Lite's own locator actionability on `locator('aria-ref=e17')`, with the same retry log as Playwright.

| | Node Playwright locator | Browser `click` / `fill` by ref |
| --- | --- | --- |
| click disabled button | 2008 ms (explicit `timeout: 2000`) | 1279 ms (runtime action timeout 1000 ms) |
| fill `<p>` | **7.9 ms, fails fast** | **1271 ms, retries to timeout** |

Error texts (call logs trimmed):

```
Node click:   locator.click: Timeout 2000ms exceeded.
              Call log: - waiting for locator('#b2-disabled')
                - locator resolved to <button disabled id="b2-disabled">Disabled action</button>
                - attempting click action
                  2 × waiting for element to be visible, enabled and stable
                    - element is not enabled ... retrying ... waiting 500ms
Browser click: TimeoutError: locator.click: Timeout 1000ms exceeded. Element is not enabled
              Call log: - waiting for locator('aria-ref=e17')
                - locator resolved to <button disabled id="b2-disabled">Disabled action</button>
                - (same retry log)
              returned as { content: [{ type: "text", text }], isError: true }

Node fill:    locator.fill: Error: Element is not an <input>, <textarea>, <select> or [contenteditable]
              and does not have a role allowing [aria-readonly]
              Call log: ... - waiting for element to be visible, enabled and editable
Browser fill: TimeoutError: fill: Timeout 1000ms exceeded. Element is not an <input>, <textarea>,
              <select> or [contenteditable] and does not have a role allowing [aria-readonly]
```

Differences:
- **First line.** Lite puts the reason on the first line ("Element is not enabled"). Playwright's first line says only "Timeout exceeded", and the reason sits in the call log.
- **Fill on a non-fillable element.** Playwright treats it as a non-retriable error and fails at once. Lite retries until the action timeout and then reports a TimeoutError carrying the same reason.
- **Surface.** The browser returns an MCP `isError` result. Playwright throws.

## Per-check result

| Check | Result |
| --- | --- |
| ai-mode YAML feeds core `recordObservation` / `readChange` | **Pass.** `fromAriaSnapshotYaml` plus a 30-line port of `parseCapturedTree`; nothing missing. |
| Ref continuity across captures | **Pass.** Name change gives a new ref, the same as Lite. |
| Increment: settled, page_changed, changes, changes_before | **Pass.** Identical text. |
| Toggle (unmount, mount): same | **Pass.** Same structure; new-ref numbers differ by one. |
| changes_before with drift | **Pass.** Identical text. |
| Cursor progression (second action has no changes_before) | **Pass.** |
| Navigating action: settled=false, loading, next at once | **Pass** for the shape (16 ms answer). **Differs** in content: Node cannot capture the old document after the load starts, so its `changes` loses the pre-load change the browser reports. A capture-after variant is wrong and slow. |
| Watcher re-arms in the new document | **Pass** 10/10, provided activity is filtered per document token. |
| Notification latency | Under 1 ms for the hop; 6 to 31 ms from `setTimeout(0)` coalescing, which delays the Settled Page by the same amount. |
| Actionability parity | Same checks and logs. Fill-on-`<p>` timing and the error's first line differ. |

## Verdict

**The Settled Page and Change Record contract holds over the process boundary for in-document actions.**
- With Playwright's ai-mode capture fed through core's `StructuralObservationSession` and `readChange`, Node produced character-identical `changes` and `changes_before` and the same `settled` and `page_changed` as the browser runtime. That covers the increment, both toggle actions and the drift case. Only the numbering of newly minted refs differed.
- It was faster end to end: about 300 ms against about 380 ms. The quiet window dominates both.

**It does not fully hold for a full-load action.**
- Node notices the load earlier (navigation request at about 15 to 25 ms) and can answer at once with `settled: false`, `loading` and `next`.
- From that moment the old document is unreadable from Node: evaluate hangs until commit, then throws. So Node cannot report what the action changed before the load started. The browser can, about 4 ms before `pagehide`.
- Inference from the timings: the old document is unreadable because Playwright's Page API holds calls during a pending navigation, not because the page has stopped running script.
- The browser's own answer is also hard to carry out of a dying document: 0/5 via `evaluate`; via a binding, 0/5 for `click` but 5/5 for the `navigate` tool.

**What this changes in the design (proposals, not decided):**
1. The activity source on Node must be per Document: a token per document behind one per-Page binding. Otherwise a load's mutations leak into the previous action's settle wait.
2. For a full load, Node's after should be the latest observation. A capture the page pushes on the `navigate` event through a binding is possible but unreliable here (0/5 for `click`, 5/5 for `navigate`). The after must never be a capture taken through Playwright's Page API after the load starts. The Node history must open a new Visit on a cross-document commit.
3. The watcher's coalescing should send sooner than `setTimeout(0)`, for example a microtask flush, or carry the in-page timestamp into the settle clock. Otherwise the Settled Page shifts by the page's busy time, 6 to 31 ms here. This is minor against the 250 ms quiet window.
4. Lite and Playwright differ in fill-on-non-fillable timing and in the error's first line. If Node tools use real Playwright, the Run error text will not match the browser's word for word.
