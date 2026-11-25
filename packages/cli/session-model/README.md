# Session model

A statechart of one ayme session, checked against the rules the owner agreed
for it before it is built. It is a design check: no code implements it yet, so
every verdict is about the agreed rules and the most direct design that follows
each one, not about ayme's code. The folder's location is a placeholder.

## Files

- `session.json`: the statechart, an XState v6 config. Parallel regions:
  `life` (no session, or a running session with the regions `browser`,
  `pageObjects`, `tab` and `inspector`), `agent` (requests from the `ayme`
  commands) and `window` (tool runs from an Inspector window). The Call part
  is the two callers' `callRunning` states plus `orph1`/`orph2`: page work of
  a call the session already answered, which still holds the tab's turn.
- `rules.mjs`: writes the three rules files. Each checks the same statechart
  with a different group of outside events switched on, so each run stays
  small: `requests` (rules 1, 3, 4, 5, 6, 8, 9, the queue half of 11),
  `lifecycle` (2, 10, 11, 12) and `ids` (7). Each file lists its assumptions.
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
6.0.0-beta.3 (about 0.4 MB, checksum-verified) into the Stately cache.

## How to read a verdict

Outside events (a request, an edit, a tab change, a dialog, a window, the
browser going away, a start, detach or close) share a budget of 5 per run. The
session's own steps are free and weakly fair. A liveness rule such as "every
request gets an answer" therefore asks: once the outside world stops acting,
does the session answer by itself? A dialog nobody answers and a tab nobody
shows again may stay that way forever. A verdict holds within that budget.

## Verdicts (2026-11-25)

| Rule | Check                                                     | Verdict                                                              |
| ---- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| 1    | `R1_AgentRequestAnswered`                                 | broken: a listing waits behind a call answered "tab hidden"          |
| 1    | `R1_InspectorRunAnswered`                                 | holds                                                                |
| 2    | `R2_NoSessionWithoutBrowser`, `R2_RecordOnlyWhileRunning` | hold                                                                 |
| 3    | `R3_DialogAnswersWithoutWaiting`                          | holds                                                                |
| 4    | `R4_OneCallPerPage`                                       | holds                                                                |
| 5    | `R5_NoSwapDuringCall`                                     | broken: swap while an answered call's click waits under a dialog     |
| 5    | `R5_RebuildIsSwappedIn`                                   | holds                                                                |
| 6    | `R6_ListingSaysBuildFailing`                              | broken: listing during a rebuild after a failed build                |
| 7    | `R7_UniqueAcrossTabs_SessionCounter`                      | holds                                                                |
| 7    | `R7_UniqueAcrossTabs_RuntimePerPageCounter`               | broken: ayme's runtime counts ids per page                           |
| 7    | `R7_NotReusedAfterRestart`                                | broken: a new session counts from 1 again                            |
| 8    | (by construction)                                         | holds, assuming one first line carries the tab and the build failure |
| 9    | `R9_HiddenTabCallFailsAtOnce`                             | holds                                                                |
| 10   | `R10_CloseOnlyOwnBrowser`                                 | holds                                                                |
| 11   | `R11_PickNeverOutlivesWindow`                             | broken: window closes while its pick is starting                     |
| 11   | queue half, via `R4_OneCallPerPage`                       | holds                                                                |
| 12   | `R2_RecordOnlyWhileRunning` and the start guard           | holds, start check and record claim assumed atomic                   |

Every guard is uncited: the rules are agreed, the code is not written. The
three citations point at ayme's runtime where the model leans on it: the
per-page run queue and the per-page id counter.
