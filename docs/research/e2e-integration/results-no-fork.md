# No-fork Ayme-e2e integration: results

Status: done (2026-10-06, afternoon). Free stand-in part and paid multi-act part with the Claude Code driver, both on unmodified e2e.

## Setup

- Clean e2e checkout at 5e032d95 (the spike's base) in `<local>/e2e-clean`, local branch `ayme-nofork`. `git diff -- packages` is empty: nothing in e2e's source changed. Only `apps/ayme-e2e` and the lockfile were added. The forked spike (`e2e-spike`) is untouched.
- Package `apps/ayme-e2e/src`:
  - `ayme-tools.ts`: Ayme page object methods as e2e tools (top-level classes only), 5 s limit when the store replays a call.
  - `store.ts`: per-test and shared (instruction + tool) lookups, args templated by matching parameter values, repair proposals. Lives in `.e2e/ayme/` next to e2e's cache.
  - `ayme-executor.ts`: custom `StepExecutor` with `cache: 'inherit'`: store first, then the solver.
  - `agent-solver.ts` + `claude-code-driver.ts`: the agent-driver seam (start a session per test, send a message per act, receive tool calls, close). Only the Claude Code driver exists.
- Harness: `apps/ayme-e2e/harness`.

## What stock e2e records for a page object step

- Through `ctx.budgets.runTool`: a one-action gap entry, `[{"name":"tool","summary":"tool ProjectsPage_createProject"}]`, with the end anchor `listitem {{param:/name}}`. On the next run e2e reports `missed/gap` and calls our executor. This is the path the executor uses: it keeps e2e's action budget, queue and report events, and the gap entry does no harm.
- Calling the page object directly on the Playwright page: e2e records nothing, and every run is `missed/no-entry`.

## Free stand-in, 3 single-act tests ("create a project"), read-write cache

Sources: e2e = e2e's own replay; store = our store (per test or shared); solver = the stand-in, which stands for a model re-solve.

| Phase | Stock arm | Ayme arm |
|---|---|---|
| Record | e2e 3 missed, solver 3 | e2e 3 missed; solver 1 (stored), store-shared 2 |
| Replay | e2e replayed 3 | e2e missed/gap 3; store-test 1, store-shared 2, solver 0 |
| After rename | e2e target-not-found 3, solver 3 (clicks re-recorded) | e2e missed/gap 3; solver 3 after "locator.click: Timeout 5000ms exceeded"; store unchanged (md5); 3 repair proposals; 21 s (187 s before fail-fast) |
| After POM fix | (re-run) e2e replayed 3 | store-test 1, store-shared 2, solver 0 |

Shared entry example: `{"tool":"ProjectsPage_createProject","args":{"name":{"$param":"name"}}}`. Tests 2 and 3 replayed test 1's entry in the record phase, so one re-solve covered three tests.

## Weaker than the fork, or not as designed

1. Repair proposals carry only the fallback's verbs (`tap, type, tap`), not the controls. The executor doesn't see e2e's target descriptors; it could look them up in the observation when it records an action. Not done.
2. A shared hit doesn't write a per-test entry, so later runs keep hitting the shared one. Harmless.
3. From the design: e2e's cache report counts these steps as gaps, `--strict-cache` flags them, no end-anchor check beyond the method's own wait and the test's assertion.

## Paid: multi-act record and replay with the Claude Code driver

2 tests x 3 acts (same tests as results-multi-act.md), Sonnet, read-write. All 8 test runs passed, 4 sessions, about $0.13 by SDK estimate, no re-runs.

| Arm / phase | Sessions | Acts Claude handled | Cost | Where each of the 6 acts came from |
|---|---|---|---|---|
| Stock, record | 2 | 6 | $0.078 | e2e missed 6, Claude 6 (clicks) |
| Stock, replay | 0 | 0 | $0 | e2e replayed 6 |
| Ayme, record | 2 | 4 | $0.050 | Claude 4, our store (shared) 2 |
| Ayme, replay | 0 | 0 | $0 | e2e replayed 1 (the "Unmount counter" click), our store 5 (3 per-test + 2 shared) |

Ayme record, act by act:

- T1 "create a project": Claude, `ProjectsPage_createProject` (session started).
- T1 "increment twice": Claude, `CounterPage_increment` x2.
- T1 second "create a project": our store, from the shared entry recorded two acts earlier in the same test. No Claude turn.
- T2 "create a project": our store (shared). No session yet: T2's session started lazily at its second act.
- T2 "remove the counter": Claude, a click. e2e caches it.
- T2 "bring it back and increment once": Claude, tap "Mount counter" + `CounterPage_increment`. Stored with `grammarBefore: 1`.

Replay:

- Every page object step reached us as e2e `missed/gap` and was served by the store.
- The mixed act worked as designed: e2e replayed tap "Mount counter", handed off at the gap (`replayedPrefix` = that tap), and the store finished it with `CounterPage_increment`, without Claude.

## Summary

- Unmodified e2e plus our executor and store reproduces the patched fork's results.
- The shared store goes further: a step shared across tests, or repeated within a test, is solved once.
- Shortfalls: repair proposals carry only verbs, not controls; shared hits don't write per-test entries; e2e's "AI tokens" column shows 0 because the driver reports cost, not token counts, to e2e.

## State on the Mac

- Dev server stopped by PID; no token appears in any output.
- `e2e-clean`: only `apps/ayme-e2e` and the lockfile added; `packages/` unmodified.
- `ayme-e2e-spike` worktree: only the earlier example-react ProjectsPage addition. UI and page object are at "New project".
- Nothing committed. Logs and store: `e2e-clean/apps/ayme-e2e/harness/.e2e/` (`out/`, `ayme/`).
