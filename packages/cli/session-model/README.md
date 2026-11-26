# Session model

A statechart of one ayme Session, checked against the rules the owner agreed
for it before it is built. It is a design check: no code implements it yet, so
every verdict is about the agreed rules and the most direct design that follows
each one, not about ayme's code. The folder's location is a placeholder.

## Files

- `session.json`: the statechart, an XState v6 config. Parallel regions:
  `browser` (its two Tabs, the window being hidden, dialogs and navigation),
  `life` (no Session, a Session starting, or a running Session with its
  `pageObjects`: ready, rebuilding, or a built set waiting for its Swap),
  `opener` (`ayme open` and `ayme attach`), `agent` (the other `ayme`
  commands) and `inspector` (Runs started from the Inspector). A Run's action
  that a dialog stopped is the context variable `s1`/`s2` of its Tab: `1`
  while blocked under the dialog, `2` once the dialog closed and the action is
  ending.
- `rules.mjs`: writes the three rules files. Each checks the same statechart
  with a different group of outside events switched on, so each run stays
  small: `runs` (rules 1, 3, 4, 5, 6, 7, 9, 12), `lifecycle` (1, 2, 10, 11, 12) and `ids` (8, 9). Each file lists its assumptions.
- `leads.md`: the lead ledger the model was built from.
- `check.sh`: regenerates the rules files and runs the bundled checker of the
  `stately` skill (`.agents/skills/stately`) on each.

## Run

From the repository root, with a new output folder:

```sh
devbox run -- sh packages/cli/session-model/check.sh /tmp/session-model-run
```

Each focus writes `report.md` and `compact-report.md` under its own folder.
The script exits 1 while a rule is broken. The first run downloads XState
6.0.0-beta.3 (about 0.4 MB, checksum-verified) into the Stately cache. The
three foci take about 80 seconds together.

## How to read a verdict

Outside events (a command, a Run from the Inspector, an edit, a Tab change,
hiding or showing the window, a dialog opening or closing, a navigation, the
browser going away, `ayme open` or `ayme attach`) share a budget of 5 per run.
The Session's own steps and the 100 ms passing are free and weakly fair. A
liveness rule such as "every command gets an answer" therefore asks: once the
outside world stops acting, does the Session answer by itself? A dialog nobody
answers and a window nobody shows again may stay that way forever. A verdict
holds within that budget.

Rules named `HiddenMidRun_*` check a case the owner left without a rule (a Tab
hidden in the middle of a Run), under the reading where a hidden Tab stalls
the Run's page work. `Reach_*` rules show a combination can happen; `Q_*`
rules show a combination the rules leave open; both "hold" when reachable.

When one event moves several regions, the checker keeps only the assignments
of the last region's action. Each event in this model assigns in one region
only; keep it that way when changing the model.

## Verdicts (2026-11-26)

| Rule | Checks                                                                                       | Verdict                                                                                                |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1    | `R1_AgentCommandAnswered`, `R1_InspectorRunAnswered`, `R1_OpenAnswered`                      | holds, where a Run's page work finishes on a hidden Tab                                                |
| 1    | `HiddenMidRun_AgentCommandAnswered`, `HiddenMidRun_InspectorRunAnswered`                     | broken: a Run's Tab is hidden mid-Run and never shown again (no rule yet)                              |
| 2    | `R2_NoSessionWithoutBrowser`                                                                 | holds                                                                                                  |
| 3    | `R3_OneRunPerTab`                                                                            | holds                                                                                                  |
| 4    | `R4_DialogEndsRunAfter100ms`, `R4_StoppedActionEnds`, `R3_OneRunPerTab`                      | holds; that the stopped action does nothing more on the page is not checked (see `leads.md`)           |
| 5    | `R5_DialogAnswersAtOnce_Agent`, `R5_DialogAnswersAtOnce_Inspector`                           | holds                                                                                                  |
| 6    | `R6_HiddenTabFailsAtOnce`                                                                    | holds                                                                                                  |
| 7    | `R7_NoSwapDuringRun`, `R7_BuildIsSwappedIn`                                                  | holds, where a Run's page work finishes on a hidden Tab                                                |
| 7    | `HiddenMidRun_BuildIsSwappedIn`                                                              | broken: a Swap waits behind a Run stalled on a hidden Tab (no rule yet)                                |
| 7    | build line in listings                                                                       | holds by construction: the listing reads a "last finished build failed" flag, not the build's state    |
| 8    | `R8_UniqueAcrossTabs_SessionCounter`, `R8_NeverReusedInSession_SessionCounter`               | holds with one id counter per Session                                                                  |
| 8    | `R8_UniqueAcrossTabs_RuntimePerPageCounter`, `R8_NeverReusedInSession_RuntimePerPageCounter` | broken: ayme's runtime counts ids per page, so two Tabs both give out `po1`                            |
| 8    | `Intended_NewSessionRepeatsIds`                                                              | reachable, as intended                                                                                 |
| 9    | `R9_WorksOnMostRecentTab`                                                                    | holds                                                                                                  |
| 10   | `R10_OpenReportsBuildError`, `R1_AgentCommandAnswered` (lifecycle)                           | holds, with the name check and claim as one step                                                       |
| 11   | `R11_CloseOnlyOwnBrowser`, `R11_DetachRefusedOnOwnBrowser`, `R11_OwnBrowserNeverLeftAlone`   | holds, assuming ayme closes the browser it opened when the first build fails                           |
| 12   | (by construction)                                                                            | holds: a Page Object error ends only its Run or stopped action; no path from an error ends the Session |

Every guard is uncited: the rules are agreed, the code is not written. The
citations point at ayme's runtime where the model leans on it: the per-page
Run queue and the per-page id counter.

## Verdicts (2026-11-25, first round, earlier rules)

The first round checked an earlier set of rules, numbered differently, with
the Inspector's pick and with a call answered early whose page work kept the
Tab's turn. Its broken rules were: a listing waiting behind a call answered
"tab hidden"; a Swap while an answered call's click waited under a dialog; a
listing during a rebuild after a failed build; ids counted per page; ids
reused after a restart (now intended); a pick outliving its window (the pick
is gone). Its model is at commit `c9aaf6413`.
