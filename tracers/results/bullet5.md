# Bullet 5: ref collisions under realistic conditions

Throwaway proof. Real Playwright 1.62.1 (chromium, headless), the inspector-fixture app served by me on http://127.0.0.1:4791 (`devbox run -- pnpm --dir apps/inspector-fixture dev --port 4791 --strictPort`, stopped by PID afterwards), injected source from playwright-lite `cd81df2e` as in bullet 1. The agent side is the real `ayme mcp` command started per trial with `startAgent("--port", <free port>)` and connected to the same Playwright page with `connectPage` from `packages/mcp/dist/testing.mjs`. `ignoreAutoPairScan` keeps the page off ports 9350 to 9365. No agent config was touched.

## What ran

- `tracers/bullet5/common.mjs`: bootstrap (bullet 1's, plus two probe variants), the `ayme-ref` engine, Node capture, core's Settled Page wait reimplemented in the page (same events, MutationObserver on `document`, 250 ms quiet, 2 s deadline, subscribed before the action as `runAction` does), and `open()`.
- `tracers/bullet5/run.mjs <mode> <variant> <inspector|noinspector> 10 10`: 10 trials, each a fresh browser, page and `ayme mcp`, each adding 10 items. Raw output: `tracers/bullet5/out/<mode>.<variant>.<inspector>.json`. `summarize.py` and the inline tallies below read those files.
- `tracers/bullet5/probe.mjs`: one look at the page (tools, snapshot text, marks at load).

Modes:
- **node-first** (interleaving 1, then 2): Node runs `ListPage.addItem` on real Playwright (`getByRole("textbox", { name: "New item" }).fill`, `getByRole("button", { name: "Add item" }).click`), waits for a Settled Page, captures. After 10 adds and a 1.2 s pause, Node re-captures, then the agent calls `snapshot` and `ListPage.countItems` through `ayme mcp` (interleaving 2: the page's runtime reads after Node minted). Then each side clicks "Add item" by the ref its own text gives it.
- **agent-first** (control ordering): Node captures once at start, then the agent calls `ListPage.addItem` through `ayme mcp` 10 times; Node captures as soon as each call returns. Same reads and clicks at the end.

Variants: **plain** (bullet 1 bootstrap), **shared** (our copy only: `"e" + ++lastRef` replaced with a counter on `window[Symbol.for("ayme.ariaRefCounter")]`), **prefix7** (unpatched, `frameSeq: 7`). The page's copy and every package are unpatched.

Control without the Inspector: the dogfood page with `mountInspector` never called. The served `startAyme.ts` response is rewritten in that browser context only (`mount === "before" ? mountInspector({` to `false ? mountInspector({`); Agent Connection and WebMCP stay on. No file was changed.

Attribution instrument: a setter on `Element.prototype._ariaRef` records the first assignment per element with a timestamp and which copy made it, by stack (the page's copy runs from `/@fs/.../packages/ayme/dist/runtime-CzbDAjJI.mjs`; ours has no URL). Limit: it records only the first mint per element. A re-mint after a role or name change is not recorded (one is visible in the excerpt below: `e2`).

## Facts about the page (observed)

- With the Inspector (dogfood): the page's copy had minted **494** refs by the end of load (`e1` = body ... the panel's elements). The panel is in an open shadow root, so both copies' captures include it.
- Without the Inspector: **0** `_ariaRef` marks after load, with WebMCP and the Agent Connection connected. The page's copy marks elements only when the runtime captures, which is on a tool call (`snapshot`, an action's before and after).
- The page runtime rejects a capture with duplicate refs: `PageStateSession.captureTree()` calls `tree.findDuplicateRef()` and throws `RuntimeStateError`. The Inspector's `look()` and `capturePageState()` skip that check. Checked after every collision: both returned "ok" (for example `look: ok, 236 refs`) while the agent's `snapshot` threw.
- The runtime's snapshot tree starts at `main` on the no-Inspector page (body is not a node there), so a duplicate of body's `e1` is not detected; the first detected duplicate there is `e2`.
- The runtime's element tools accept a Structural Ref only if it matches `/^(e\d+|s_.+)$/` (`packages/ayme/src/elementTools.ts:213`). Anything else is treated as a selector.

## Hit rates (10 trials each, 10 adds per trial)

| run | li minted by Node (per add) | trials with duplicate refs | agent `snapshot` fails | Node click "Add item" by its ref adds an item | agent click "Add item" by its ref |
|---|---|---|---|---|---|
| node-first, plain, Inspector | **80/100** | **10/10** (first at add 2) | **10/10** | **0/10** (lands in the panel) | 10/10 fail (`RuntimeStateError`) |
| agent-first, plain, Inspector | 0/100 | 0/10 | 0/10 | 10/10 | 10/10 succeed |
| node-first, plain, no Inspector | 100/100 | 0/10 during Node flow | 0/10 | 10/10 | 10/10 **click performed, then reported as error** |
| agent-first, plain, no Inspector | 0/100 | **10/10** (first at add 1) | **10/10** | 10/10 | 10/10 fail; every `addItem` from add 2 on fails |
| node-first, shared, Inspector | 80/100 | 10/10 (add 2) | 10/10 | 0/10 | 10/10 fail |
| node-first, shared, no Inspector | 100/100 | 0/10 during Node flow | 0/10 | 10/10 | 10/10 performed, then error |
| agent-first, shared, no Inspector | 0/100 | 10/10 (add 1) | 10/10 | 10/10 | 10/10 fail |
| node-first, prefix7, Inspector | 78/100 | 0/10 | 0/10 | 10/10 | `e8`: 10/10 succeed; any `f7eN` ref: 10/10 fail |
| node-first, prefix7, no Inspector | 100/100 | 0/10 | 0/10 | 10/10 | 10/10 fail (`f7e8` "matches no element") |
| agent-first, prefix7, no Inspector | 0/100 | 0/10 | 0/10 | 10/10 | 10/10 fail (`f7e8`) |

Every trial of a run behaved the same; the only spread is which add the page won.

### Interleaving 1: Node acts, settles, captures (with the Inspector)

The hypothesis holds. Node's capture landed 263 to 283 ms after the click in the plain run (median 275 ms; settle median 274 ms; 263 to 296 ms across the three Inspector runs). The page's copy marked the new `li` before that in only 20 of 100 adds: always add 1 (at about 380 ms, when Node's own capture also came late, 456 to 480 ms) and one add in the middle of each trial (at 184 to 202 ms after the click in the plain run, 179 to 213 ms across the three Inspector runs). In the other 80 adds Node minted the `li`, and on every add it also minted 8 or 9 new Inspector panel elements (the Model lens row for the new item: `BUTTON treeitem "ListPage.entries[n]"`, its `svg`, `path`, `span`s). Node's counter starts at 0, the page's is at 494, so every Node mint reuses a number the page already gave a live element.

Inference, not measured: the Inspector's look is debounced 200 ms (`refreshScheduler`, 1 s max wait) and then awaits the Page Object registry before it captures, which usually puts its capture after 275 ms; the early mid-trial page mints may be the max-wait path. The panel elements the Inspector renders after its own look are not marked until its next look (its MutationObserver watches `document.body`, not its shadow root, and skips its own mutations), so Node reaches them first.

Node's text after 2 adds (excerpt run `out/node-first.plain.inspector.excerpt.json`, every line whose ref appears twice):

```
- generic [ref=e1]:                       (body)
- main [ref=e2]:
- heading "Groceries" [level=1] [ref=e3]:
- textbox "New item" [ref=e5]:
- checkbox "Urgent" [ref=e7]:
- button "Add item" [active] [ref=e8]:
- button "Clear" [ref=e9]:
- listitem [ref=e1]:                      (item 2, Node-minted)
- complementary "ayme" [ref=e10]:
- button "On this page · 14" [expanded] [ref=e2]:   (re-minted by Node on a name change)
- treeitem "ListPage.entries[1]" [level=4] [ref=e3]:
- img [ref=e4]:
- generic [ref=e8]:                       (span "ListItem" in the panel)
- generic [ref=e9]:
- generic [ref=e10]:
```

After 10 adds Node's text holds 80 duplicated refs. The list app part of it (final capture, trial 1):

```
- button "Add item" [active] [ref=e8]
- button "Clear" [ref=e9]
- list "Items" [ref=e432]:
  - listitem [ref=e495]: item 1      (page-minted)
  - listitem [ref=e1]: item 2        (Node-minted, = body)
  - listitem [ref=e11]: item 3       (= "Resize from the left edge")
  - listitem [ref=e21]: item 4
  - listitem [ref=e31]: item 5       (= "Theme: System. Switch to Light.")
  - listitem [ref=e41]: item 6
  - listitem [ref=e505]: item 7      (page-minted)
  ...
```

No cross-text comparison exists after the collision on the plain Inspector runs, because the agent's text is the error (interleaving 2). The only page runtime view of these elements is from before it: the agent's snapshot at load shows `- e8 button "Add item"`; Node's text keeps `button "Add item" [ref=e8]` for it after the collision too, but `ayme-ref=e8` no longer means it. With prefix7, where no error occurs, both texts are compared below.

Wrong click (10/10 trials): Node's final text says `button "Add item" [ref=e8]`. `ayme-ref=e8` resolves to `span "ListItem"` inside `treeitem "ListPage.entries[1]"` of the Inspector's Model lens (the map is built from `refsByElement` and the later element wins). A click listener on `document` saw the click land on `span "ListItem"` (`composedPath()[0]`). Visible effect: with "by node ref" typed in the textbox, the item count stayed 10 to 10; no item was added. The same element through `getByRole` adds an item. Other resolutions in the same text: `e1` to `li "item 2"` instead of body, `e3` to the panel's treeitem instead of the heading, `e5` (the textbox) to an svg `path`, `e9` ("Clear") to an empty `span`.

### Interleaving 2: the agent reads through the page's runtime after Node minted

With the Inspector, 10/10: `snapshot` returned `RuntimeStateError: The page capture gave more than one node the Structural Ref e1.` So did `ListPage.countItems` and `click` with the ref `e8` the agent had seen at load. The agent's Caller is dead on that document: the duplicate marks stay until an element's role or name changes, so every later capture finds them. The Inspector kept rendering (its `look()` returned ok), so the panel shows the page while every agent tool fails.

Without the Inspector (node-first), the page's copy had minted nothing, so its counter is still 0. The agent's `snapshot` succeeded and showed Node's numbers (`- e8 button "Add item"`, `- e11 ListPage.entries[0]: item 1` ... `- e20`). Its first action broke it: `click` on `e8` captured the before (the "by node ref" item that no one had captured yet got `e1`, a duplicate of body that the tree does not show), clicked (items 11 to 12, click landed on `button "Add item"`), then the after capture minted `e2` for the new item and threw `RuntimeStateError ... Structural Ref e2`. The agent saw an error for an action that had happened, 10/10.

agent-first without the Inspector shows the same from the other side: Node's first capture marked `e1`..`e10`; the agent's first `addItem` made the page mint `e1` for the new `li` (duplicate of body, undetected), the second minted `e2` (duplicate of `main`) and failed. From add 2 on, every `addItem` failed in 10/10 trials, and `snapshot`, `countItems` and `click` all failed at the end.

agent-first with the Inspector: no collision in 100 adds. The page's copy minted every new element (the action's after capture, and the Inspector's look after a Run settles), and Node only reused marks.

## Fix probes

**Shared counter on window, our copy only:** no change. Same rates as plain in all three runs (80/100 and 10/10 with the Inspector, 10/10 failures in agent-first without it). Two reasons, both observed in the mint log: the page's copy is unpatched and keeps its own module `lastRef` (the version-skew limit), and the window counter starts at 0 while the page's counter is already at 494, so our first mint is `e1` again. Inference: the fix would need every copy on the page to carry the patch, and Ayme's existing page bundles do not.

**`frameSeq: 7`:** no duplicate refs in any text, in any run (0/30 trials). Node's clicks by ref all landed right (10 to 11 items). But the texts now mix ref forms for elements on the same list, and the page's runtime cannot act on Node's refs:

Same page, same moment (node-first, prefix7, Inspector, trial 1, after 10 adds):

```
Node text                              page runtime snapshot (agent)
- button "Add item" [ref=e8]           - e8 button "Add item"
- listitem [ref=e495]: item 1          - e495 ListPage.entries[0]: item 1
- listitem [ref=f7e1]: item 2          - f7e1 ListPage.entries[1]: item 2
- listitem [ref=f7e11]: item 3         - f7e11 ListPage.entries[2]: item 3
- listitem [ref=e505]: item 6          - e505 ListPage.entries[5]: item 6
- listitem [ref=f7e50]: item 7         - f7e50 ListPage.entries[6]: item 7
                                       - f7e3 treeitem "ListPage.entries[1]"   (Inspector panel)
```

Refs agree across the two texts, but each text mixes `eN` and `f7eN`. Without the Inspector, after Node read first, the agent's snapshot is all `f7eN` (`- f7e2 main:`, `- f7e8 button "Add item"`, `- f7e11 ListPage.entries[0]: item 1`).

The page's copy reuses the `f7eN` marks, so the agent's snapshot shows them, but its `click` treats `f7e8` as a selector and fails: `RefResolutionError: Cannot click "f7e8": the selector matches no element.` 10/10 in every prefix7 run, including `f7eN` refs on the Inspector page. Without the Inspector this means the agent cannot click anything Node read first.

## Verdict

Yes, the collision happens in the flow we would run, without forcing. On the Inspector dogfood page, Node's act, settle and capture sequence minted first on 80 of 100 adds and produced duplicate refs in 10 of 10 trials, from the second add. On a page without the Inspector the page's copy marks nothing until a tool call, so whichever Caller reads first wins the numbering, and the other copy's next mint collides. The consequence is worse than bullet 1 showed: besides wrong clicks on our side (10/10, the click lands in the Inspector panel and the app does nothing), the page's runtime refuses every capture with a duplicate, so the agent's `snapshot`, actions and clicks fail on that document from then on, sometimes after the action has already happened.

Which fix the evidence favours:
- A shared counter fails under version skew (0 improvement), as expected.
- A distinct prefix removes the duplicates, but the page runtime only accepts `e\d+` or `s_` refs, so the agent loses every element Node marked first. It would need the runtime to accept the prefix (a product change in `elementTools.ts`, plus whatever else assumes `eN`), which again fails for pages on an older Ayme.
- What the evidence favours (inference, not tested here): not having a second copy mint into the shared `_ariaRef` expando at all. Either reuse the page's own Lite capture when the page runs Ayme (one counter, one numbering for both Callers), or give our copy a private expando or WeakMap so it never writes the page's marks (needs the fork change bullet 1 named; refs would then not equal the agent's).

## Processes

The fixture dev server (devbox 41979, shell 42032, vite 42060) was stopped by PID; port 4791 is free. Each trial's `ayme mcp` was closed with its client; `pgrep -f "cli.mjs mcp"` finds none. Every browser was closed in `finally`; `pgrep -fl ms-playwright` finds none. `git status --short` in the worktree shows only `?? tracers/`.
