#959 "A Page Object action that opens a Radix submenu and clicks its item fails: the submenu closes before the click lands"

Investigation only, 2026-10-28. No production change, commit, PR, label change or workaround is included.

The original **Ayme/Lite failure with host Playwright succeeding is not reproduced**. The default real Radix fixture passes through all three drivers. The visible "item found, then gone" symptom does reproduce when the submenu flips left, but host Playwright fails too. Do not close #959 as fixed by #962 on this evidence. There is no demonstrated remaining Lite-specific pointer defect, and the historical cause is unproven.

Run from the repository root:

```sh
devbox run -- sh diagnostics/issue-959/reproduce.sh
```

This command builds the workspace packages from this checkout, installs the isolated fixture dependencies if needed, starts the fixture and MCP server on dynamically allocated loopback ports outside Ayme's scan range, runs six selections, asserts a fresh `inProgress` to `completed` transition and a selection event, saves `evidence/latest.json`, and closes its processes. Browser actions have a 3 s failure deadline rather than the report's 30 s; the timeout changes failure latency, not the pointer sequence. A cached run takes seconds. The workspace's Playwright Chromium must be installed.

Last output, with no credentials or pairing links captured:

```text
host hover: open 60 ms, select 303 ms, completed
lite hover: open 37 ms, select 270 ms, completed
ayme hover: open 423 ms, select 535 ms, completed
host click: open 43 ms, select 79 ms, completed
lite click: open 36 ms, select 151 ms, completed
ayme click: open 410 ms, select 407 ms, completed
PASS 6 real Radix submenu selections
```

The red-capable control uses the same real Radix menu and the same two-line Page Object Action. Only the viewport changes:

```sh
devbox run -- env WIDTH=640 MODES=hover EVIDENCE=left-recheck sh diagnostics/issue-959/reproduce.sh
```

Already run, exit 1:

```text
host hover: 3048 ms, inProgress, locator.click: Timeout 3000ms exceeded.
lite hover: 3071 ms, inProgress, TimeoutError: locator.click: Timeout 3000ms exceeded. No elements found ...
ayme hover: 3331 ms, inProgress, TimeoutError: locator.click: Timeout 3000ms exceeded. No elements found ...
AssertionError: 3/3 submenu selections failed; see the saved event evidence
```

The saved call log first resolves the real `menuitemradio`, then records its detachment. Event evidence records the trigger open and item present, trigger-to-item pointer-out, submenu closure, and no item pointer-down or selection. This demonstrates that the command catches the reported visible symptom; the host result prevents mistaking this control for the original differential failure. No synthetic dismissal timer or `dispatchEvent` workaround is used.

The fixture follows the Formbricks report's menu tree and call chain. `SurveyList.ts` is compiled by the real Ayme Vite plugin. A stdio MCP SDK client starts the built `ayme mcp`, pairs the browser tab, calls the rooted `SurveyRow.openOptions`, then the rootless `SurveyList.setCompleted`. That action does `trigger.hover()` or `trigger.click()`, immediately followed by the completed radio item's `click()`. Raw Lite directly invokes the same compiled Page Object method with `createPage()`. Host Playwright runs the same locator sequence in the same Chromium tab, with a fresh document and neutral native pointer position for every case. Each row has two availability predicates that read a role locator's link `href`, matching #962. Modal blocking, hover-open delay and pointer grace come from Radix itself.

The menu uses controlled open state, a modal root, portalled outer content, an inline SubContent with an 8 px gap, a RadioGroup, and prevented item `onSelect` followed by controlled closure in `onValueChange`. These match the public Formbricks component and wrapper at the report's submodule pin. The actual Formbricks app was unavailable: its submodule directory is empty here. Backend requests, the original full stylesheet and its entry animations are not recreated. The original run-4 `calls.jsonl`, screenshot, viewport and live app were not supplied. These are limits on historical attribution.

Baselines:

- Checkout: `d75498f21726055407dfea69b26bfd8cf697bb94`.
- Remote main checked live: `a55e9d15fed89156c80765bc72e729c47ce4fbc4`, two commits ahead. #1060 "feat: list each tool's Agent Description beside its author's" changes descriptions; #1062 "fix(ayme): show and keep Page Object Root Marks in the Goal Loop's page" changes Goal Loop structure/terminology. Their complete file list and relevant diffs are saved. Neither changes the pointer implementation, availability guard, interaction instrumentation or submenu action execution. This is a test of the prepared checkout with those merged changes accounted for, not a claim to have checked out remote main.
- Ayme and MCP: `0.1.0-alpha.0`, built from this checkout.
- Lite: `0.9.4`, immutable fork pin `2b8849cfb31714353d94e6a33095ac3aa5b898bb`.
- Host Playwright: `1.64.0`; Chromium `156.0.8078.4`; Node `24.21.0`; pnpm `11.24.0`.
- Fixture: `@radix-ui/react-dropdown-menu` and its menu implementation `2.1.16`, React/React DOM `19.2.6`, pinned by `vendor/package-lock.json`. These are the report's Formbricks versions, not the workspace aggregate's newer dropdown-menu `2.1.24`.
- Formbricks report pin `211ad704de30aabf96c059cc1cf00391d5b63a27`; current submodule pin `bf06fa583733c61334ede3e13b311fb9d89644af`. The two intervening commits do not change the menu component, wrapper or catalog versions.

The ranked hypotheses were shown in thread commentary before the controlled experiments:

