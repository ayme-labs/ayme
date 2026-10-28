# Issue 957 diagnostic

Investigation only. No product source changed, timeout changed, or outcome policy selected.

[#957 "On a page with long main-thread tasks, a click that lands is reported as \"Timeout 1000ms exceeded\""](https://github.com/ayme-labs/ayme/issues/957) is reproducible on current remote main, `a55e9d15fed89156c80765bc72e729c47ce4fbc4`. Remote main was checked again after the experiments and still named that commit.

## Run

From the repository root, inside a persistent `devbox shell`:

```sh
pnpm -C packages/ayme exec node diagnostics/issue-957/run.mjs
```

This runs a fast control and then the identical button with 1400 ms of synchronous work after its click updates the DOM. It invokes the actual published WebMCP Browser Tool on the button's Structural Ref, using the existing recording driver. It exits **1** when the exact symptom is observed, with this assertion:

```text
AssertionError [ERR_ASSERTION]: #957 REPRODUCED: click effect in the same isError result's Change Record
```

Signal from the slow case in [repro.json](repro.json), with no secrets present:

```text
clicks: 1
effect: Applied 1
isError: true
TimeoutError: locator.click: Timeout 1000ms exceeded.
  - waiting for locator('ayme-ref=e2')
  - performing click action

changes:
- e1 <changed>:
  - e2 <changed> button "Apply" [active]
  - e3 <changed> paragraph: Applied 1
```

The default command is a symptom detector, not a decision that every dispatched click should count as success. After the product decision, its assertion must be adapted to that decision.

Two further commands preserve structured evidence and exit 0 when their fixture checks pass:

```sh
pnpm -C packages/ayme exec node diagnostics/issue-957/run.mjs --matrix
pnpm -C packages/ayme exec node diagnostics/issue-957/run.mjs --probe
```

`--matrix` checks Browser Tool, Page Object Action, raw Lite, and host Playwright. It then varies only work scheduling for raw Lite and host, and runs a host control with timeout disabled. `--probe` records only protocol method names, IDs, timestamps, and mouse event types. It uses the installed Playwright version's private debug hook; no evaluation scripts or protocol result payloads are retained.

The runner binds only `127.0.0.1:19570`, refuses a port collision, and closes its browser and Vite server even when its assertion fails. It rewrites `repro.json`, `matrix.json`, or `host-protocol.json` in this directory. No login, application backend, network response, animation, framework, screenshot, or authenticated artifact is needed.

On a fresh installation, run these setup commands in Devbox first:

```sh
pnpm install --frozen-lockfile
pnpm -C packages/core build
pnpm -C packages/webmcp build
```

The installed Playwright Chromium must also be available. This investigation used the existing local installation.

## Fixture and versions

[fixture.ts](fixture.ts) owns two elements, a button and a paragraph. The click increments a counter, writes `Applied 1`, records the effect time, then spins for the selected duration using `performance.now()`. Every case verifies exactly one click and that the requested work actually ran. The Page Object Action does only `page.locator("#apply").click()`.

- Prepared base: `d75498f21726055407dfea69b26bfd8cf697bb94`. The original runtime-seam reproduction ran red twice here; one output is [baseline-d75498f2.log](baseline-d75498f2.log). Those earliest runs used the Browser Tool's selector addressing and inspected the thrown error's Change Record. The retained final runner uses Structural Ref addressing and actual WebMCP publication.
- Current main: `a55e9d15fed89156c80765bc72e729c47ce4fbc4`. This worktree was fast-forwarded to it, without an authored commit. Both subsequent merged changes, #1060 "feat: list each tool's Agent Description beside its author's" and #1062 "fix(ayme): show and keep Page Object Root Marks in the Goal Loop's page", are included in the runs.
- Reported source version: `a805c3a`. Its Formbricks run is reported evidence, not an environment accessed in this investigation.
- Ayme source package: `0.1.0-alpha.0` at the commits above.
- Playwright Lite: `0.9.4`, fork tag `ayme-2026-10-27`, pinned commit `2b8849cfb31714353d94e6a33095ac3aa5b898bb`.
- Host Playwright and Playwright Test: `1.64.0`; Chromium `156.0.8078.4`, headless.
- Node `24.21.0`, pnpm `11.24.0`, Vite `8.3.0`.

The later Lite pin is already included. #1056 "fix(ayme): pin the playwright-lite fork synced to Playwright Lite 0.9.4" merged as `c9cfa6f8`; the report still reproduces with that pin. #849 "On a page that renders at a low frame rate every click fails with \"Element is not stable\" after the 1-second action timeout" is a different, pre-dispatch observation. Here the captured click handler proves dispatch and effect before the failure.

## Measurements and tested hypotheses

Representative milliseconds from the retained [matrix.json](matrix.json), relative to each call's start. All four fast controls succeeded and applied exactly once. All four slow synchronous cases applied exactly once and timed out at the same configured 1000 ms budget.

| Path                          | Fast return | Slow effect | Slow handler completes | Slow response |
| ----------------------------- | ----------: | ----------: | ---------------------: | ------------: |
| Browser Tool via WebMCP       |         379 |         128 |                   1528 |   1788, error |
| Page Object Action via WebMCP |         302 |          61 |                   1461 |   1715, error |
| Raw Lite                      |          55 |          59 |                   1459 |   1461, error |
| Host Playwright               |          48 |          46 |                   1446 |   1000, error |

Host timing is measured in Node before the later DOM read. Epoch times align that result with the renderer's `performance.timeOrigin`. Assertions prove the effect preceded the host timeout and the handler completed after it. A DOM read alone, issued after waiting for the renderer to unblock, would not prove that ordering.

The three ranked hypotheses were stated in thread commentary before testing:

1. **Lite checks its deadline after synchronous dispatch completes. Supported.** Raw Lite alone reproduces. The preserved error stack names `PageImpl.assertActionDeadline` called by `PageImpl.performPointerAction`. In the installed bundle, `dist/locator-B74v-BQd.mjs:21051`, this is the check after awaiting pointer input and stopping the hit-target interceptor, before logging `click action done`. The DOM effect happens about 59 ms into the call, the handler ends around 1459 ms, and Lite rejects around 1461 ms. No post-click navigation or settle wait is necessary.
2. **A separate post-input wait is necessary. Refuted for this fixture.** The button's synchronous handler is sufficient. Moving the same 1400 ms work into a microtask still times out in raw Lite and host. Moving only that work into `setTimeout(..., 0)` let both clicks finish first in these runs, around 62 and 45 ms respectively, and the harness subsequently waited for and verified the full work. That scheduling observation is not a proposed workaround or a general ordering guarantee.
3. **Ayme's settlement or Change Record wrapper causes the click timeout. Refuted.** Raw Lite reproduces without a runtime. Both wrapped paths propagate that error. Ayme then waits roughly another 250 ms and captures the DOM effect. The actual WebMCP result contains both `isError: true` and `Applied 1` in `changes`.

The host comparison also rules out calling this timeout itself a Lite parity defect. With `{ timeout: 1000 }`, host Playwright fails on the same applied click. Its default Page action timeout is unlimited outside a test timeout; the matrix's explicit `{ timeout: 0 }` control succeeds in about 1448 ms. Equal budgets are necessary for comparison. This is evidence about existing behavior, not a recommendation to raise Ayme's budget.

## Causal chain and ownership

1. **App trigger:** the handler changes the DOM and occupies the main thread. The fixture proves 1400 ms of post-input work alone is sufficient. It does not diagnose why Formbricks's actual table renders slowly.
2. **Lite completion:** input dispatch runs page handlers and microtasks. At its post-pointer check, wall-clock elapsed time has exceeded the action deadline, so Lite throws. Its in-page deadline check cannot run while that same thread is busy.
3. **Host completion:** [host-protocol.json](host-protocol.json) shows mouse move, press, and release sent together. The mouse-release acknowledgement remains pending while the click handler runs. The independent host timer rejects near 1000 ms; the acknowledgement arrives only after the handler ends. The click's DOM effect is already present before the host error response.
4. **Ayme result:** [browserPage.ts](../../src/page-objects/infrastructure/browserPage.ts) supplies the 1000 ms default. [pageStateSession.ts](../../src/page-state/application/pageStateSession.ts) settles a failed `perform`, captures the after state, attaches its Change Record, and rethrows. [synchronize.ts](../../../webmcp/src/synchronize.ts) converts the thrown error into `isError: true` while preserving that record. Thus the transport faithfully exposes a timeout whose click already took effect.

The click timeout and call-log stopping point match host Playwright under equal budgets. A change to the agent's interpretation or representation of that outcome belongs in Ayme. A future measured Lite/Playwright behavioral difference must follow the fork's upstream parity rules, rather than adding an Ayme-only divergence to Lite.

## Regression seam and next decision

The smallest Ayme regression seam is a real Chromium browser test beside `src/runtime/toolFailures.browser.test.ts`, with a button whose handler records its effect before doing controlled long work, a baseline snapshot, and a default-timeout Browser Tool call through `agentTools()`. It must check both the actual click count/DOM effect and the returned outcome plus Change Record. Existing WebMCP serialization tests cover the error envelope; the retained runnable diagnostic also exercises the complete published envelope. A pure error-format unit test, mocked timer, disabled button, or test asserting only a timeout would miss the reported symptom.

The preserved command intentionally stays red until the public contract is decided. Then derive the regression expectation from that decision: the issue's alternatives include successful dispatch with later uncertainty, or an explicit error that distinguishes performed input from incomplete completion. Do not infer either from a changed DOM alone: a Page Object Action may contain more interactions or waits after its first click. Raw input execution evidence would need to cross the Lite/Ayme boundary if the chosen contract promises to identify dispatch reliably.

The reported `ResponseCardModal.next` failure names `locator.waitFor`, not `locator.click`. This fixture establishes the click-timeout cause only. Diagnosing that later wait requires its Page Object method and awaited condition, or a faithful captured fixture. The original Formbricks session and those methods were not accessed.

Useful artifacts: [run.mjs](run.mjs), [fixture.ts](fixture.ts), [repro.log](repro.log), [repro.json](repro.json), [matrix.json](matrix.json), [host-protocol.json](host-protocol.json), and the fetched [issue and complete comment snapshot](issue-957.json). There is no production instrumentation or production diff to clean up. No commit, push, PR, issue mutation, or PR watch was performed.
