# Investigation of #1021

2026-10-28. Investigation only. No fix, commit, push, PR, issue mutation, public-behavior decision, or production instrumentation.

[#1021 "A page with 1,200 items freezes for over a minute in the runtime's selector engine"](https://github.com/ayme-labs/ayme/issues/1021) is reproducible as quadratic collection-observation work on current remote main. The 1,200-row, 73-second long task is reported evidence, not a measurement repeated here. This investigation reproduces the same work pattern at 4–96 rows, exercises a real runtime `hover`, and profiles one 192-row observation.

The main finding is an Ayme call-pattern problem. One registry observation re-executes the collection selector `6n + 1` times for `n` rooted items with one Locator member each. Each resolution enumerates a list/page whose size grows with `n`. The equivalent operations in real Playwright produce exactly the same native DOM-query counts as Lite. No Lite parity defect was established.

## Run

From the repository root, in a persistent `devbox shell`:

```sh
node investigations/issue-1021/run.mjs repro
```

The one-command wrapper outside that shell is:

```sh
devbox run -- node investigations/issue-1021/run.mjs repro
```

Prerequisites for a fresh prepared worktree:

```sh
pnpm install --frozen-lockfile
pnpm --filter @ayme-dev/core build
```

Chromium must be installed for the repository's Playwright. It was already available here. No credential, model key, external app, or authenticated page is used. The driver binds only `127.0.0.1:47321`, fails if that port is occupied, and closes its browser and server on completion. Each mode overwrites its own JSON evidence file in this directory.

The repro is intentionally red, exits 1 in about a second with dependencies ready, and asserts a work budget: doubling rows may increase native selector candidates by at most 2.5×. This is a diagnostic target for linear growth, not an approved product performance contract. Root identities and collection counts are checked independently, so silently losing the Page Objects cannot make it green.

Abbreviated actual output, with no secret-bearing fields:

```text
rows=12 observations=1 qsaCalls=255 candidates=4915 observedRows=12
rows=24 observations=1 qsaCalls=507 candidates=18463 observedRows=24
candidate growth = 3.756x
AssertionError [ERR_ASSERTION]: #1021 RED: 4915 -> 18463 selector candidates for 2x rows
exit 1
```

The full output is in `standalone-repro.txt`; the structured result is `repro.json`.

Other modes use the same command with its last argument replaced:

| Mode      | Purpose                                                                                              | Expected exit now    |
| --------- | ---------------------------------------------------------------------------------------------------- | -------------------- |
| `minimal` | 4 versus 8 plain rows, no Locator members or actions                                                 | 1, intentionally red |
| `matrix`  | Vary one fixture setting at a time, targets, snapshot, hover, removal                                | 0                    |
| `parity`  | Replay the observed root/member reads on Lite and real Playwright, assert identical DOM-query counts | 0                    |
| `timing`  | Three repetitions per size and selector, without count instrumentation                               | 0                    |
| `profile` | Chromium CPU profile of one measured observation after setup                                         | 0                    |
| `control` | Diagnostic light-DOM-only unique-root control, same registry, assert linear growth                   | 0                    |

## Baselines and current-main check

The supplied worktree began at `d75498f21726055407dfea69b26bfd8cf697bb94`. I fetched remote main and fast-forwarded this investigation branch to `a55e9d15fed89156c80765bc72e729c47ce4fbc4`, then reran the red case. Remote main still pointed there at final verification.

Two merges lie between them: #1060 "list each tool's Agent Description beside its author's" and #1062 "show and keep Page Object Root Marks in the Goal Loop's page". `merged-commits.txt` records their SHAs. `merged-registry-diff.txt` shows that the registry changes rename labels to marks; the collection walk, root observation, Lite driver, and Lite pin are unchanged. The initial 4/8-row Vitest document produced exactly 544/1,452 candidates both before and after the update. The retained standalone fixture has fewer document elements and produces 323/1,023 for that minimized case. Candidate counts depend on fixture DOM size, so results from those two documents should not be conflated.

Measured environment in `versions.json`:

- macOS arm64; Node v24.21.0; pnpm 11.24.0.
- Playwright 1.64.0; headless Chromium 156.0.8078.4.
- Playwright Lite package version 0.9.4, exact Ayme fork pin `2b8849cfb31714353d94e6a33095ac3aa5b898bb`.
- Vitest 4.1.11 for the initial feedback loop; the retained driver uses existing Vite and Playwright dependencies directly.

The issue's comparison with older build `7f1b9279` is reported evidence. I did not recreate that older build or infer that this is a recent regression.

## Fixture and measurement

`fixture.ts` renders an `h1` and a named `ul`, with one `li` and one button per row. It registers compiler-equivalent metadata for `ProjectsPage` through the real registration mechanism and starts the normal runtime. A collection method uses the reported locator:

```ts
page.getByRole("list", { name: "Projects" }).locator(":scope > li").all();
```

Each returned `nth()` locator anchors a rooted `ProjectRow` with one button Locator member and three actions. Action bodies are empty because the reported trigger is a Browser Tool on a static heading, not a Page Object Action. Framework rendering, Inspector, WebMCP publication and the MCP transport are absent; registry observation, real reach measurement, capture, Run queue and Browser Tool execution are present. The `hover` uses `ayme.tools.run` with Caller `ayme-mcp`, the page-side entry used by MCP.

The fixture first completes initial observation and checks roots. Only a subsequent explicit observation or operation is counted. Diagnostic wrappers count calls to Lite's actual page resolution methods and native `Document`/`Element.querySelectorAll`; every wrapper is restored in `finally`. `candidates` is the sum of returned native NodeList lengths, including repeated visits. It is not a count of unique elements or every internal engine instruction. Timing mode installs no wrappers.

Minimization, performed before hypothesis tests, removed actions, then Locator members, then buttons, then reduced the row count. All stayed red. Four versus eight plain rooted rows remain red at 323/1,023 candidates. With no registered Page Objects, an explicit probe performs zero selector work.

## Hypotheses and evidence

The ranked predictions were posted in the thread before testing.

| Prediction                                                                      | Result                                                                                                                                                                |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repeated root reads cause a fixed number of full collection resolutions per row | Confirmed: four root resolutions per row, even with no member or action                                                                                               |
| Locator members add repeated resolutions of the same collection prefix          | Confirmed: one member adds two resolutions per row; removing it at 24 rows changes 18,463 candidates to 12,319                                                        |
| Role lookup raises the constant, while CSS retains quadratic work               | Confirmed: 24-row CSS uses 11,213 candidates versus role's 18,463; both redo the collection prefix                                                                    |
| Lite performs additional traversal beyond equivalent real Playwright operations | Not supported in these cases: exact per-selector DOM-query parity for role and CSS at 12 and 24 rows                                                                  |
| Multiple full observations amplify a static agent call                          | Confirmed: one unchanged-heading hover performs three complete observations, 55,551 candidates at 24 rows; no Page Objects gives zero observations and 162 candidates |

Removing all three actions leaves the 24-row work exactly unchanged. A target-list read without a new observation still performs `2n` resolutions, 6,120 candidates at 24 rows. The existing `resolveTargets` cache deduplicates the same Locator object within that read, but distinct `nth()` roots and member locators still share an expensive selector prefix.

Replacing each `nth()` root with a unique CSS ID reduces the 24-row total to 7,951 candidates but still scans the document to discover shadow roots. As a diagnostic control only, explicitly light-DOM ID roots produce 163/319/631/1,255 candidates at 12/24/48/96 rows. This changes selector semantics and is not proposed as a product fix. It demonstrates that the registry's other work does not require quadratic traversal on this fixture.

After removing the first row between observations, the real watcher/probe path sees 23 rows with the correct remaining root identities. It performs the allowed follow-up observation, two observations total. Nothing is cached between calls by this investigation.

## Attribution to actual work

The observed `6n + 1` decomposition is:

| Owner and read                                             | Full selector resolutions |
| ---------------------------------------------------------- | ------------------------- |
| App collection's `all()`                                   | 1                         |
| Ayme root observation's `count()`                          | n                         |
| Ayme root observation's initial `resolveLocatorElements()` | n                         |
| Ayme reach measurement's `isVisible()`                     | n                         |
| Ayme root observation's final identity recheck             | n                         |
| Ayme member/root comparison's `elementsOf()`               | n                         |
| Ayme member count's `count()`                              | n                         |

Relevant code on the checked main:

- `packages/ayme/src/page-objects/infrastructure/pomRootObservation.ts:17`: count, initial resolution, and final identity recheck.
- `packages/ayme/src/page-state/infrastructure/reachMeasurement.ts:189`: root visibility resolves the locator again before geometry.
- `packages/ayme/src/page-objects/application/pomTreeWalk.ts:265`: member/root comparison, then a separate member count.
- `packages/ayme/src/page-objects/application/pomRegistry.ts:391`: every structure capture asks for a new observation.
- `packages/ayme/src/page-objects/application/pomRegistry.ts:426`: targets resolve the observed sources again.
- `packages/ayme/src/runtime/runtime.ts:626`: an additional probe runs after a top-level Run.

For role locators, one repeated prefix enumerates all document elements for role matching, then `li` and all elements again for the CSS evaluator's shadow traversal. The member then reads its one button. In this exact static DOM, the measured totals fit `30n² + 49n + 7` candidates and `21n + 3` native query calls. CSS gives `18n² + 35n + 5` candidates. These formulas describe this fixture, not arbitrary pages.

Lite's `_queryCSS` concatenation appears in the reported profile because it handles the repeated DOM queries. With no shadow roots in this reproduction, a single resolution does linear traversal. The quadratic factor comes from asking for that traversal linearly many times. Ordinary Playwright also returns live `nth()` locators from `all()` and repeats these traversals for the same reads. Making Lite retain results across separate locator operations would change that behavior.

The three hover observations are the action's before capture, its after capture and the runtime's post-Run probe. `snapshot` performs one observation. Inspector can add consumers, but it is unnecessary for the demonstrated cost.

The parity replay substitutes `evaluateAll` for Lite's synchronous element resolution, keeping the same full selector resolution and cardinality. Real Playwright runs these reads in both its utility and main worlds. Both worlds are instrumented and their counts summed. Recording only the utility world would falsely make Playwright appear to do half the work. This comparison tests traversal parity for these cases, not all Lite semantics. Native Playwright timings include protocol transport and should not be compared directly with Lite timings.

## Timings and profile

Uninstrumented medians of three runs, one completed observation:

| Rows | Role ms | CSS ms | Measured role candidates |
| ---- | ------: | -----: | -----------------------: |
| 24   |     7.4 |    3.3 |                   18,463 |
| 48   |    24.0 |    8.8 |                   71,479 |
| 96   |    66.7 |   23.3 |                  281,191 |
| 192  |   269.7 |   93.6 |  not counted in this run |

The simple fixture has far fewer descendants and less application work than the reported bench page. These timings substantiate the curve; they do not replace the issue's measured 73-second task or its 306-row hover. At 24 rows the settling wait dominates hover wall time, so its Page Object and plain-page times are similar despite very different work counts.

`profile.cpuprofile` is a Chromium profile of one uninstrumented 192-row role observation, measured at 283.4 ms, after setup finished. `profile-summary.json` has sampled inclusive time: `queryAll` 258.6 ms, `resolveAll` 224.2 ms, `observePomRoot` 177.4 ms, `getAriaRole` 141.4 ms, `walkMembers` 90.5 ms, `count` 88.0 ms, `isVisible` 43.1 ms and `measurePomRoot` 48.0 ms. Inclusive times overlap and must not be added. Inlining can remove helper names such as `_queryCSS` from samples; native-query counters establish that work independently.

## Next action and unresolved decisions

The next implementation brief belongs in Ayme. Preserve the real registry/observation reproduction and add a deterministic budget at that seam. Reduce repeated resolution of shared collection prefixes and repeated root/member reads within a completed observation. Merely reducing four root reads to two improves a constant and still leaves quadratic work. Fewer post-action observations can remove another multiplier but also cannot alone change the exponent.

Before choosing an implementation, settle these questions:

1. How can one observation reuse resolved roots/prefixes while preserving count, presence, availability, member association and final root-identity checks?
2. What revalidation is required across awaited root/presence/action predicates or reach measurements where the page may change?
3. Can the completed after-capture observation also satisfy the post-Run publication probe without missing state changes?
4. Which deterministic work budget is intended for ordinary light DOM and shadow DOM? The current 2.5× check is only an investigation threshold.

Keep fresh resolution between calls and preserve changing-page behavior. Do not add a cross-call locator cache or replace live locators with saved element identities by default. Any future independently demonstrated Lite/Playwright mismatch belongs upstream in `enekesabel/playwright-lite` under the fork rules; this investigation does not justify a fork behavior change. The app's reported `all()`/`nth()` pattern is valid Playwright usage, so app rewrites are not required to own the Ayme observation cost.

The retained diagnostic is a useful regression seam. Investigation scope ends with it red and the cause attributed. No fix was attempted or claimed. All changes beyond the fast-forward are local investigation files, and no production debug instrumentation remains.