| Hypothesis and prediction                                                                                                            | Own-run result                                                                                                                                                                                                                                                           | Verdict                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| #962's observation delay caused or exposed the submenu failure. Replaying its old guard restores slowness and may restore dismissal. | The old guard restores four serial ~1001 ms hidden predicate reads while opening one row. At seven rows, opening takes 28.2 s and the hover/click-item action 14.6 s. Selection still succeeds. Current one-row calls open in 0.4 s; covered predicates are never asked. | Performance mechanism confirmed. Slowness alone is insufficient to reproduce dismissal here.        |
| Lite has a pointer-path defect. A left-opening submenu fails in Lite/Ayme while host succeeds.                                       | Normal layout passes 30/30 at seven rows and 12/12 at fifteen. Narrow layout fails equally in all three drivers, including the red recheck.                                                                                                                              | No Lite-specific differential found.                                                                |
| Ayme instrumentation disrupts the submenu. Ayme fails while raw Lite succeeds.                                                       | Ayme and raw Lite have the same selection outcome in every configuration. Default pointer logs show item pointer-down before closure; no predicate runs behind the modal.                                                                                                | Not supported.                                                                                      |
| Formbricks version/layout supplies a missing trigger. Matching the pinned version/tree may expose a failure.                         | The faithful pinned-version normal fixture passes. Left-opening layout exposes the shared failure; making overflow visible does not prevent it.                                                                                                                          | Layout matters, but no evidence of an Ayme-only app condition. Full app/animations remain untested. |

For the shared left-opening control, Radix `react-menu` remembers a horizontal pointer direction, initially `right`. Trigger-to-item movement to the left dispatches pointer-out before the new pointer-move can update that direction. Radix's item-leave handler then sees no movement toward its left-side grace area, focuses the parent content, and its submenu focus-out handler closes the submenu. This is supported by the installed library code, the event ordering, and a one-variable direction control: move right within the trigger, then back to the same center before clicking the item. With `WIDTH=640 PRIME=left`, all 18/18 selections pass across host/Lite/Ayme, with no sleeps or fake click. The control is diagnostic only and is not proposed as public behavior or an app workaround.

Responsibility is therefore split:

- Ayme owned the confirmed serial predicate cost. #987 "fix(ayme): skip availability predicates of a root a click would not reach", merged 2026-10-24 at `b3a7061a41c4f0a2215c0324a39d24fac5545841`, fixed that mechanism and is an ancestor of this checkout. Restoring only its guard in Vite's served bundle proves the timing change without editing production files.
- The observed narrow-viewport dismissal is shared Radix pointer-direction/focus behavior. Plain Playwright fails on the same DOM; the current evidence does not assign it to Lite or to Ayme instrumentation.
- The original Formbricks-only differential remains unassigned. Its menu layout and full animation/input history could matter; they are not established causes.

Suggested next action: retain this harness as the regression seam, then replay the original run-4 step on the actual app at its original viewport while logging both native and Lite pointer events. Determine whether it opens left, its last horizontal direction, and whether any wait occurs between trigger pointer-out and item pointer-down. Obtain the original trace or live app before deciding to close #959 or opening a Lite fix. If the shared Radix condition deserves separate work, first reproduce it in an app-only Radix fixture with the entry animations, independent of Ayme. Public behavior and upstream issue decisions remain with the owner.

Useful artifacts:

- `run.mjs`, `reproduce.sh`, `SurveyList.ts`, `main.tsx`: runnable harness, actual call chain, fixture and event capture.
- `vendor/package.json` and `vendor/package-lock.json`: isolated exact fixture versions; no workspace manifest or lockfile change.
- `evidence/formbricks-7-rows.json`, `current-15-rows.json`, `current-1-row.json`, `latest.json`: positive controls, timings, availability and pointer events.
- `evidence/left-recheck.json`, `left-minimal.json`: shared disappearing-item failure, including one-row repetition.
- `evidence/left-primed.json`, `left-overflow-visible.json`: pointer-direction and overflow controls.
- `evidence/old-availability-1-row.json`, `old-availability-7-rows.json`: replayed pre-#987 guard, with predicate durations.
- `evidence/sources.json`: live issue bodies and all comments, fixing PR, remote-main comparison, Formbricks and Lite pin comparisons. Refresh with `devbox run -- node diagnostics/issue-959/collect-sources.mjs`.

Further runs can set `ROWS`, `REPETITIONS`, `DRIVERS=host,lite,ayme`, `MODES=hover,click`, `WIDTH`, `GAP`, `ROW_WIDTH`, `OVERFLOW=visible`, `PRIME=left`, `OLD_AVAILABILITY=1` and `EVIDENCE=<name>`. `OLD_AVAILABILITY` changes only the served diagnostic copy of the exact guard and asserts that it was applied. Default runs exercise current behavior. There is no tagged production instrumentation to remove.

Public source links: [#959 and its report/comment](https://github.com/ayme-labs/ayme/issues/959), [#962 and its measurements](https://github.com/ayme-labs/ayme/issues/962), [#987 and its diff](https://github.com/ayme-labs/ayme/pull/987), [Formbricks menu at report pin](https://github.com/ayme-labs/formbricks/blob/211ad704de30aabf96c059cc1cf00391d5b63a27/apps/web/modules/survey/list/components/survey-dropdown-menu.tsx), [Formbricks wrapper at report pin](https://github.com/ayme-labs/formbricks/blob/211ad704de30aabf96c059cc1cf00391d5b63a27/apps/web/modules/ui/components/dropdown-menu/index.tsx).
