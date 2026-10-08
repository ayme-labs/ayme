# Bullet 3: ElementHandle as Page Object Root identity

Throwaway tracer. Question: can an ElementHandle carry a Page Object Root's identity across probes, and what are its lifetime rules?

## What ran

All from the worktree root, inside devbox. example-react at http://127.0.0.1:4191 (shared server, not touched). Real Playwright 1.62.1 from `packages/ayme/node_modules/playwright/index.mjs`, headless chromium, one browser per script, closed in `finally`. `pgrep` afterwards found no leftover chromium or vitest.

| Script | Command | Raw output |
|---|---|---|
| `tracers/bullet3/handles.mjs` (checks 1 to 6) | `devbox run -- node --expose-gc tracers/bullet3/handles.mjs` | `tracers/bullet3/handles.out.txt` |
| `tracers/bullet3/pinning.mjs` (big text divs, confounded, see below) | same pattern | `pinning.out.txt`, `pinning.rerun.out.txt` |
| `tracers/bullet3/pinning2.mjs` (separates locator cost from handle cost) | same pattern | `pinning2.out.txt` |
| `tracers/bullet3/pinning3.mjs` (clean pinning test) | same pattern | `pinning3.out.txt` |
| `tracers/bullet3/lite.browser.test.ts` + `vitest.config.mjs` (Lite in-browser) | `devbox run -- $PWD/packages/ayme/node_modules/.bin/vitest run --config $PWD/tracers/bullet3/vitest.config.mjs --silent=false --reporter=verbose` | `lite.out.txt` |

Source facts used (apps/example-react/src/main.tsx): the root is `<section aria-label="Counter">`, so `getByRole("region", { name: "Counter" })`. The "Unmount counter" / "Mount counter" button toggles `{visible && <Counter />}`. "Increment" changes state without unmounting.

The Lite run imports vitest, `@vitest/browser-playwright` and `@ayme-dev/playwright-lite` from `packages/ayme/node_modules` through relative paths and an alias in my own config. Port 63415 was checked free with `lsof` first. Nothing under `packages/` or `apps/` was edited.

## Per-check results (real Playwright, observed)

| # | Check | Result |
|---|---|---|
| 1 | `page.evaluate(el => el === document.querySelector('section[aria-label="Counter"]'), h)` | `true` |
| 2 | two `region.elementHandle()` handles, compared in-page | `true`. `page.$(...)` handle is also `===` |
| 2 | same two handles compared in Node (`h === h2`) | `false` (different objects and guids) |
| 2b | after clicking Increment (React re-render, no unmount): old `h` still `=== querySelector(...)` and `isConnected` | `true`. The `<output>` handle is also the same node (`textContent` "0" then "1", `isConnected: true`). A fresh `region.elementHandle()` is `===` the old `h` in-page. React updates nodes in place. |
| 3 | after unmount, `h.evaluate(el => el.isConnected)` | `false`, no error |
| 3 | after unmount, `h.evaluate(el => el.getAttribute('aria-label'))` | `"Counter"` (stale read, no error) |
| 3 | after unmount, `h.textContent()` | `"Count: 1IncrementCall Page Object"` (stale read, no error) |
| 3 | after unmount, `h.isVisible()` | `false` |
| 3 | after unmount, `h.click({timeout:1000})` | throws `elementHandle.click: Element is not attached to the DOM` |
| 3 | after remount, old `h === querySelector(...)` | `false`; old `h.isConnected` stays `false`. The handle never follows the new Root. |
| 4 | after `page.reload()`, `hr.evaluate(el => el.isConnected)` | throws `elementHandle.evaluate: Execution context was destroyed, most likely because of a navigation` |
| 4 | after reload, `page.evaluate(el => !!el, hr)` | throws `page.evaluate: Protocol error (DOM.describeNode): Cannot find context with specified id` |
| 4 | after reload, `hr.isVisible()` | `false`, no error |
| 4 | after reload, `hr.dispose()` | resolves |
| 5 | after `hd.dispose()`, `hd.evaluate(...)` | throws `elementHandle.evaluate: Target page, context or browser has been closed` (misleading: the page is open) |
| 5 | after dispose, `page.evaluate(el => !!el, hd)` | throws `page.evaluate: arg.handles[0]: no object with guid handle@0cec70d9dd6a38120cc9ffcae992cb8e` |
| 5 | after dispose, `hd.isVisible()` | throws `elementHandle.isVisible: Target page, context or browser has been closed` |
| 5 | `dispose()` twice | resolves |

