# Bullet 1: our capture and refs on real Playwright

Throwaway proof. Real Playwright 1.62.1 (chromium, headless), example-react dev server at http://127.0.0.1:4191 (shared, not restarted), injected source from playwright-lite `cd81df2e` (`build/generated/injectedScriptSource.ts`, 317,568 chars after `JSON.parse`).

## What ran

- `tracers/bullet1/probe.mjs`: one look at which Lite URL the page loads and which `_ariaRef` marks exist after load.
- `tracers/bullet1/run.mjs <variant>`, each variant its own node process (engine names are once per process):
  - `devbox run -- node tracers/bullet1/run.mjs main` (checks a, b, c, e, f, g)
  - `devbox run -- node tracers/bullet1/run.mjs d-before | d-after | d-isolated` (check d)
- Raw output of the last run of each variant: `tracers/bullet1/out/{main,d-before,d-after,d-isolated}.json`.

Setup as briefed: `context.addInitScript` evaluates the source inside `(() => { const module = { exports: {} }; <source>; ... })()` and stores `window.__aymeTracer = { injected, refs }`. One correction to the brief: `module.exports.InjectedScript` is a thunk (`__export` stores `() => InjectedScript`), so the bootstrap calls `module.exports.InjectedScript()` to get the class. Constructing at init-script time, before `<body>` exists, worked (`tracerInstalled: true`). `selectors.register("ayme-ref", ...)` with the brief's content, before `newContext()`. Capture is one `page.evaluate` that calls `injected.captureAriaSnapshot(document.body)`, rebuilds `refs` (ref to element) in the page and returns `{ distilled, full, count }` plus diagnostics. No element crosses to Node.

Facts about the page before any of our code ran (probe): the page's own Lite is bundled into `packages/ayme/dist/internal.mjs` (served as `/@fs/.../packages/ayme/dist/internal.mjs`), not the Lite package dist. It had already marked 15 elements, `body=e1 ... a=e14, ayme-inspector=e15`, and it re-marks new elements within the 500 ms after a DOM change (the Inspector reacts to mutations).

## Per check

### (a) Capture runs, looks like page state: PASS

First (cold) capture: Node round trip 8.2 ms, in page 5.9 ms (an earlier run: 4.4 / 2.7 ms). Distilled 616 chars / 14 lines, full 2,192 chars / 90 lines, 15 refs, 15 unique, no element sharing a ref.

Distilled text (complete):

```
- main [ref=e3]:
  - heading "React integration check" [level=1] [ref=e4]
  - paragraph [ref=e5]: One Page Object, direct calls, and Page Object Tools.
  - status "Publication" [ref=e6]: "Publication: waiting"
  - button "Retry publication" [ref=e7] [cursor=pointer]
  - button "Unmount counter" [ref=e8] [cursor=pointer]
  - region "Counter" [ref=e9]:
    - paragraph [ref=e10]:
      - text: "Count:"
      - status [ref=e11]: "0"
    - button "Increment" [ref=e12] [cursor=pointer]
    - button "Call Page Object" [ref=e13] [cursor=pointer]
  - link "Full page load" [ref=e14] [cursor=pointer]:
    - /url: /other
```

Full text starts `- generic [active] [ref=e1]:` (body) and lists every text node, including React's empty and whitespace ones (`- text: " "`, `- text: ""`). Every ref equals the mark the page's Lite had already put on that element, because `computeAriaRef` reused them. That it "looks like the Inspector's page state" rests on (g): byte-equal to Lite's own `captureAriaSnapshot` on the same DOM. I did not read the Inspector panel's text itself.

### (b) `ayme-ref=<ref>` click: PASS

`page.locator("ayme-ref=e12").click()`: output `0` to `1`. Same result in all four processes.

### (c) Re-capture keeps refs: PASS

After the click, Increment is still `e12`. No ref appears or disappears in the full text. Exactly three lines differ, none of them a ref:

```
- generic [active] [ref=e1]:                    -> - generic [ref=e1]:
            - text: "0"                         ->             - text: "1"
        - button "Increment" [ref=e12] [cursor=pointer]:  -> ... "Increment" [active] [ref=e12] ...
```

### (d) Engine worlds: ayme-ref always resolves; the brief's caveat reading was inverted

The brief's paraphrase does not match Playwright's doc. The actual sentence (playwright-core `types.d.ts`, on the `contentScript` option) says that *running as a content script* is not guaranteed with other registered engines. Playwright's code (`coreBundle.js`, `parseSelector`) shows why: the world is chosen per selector string, and any custom engine without `contentScript` (or a main-world builtin) puts the whole selector in the main world. A main-world engine like `ayme-ref` therefore can never be pushed out of the main world. Only a content-script engine can be pulled into it.

Also, `contentScript` is the third argument, `register(name, script, { contentScript: true })`. My first d-isolated run put it inside the script object. Playwright ignored it there and the engine ran in the main world (`isoAlone: 1`). Results below are from the corrected run.

| variant | `ayme-ref=e12` count / click | other |
|---|---|---|
| d-before (no-op engine registered before) | 1 / `0` to `1` | `noop-before=x >> ayme-ref=e12`: 0 (expected, no-op returns nothing) |
| d-after (no-op engine registered after) | 1 / `0` to `1` | `ayme-ref=e12 >> noop-after=x`: 0 (expected) |
| d-isolated | 1 / `0` to `1` | see below |

