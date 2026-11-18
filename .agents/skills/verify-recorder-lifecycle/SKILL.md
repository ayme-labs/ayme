---
name: verify-recorder-lifecycle
description: >
  Check a change to the Recorder's engine against its lifecycle model, a
  TLA+ model in packages/recorder/lifecycle-model/ that TLC checks against
  the rules the recorder must keep. Use when a change under
  packages/recorder/src alters the order of events, what the recorder waits
  for, or a promise it makes: the gate, Playwright's reports, the reads of
  the page, the wrap-up after Stop, Finish, Clear or Ctrl+C, or typed text in
  the window. Use it before showing such a change to the user.
---

# Verifying the Recorder's lifecycle

The Recorder's engine is one pure function, `step` in
`packages/recorder/src/session/domain/lifecycle.ts`, driven by what the
browser tells it. Its bugs are orders: a click that arrives while a page still
changes, a report that comes after the recorder stopped waiting for it. Tests
check the orders someone thought of. The model in
`packages/recorder/lifecycle-model/` checks every order of its steps within
its bounds, and gives the shortest sequence of steps to each rule that breaks.
Its README holds the rules, the known limits, the races, the charts and what
the model leaves out. Read it before you change anything.

Words used here:

- **A config**: one `.cfg` file of the model, with its bounds and the rules it
  checks. `gen-configs.sh` writes them all from one table.
- **A path**: the steps TLC gives to a state that breaks a rule, the shortest
  there is.
- **The sync commit**: the engine commit at which the model was last confirmed
  to describe the code, below.

## When a change touches the verified code

The model covers these files under `packages/recorder/src/`, and stands for
each function named in a comment beside the operator that models it (search
`Recorder.tla` for the function's name):

- `session/domain/lifecycle.ts`: all of `step`, from `record`, `resume`,
  `wrapUp`, `goOnWrappingUp`, `giveUp`, `wrappedUp`, `endFromOutside`,
  `clearPaused`, `traceGone` and `saved`, through `proceed`, `startNext`,
  `inputHeld`, `inputPassedOn`, `pageSettled`, `snapshotTaken`,
  `giveSnapshot`, `interactionReported`, `reportOfHeld`, `knownFromReport`,
  `carryOnReported`, `startReported`, `endReported`, `shareWithOpen`,
  `interactionRevised`, `writeDown`, `showOrWrite`, `behindUnshown`,
  `behindUnwritten`, `mayBeRevised`, `letThrough`, `withoutPage`, `asserted`,
  `assertVisibility`, `leaveAssertVisibility`, `pickNow`, `pickingChanged`, to
  `shown` and `offered`.
- `playwright/infrastructure/live/stockBrowser.ts`: `passOnHeld`, `passOn`,
  `holdInputs`, `letInputsThrough`, `reportInteractions`,
  `everyReportDelivered`, `pick`, `inModeOrder`, `takeSnapshot`, `settle`,
  `letGo`, and the order of reports (`inReportOrder`, `withAncestors`,
  `withPickedRef`, `actionAdded`, `actionUpdated`).
- `playwright/infrastructure/in-page/gate.ts` (`gateIn`, `startGate`, and the
  gate's `set`, `open`, `arrived`), `drawing.ts` (`startPicking`), and
  `pageRules.ts` (`mouseRoute`, `keyRoute`, `keyHeld`).
- `timeline/domain/timeline.ts` (`add`, `replace`, `retext`, `produce`,
  `writeInteraction`, `measure`, `changedBefore`, `tell`, `package`) and
  `recorded.ts` (`TimelineAddition`).
- `session/application/recorderSession.ts` (`publishEntries`, the time
  limit), `server/infrastructure/toolbarBridge.ts`,
  `server/infrastructure/windowChannelRouter.ts`.

**Sync commit: `2eb4ef3f`** (`feat/recorder-rebuild`). To see what changed in
covered code since:

```sh
git log --oneline 2eb4ef3f..HEAD -- packages/recorder/src
```

A change touches the model when it adds, removes or reorders a step of the
covered functions, changes what one of them waits for, or changes what a
rule in the README promises. A rename, a comment, or code the README lists
as left out does not.

## Procedure

Run every command inside the repository's Devbox shell, from
`packages/recorder/lifecycle-model/`. Each check runs TLC with one worker; on
a shared machine run one at a time.

1. **Run the model as it is**, before you change it:

   ```sh
   ./run-all.sh
   ```

   It writes `out/<config>/report.md` for each config, with each rule that
   breaks told as its path in plain words, and `out/Chart-*/chart.mmd`. Read
   every result with the `statechart` skill. Compare each config with the
   table in the README, "Running it": the states it reaches and what it must
   give. To check one config with TLC alone, set `TLA2TOOLS` (README,
   "Running it") and run `./tlc.sh Rules`.

2. **Read the change against the model.** For each covered function the
   change touches, open the operator in `Recorder.tla` that stands for it and
   decide: it no longer describes the code (a step split in two, a branch
   added or removed, a new wait, a new path into the state a rule guards), or
   the change alters a promise on purpose (the commit message, a doc comment,
   `packages/recorder/AGENTS.md` or the cli README says so), or it has no
   effect on what the model describes.

3. **Update the model from the code, not from the result.** Make each changed
   operator do what the code does, one step of `step` as one step of the
   model, with the function's name in its comment. Change a rule only for a
   promise that changed on purpose, and write down the evidence. Keep the
   bounds; if you must reduce one, say so. Run `./gen-configs.sh` after
   changing its table.

4. **Rerun and judge each result.**
   - A rule that breaks: replay its path against the code, step by step. If
     a step cannot happen in the code, the model is wrong: fix the model and
     say what was wrong. If every step can happen, it is a bug: report it as
     the path in the code's words, its harm in one sentence, and the commit
     that brought it. Do not weaken the rule or the model to make it pass,
     and do not change engine code unless the user asks.
   - A rule that holds after you changed what it guards: break the new code's
     mechanism in a scratch copy of `Recorder.tla` (remove the new check,
     reorder the new step) and confirm the rule breaks. A check you never saw
     fail proves nothing.
   - Every probe (P1 to P23) must still break: each shows the model still
     reaches a situation.

5. **Update the README and this skill**: the rules and their outcomes, the
   known limits and races, the table of configs with the states they reach,
   the charts (from `out/Chart-*/chart.mmd`), the coverage above, and the
   engine commit the model was last compared with, in both places. Move the
   sync commit only after the model describes the code at the new commit.
   Put the model's update in a commit of its own, apart from any engine fix.

## What a result means

- **Holds** covers the model within its bounds and assumptions (README, "How
  the model stands for the engine"): one page, a few inputs, the speed
  assumption Quick. It is not a proof of the whole recorder.
- A rule the README lists under "Known limits and open bugs" or "Races"
  breaks on purpose in its own config; a new path to it is still a finding.
- The model has no clock and no Change Tree: it cannot tell whether a row is
  late or what a row says. Check those with the engine's tests
  (`packages/recorder/AGENTS.md`, "Testing") and the recorder fixture.