### State matrix (real Playwright)

| State | `evaluate` | `isVisible()` | `textContent()` | `click()` | `dispose()` |
|---|---|---|---|---|---|
| connected | works | true | current | works | ok |
| detached (unmounted) | works, `isConnected` false | false | stale value, no error | throws "not attached" | ok |
| context dead (reload) | throws "Execution context was destroyed..." | false | (not run) | (not run) | ok |
| disposed | throws "Target page, context or browser has been closed" | throws same | (not run) | (not run) | ok |

"Hidden", "detached" and "context dead" all give `isVisible() === false`. Only `evaluate(el => el.isConnected)` separates detached from hidden, and only a throw separates context-dead.

## Memory (real Playwright)

### 500 handles to the same Counter section (handles.mjs, check 6)

Node: `process.memoryUsage()` after `global.gc()`. Renderer: CDP `Performance.getMetrics` (JSHeapUsedSize, Nodes) after `HeapProfiler.collectGarbage`.

| Point | Node RSS | Node heapUsed | Renderer JSHeapUsedSize | Renderer Nodes |
|---|---|---|---|---|
| baseline | 147.08 MB | 43.95 MB | 13.36 MB | 51 |
| holding 500 | 173.44 MB | 46.16 MB | 30.25 MB | 296 |
| after disposing 500 | 173.61 MB | 45.45 MB | 30.25 MB | 296 |

- Creating 500 took 852 ms (about 1.7 ms each). Disposing 500 took 62 ms. All 500 are `===` in-page.
- Node RSS did not come back after dispose but heapUsed did. Inference: RSS staying up is allocator behaviour, not a leak. Per-handle Node cost is roughly 4.4 KB of heap (2.2 MB / 500).
- The renderer growth did not come back after dispose either. Inference: it is mostly Playwright's one-time injected-script install plus per-query data, not the handles. pinning3's control (no handles held) shows the same +16.8 MB step.
- `performance.memory.usedJSHeapSize` read 24.80 MB at every point, so I ignored it. Chromium quantizes it without special flags. The CDP numbers are the real ones.
- The `Nodes` metric moves (51 to 296; 1296 to 1796 in pinning2) in ways that do not map to handle counts. Reported as measured, not interpreted.

### Pinning: clean test (pinning3.mjs)

200 divs, each with a roughly 400 KB JS array expando and an `id`, queried by `page.$('#p' + i)` so no text is read. Renderer heap from CDP `Runtime.getHeapUsage` after 3x `HeapProfiler.collectGarbage`.

| Scenario | attached | after querying | divs removed from DOM | after release step |
|---|---|---|---|---|
| control (each handle disposed at once) | 88.9 MB / 251 nodes | 105.7 MB / 696 | **29.4 MB / 296** | n/a |
| held, then `dispose()` | 88.9 / 251 | 105.7 / 696 | **105.7 MB / 696** (pinned) | **29.4 MB / 296** (released) |
| held, then Node reference dropped, no dispose, Node `gc()` x3 over 900 ms | 88.9 / 251 | 105.7 / 696 | 105.7 / 696 | **106.1 MB / 696** (still pinned) |

Observed:
- A held handle keeps a detached node and everything reachable from it alive in the renderer.
- `dispose()` releases it.
- Dropping the handle in Node and running Node GC does **not** release it. Pinned nodes live until `dispose()` or until the execution context dies. In pinning.mjs, `page.reload()` with 500 handles held brought the renderer back to 12.6 MB / 51 nodes.

### Confounded runs (pinning.mjs, pinning2.mjs)