d-isolated: an engine that returns `body` only if it sees `window.__aymeTracer`.
- Registered with `{ contentScript: true }`, used alone: count **0**. It cannot see the main world (the expected failure, evidence of the world split).
- The same source registered without contentScript, alone: 1.
- The contentScript engine chained with ayme-ref, either order (`sees-tracer-iso=x >> ayme-ref=e12`, `ayme-ref=e12 >> xpath=/ancestor::body >> sees-tracer-iso=x`): count **1**. ayme-ref pulled it into the main world, which is exactly the documented caveat.
- `css=body >> ayme-ref=e12`: 1.

### (e) Two injected instances: hypothesis CONFIRMED, refs collide

Under normal timing the collision stays hidden. The page's own Lite re-captures on every mutation and mints first, so the Node instance and the second Lite instance only reuse its marks. After unmounting and remounting Counter, the new elements carried `e16..e20` and then `e21..e25` before our capture. Inferred, not observed: they were minted by the page instance, because both of our copies' counters were still at 0 then, so a mint by either would have produced `e1`. No duplicates appeared in either text (`e_dupTokens*: []`).

Forced case: append an element and capture in the same task, before the page reacts (`e_forced` in main.json). Each instance's counter (`var lastRef`, module-level per evaluated copy) starts at 0. By the inference above, the page's counter is at 25.
- Node instance mints a new button: `e1`, the same ref as `body`. Node `refsByElement` has `e1 -> [BODY, BUTTON("Tracer node-minted")]`.
- The second Lite instance (`/@fs` import of the Lite package dist, a distinct module from the page's copy in `packages/ayme/dist`) mints the next new button: also `e1`. Its distilled text:
  ```
  - button "Tracer node-minted" [ref=e1] [cursor=pointer]
  - button "Tracer liteB-minted" [ref=e1] [cursor=pointer]
  ```
- Node re-capture afterwards: `[ref=e1]` appears 3 times in the full text.
- `page.locator("ayme-ref=e1")` then resolves to `BUTTON "Tracer liteB-minted"`. The wrong element is silently targeted, and body and the other button are unreachable by ref.
- 800 ms later the page's own Lite had kept both `e1` marks (it reuses them too), so the Inspector's own text would show the duplicates as well.
- Mitigation probe: a third InjectedScript built from the Node copy with `frameSeq: 7` minted `f7e2`, which is unique. It is `e2` and not `e1` because the counter is per evaluated source and shared by every instance built from it. The prefix applies only to newly minted refs. Elements already marked keep the other instance's `eN`.

`e_globalDupes: []` in main.json is computed after the tracer buttons were removed, so it does not contradict this. `/@fs` import was not blocked by Vite `fs.allow` (`e_liteImport.ok: true`).

### (f) Timing: ten captures each, medians (warm, 15 to 20 refs, ~2.2 KB full text)

| route | median ms | raw |
|---|---|---|
| Node `page.evaluate` round trip (capture + rebuild refs map + return both texts) | **0.86** | 1.10 0.85 0.88 0.78 0.96 0.80 0.76 0.86 0.78 0.91 |
| in-page time inside those same evaluates | 0.40 | 0.4 ×9, 0.3 |
| in-page direct, our instance (one evaluate, loop of 10) | 0.40 | 0.6 0.4 0.4 0.4 0.4 0.4 0.4 0.3 0.5 0.3 |
| in-page direct, second Lite instance | 0.45 | 0.6 0.6 0.5 1.4 0.4 0.5 0.4 0.4 0.3 0.3 |

The earlier main run gave 1.21 / 0.55 / 0.70 / 0.70. Protocol overhead is about 0.5 ms per capture on this page. The cold first capture (4 to 8 ms) costs more than any warm one. `performance.now()` resolution in the page is 0.1 ms, so the in-page numbers are coarse.

### (g) Node distilled vs in-page Lite text on the same DOM: EQUAL

Node capture then Lite capture, no DOM change between: `distilledEqual: true`, `fullEqual: true`. After a remount with Lite capturing first and Node second, the distilled texts were also equal (`e_remount2.equal: true`). Equality depends on both instances reusing the same marks. In the forced case of (e), each instance mints different numbers for elements it is first to see.

## Verdict

Own engine, own capture and injection all work on real Playwright: capture, `ayme-ref` click, ref stability across a re-capture, and byte-equal text with Lite. ayme-ref is safe from the world caveat by construction, since a non-contentScript engine always forces its selector into the main world.

One finding changes the design: **the `_ariaRef` expando is shared by every InjectedScript copy in the main world, while each copy keeps its own counter**. A page that already runs Ayme's own Lite (any dev page with the Inspector) and our Node-injected copy will mint duplicate refs whenever ours is the first to see an element. `ayme-ref` then resolves the duplicate to whichever element was mapped last. The collision is real but timing-dependent: on this page the page's Lite usually wins the race, which hides it. Scope: tested only on a dev page with the Inspector. I did not test a page running Ayme without the Inspector, so this bullet cannot say whether pages with only WebMCP ever put `_ariaRef` marks on elements.

The design needs one of the following (inference, not tested beyond the `frameSeq` probe):
- a distinct ref prefix for the Node copy (`frameSeq` != 0 gives `f<seq>e<n>`; refs stay unique, but texts then mix `eN` and `f7eN`, and refs would no longer equal the Inspector's);
- a namespaced expando or a WeakMap per copy, which requires a fork change since `_ariaRef` is hard-coded in `computeAriaRef`;
- reusing the page's existing Lite instance when one is present, instead of injecting a second copy.

A smaller point: the injected copy's refs are equal to the Inspector's only while they share marks, so "same refs as the Inspector" is not guaranteed under any of the options above except the last.