Do not build rules on these; they are kept for transparency. With 500 divs of 100k chars each, any Playwright query that touches them takes the renderer heap from 26 MB to about 221 MB, including 500 `locator.nth(i).count()` calls with **no** handles (pinning2 scenario A). The memory then stays retained after the divs are removed and after disposing. Inference: Playwright's injected script keeps per-element data, which hides any handle effect. One unexplained result: in pinning.mjs, held-then-drop fell from 221.6 to 173.8 MB, and this reproduced on a rerun. Its Nodes count stayed at 1796, and held-then-dispose did not fall. Possibly something time-based in the drop step's 500 ms wait. Unexplained, and no rule depends on it.

## Playwright Lite in-browser (observed, lite.out.txt)

Plain DOM fixture (`<section aria-label="Counter">...`), `createPage()` from `@ayme-dev/playwright-lite`.

| Check | Lite result | Same as real PW? |
|---|---|---|
| 1 `h === querySelector(...)` | `true` | yes |
| 2 `h === h2` in-page / in JS object identity | `true` / `false` | yes |
| 2b in-place text update, `h` same node and connected | `true` | yes |
| 3 after removal: `isConnected` / `textContent()` / `isVisible()` | `false` / `"Count: 1Increment"` (stale) / `false` | yes |
| 3 after removal: `click({timeout:500})` | throws `elementHandle.click: Element is not attached to the DOM` | yes, identical text |
| 5 after dispose: `h2.evaluate` and `page.evaluate(fn, h2)` | both throw `ElementHandle has been disposed` | behaviour yes, text differs |
| 5 dispose twice | resolves | yes |

Reload is not testable in-browser: it would destroy the test document. The Lite source (`dist/locator-*.mjs`, `AdapterJSHandle`) shows the handle holds a direct JS reference to the element, and `dispose()` sets `value = undefined`. Inference, not measured: with Lite, an undisposed handle pins its node only as long as the handle object itself is reachable. Unlike real Playwright, there is no remote object table.

## Verdict

**Yes, within limits.** A handle carries a Page Object Root's identity across probes as long as it stays in one execution context and one mount. It survives React re-renders that do not unmount, because React updates the node in place. Equality is only available in-page and costs a round trip. Lite and real Playwright agree on everything except dispose error text.

It is not the identity itself. It is a cache of identity that something with a lifecycle has to own.

### Lifetime rules (observed unless marked)

1. Valid while the node is connected and the execution context is alive.
2. On unmount it goes stale **silently**. Reads keep returning the old node's values, and `isVisible()` is false, which looks the same as hidden. Only actions throw ("Element is not attached to the DOM").
3. It never follows a remount. The new Root is a different node and the old handle stays detached forever. There is no refresh path from the handle; you need the Locator again.
4. On navigation or reload, `evaluate` throws, `isVisible()` returns false, and `dispose()` still resolves. The renderer frees the pinned memory with the context.
5. In real Playwright a held handle pins the node in the renderer, detached or not. Only `dispose()` or context death frees it. Node GC does not. In Lite (inferred), ordinary JS reachability decides.
6. There is no Node-side identity. Each `elementHandle()` returns a new object with a new guid, so handles cannot be Map keys or deduplicated without a page round trip.
7. Error text depends on the call path and on the runtime, and is sometimes wrong ("Target page, context or browser has been closed" on an open page after dispose). Never classify handle state by message text.

### Does it change the design?

Yes, in four concrete ways (inference from the above):
- Identity across mounts and navigations must live in the Locator (and Structural Ref). A handle can at most say which instance within the current mount.
- Every probe that relies on a handle needs a liveness check first, `evaluate(el => el.isConnected)` together with catching a throw. A stale handle must lead to re-resolving through the Locator, not to reading through the handle.
- Handles need one owner that disposes them on unmount detection, on re-resolve and on navigation. Otherwise real Playwright leaks renderer memory for the life of the page. Cost is low (about 1.7 ms to create, about 0.12 ms to dispose, about 4 KB of Node heap each); the pinned DOM is the real cost.
- Comparing two Roots for sameness needs an in-page `===` round trip (or a Structural Ref), not a Node-side comparison.
