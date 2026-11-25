---
name: verify-recorder-lifecycle
description: >
  Check a change to the Recorder's engine against its lifecycle model, a
  TLA+ model in packages/recorder/lifecycle-model/ that TLC checks against
  the rules the recorder must keep. Use when a change under
  packages/recorder/src alters the order of events, what the recorder waits
  for, or a promise it makes: the gate, Playwright's reports, the reads of
  the page, the wrap-up after Stop, Finish, Clear or Ctrl+C, the storage save at the end, or typed text in
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
Each rule is the comment above its check in `Recorder.tla`, under "The
rules". The model's README holds the known limits, the races, the
assumptions and what the model leaves out. Read both before you change
anything.

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
  `clearPaused`, `traceGone`, `saved`, `cannotStart` (after Record),
  `brokeDown` (while the storage state is saved), `saveFailed`, `ending` and `ended` (the storage
  save, with `storageNotSaved`), through `proceed`, `startNext`,
  `inputHeld`, `inputPassedOn`, `pageSettled`, `snapshotTaken`,
  `giveSnapshot`, `interactionReported`, `reportOfHeld` (with `buttonOf`,
  `reportsClickOf`, `asHeld`), `knownFromReport`,
  `carryOnReported`, `startReported`, `endReported`, `shareWithOpen`,
  `interactionRevised`, `writeDown`, `showOrWrite`, `behindUnshown`,
  `behindUnwritten`, `mayBeRevised`, `letThrough`, `withoutPage`, `asserted`,
  `assertVisibility`, `leaveAssertVisibility`, `pickNow`, `pickingChanged`,
  `decidable`, `decide`,
  `pageNavigated` (with `leftDocument`, `elsewhere` and `hadVisit`),
  `keepRead`, `atRecord`, `causeOf`, to `shown` and `offered`.
- `playwright/infrastructure/live/stockBrowser.ts`: `passOnHeld`, `passOn`,
  `holdInputs`, `letInputsThrough`, `reportInteractions`,
  `everyReportDelivered`, `saveStorage`, `pick` (Playwright's mode first,
  then the gates),
  `inModeOrder`, `takeSnapshot`, `settle`, `letGo`, the page opened blank to
  start recording (`opening`, which goes to its address in `holdInputs`), and
  the order of reports (`inReportOrder`, `reportFrom`, `withAncestors`,
  `withPickedRef`, `actionAdded`, `actionUpdated`).
- `playwright/infrastructure/in-page/gate.ts` (`gateIn`, `startGate`, and the
  gate's `set`, `open`, `arrived`, its picking start and `endPicking`),
  `drawing.ts` (`startPicking`), and `pageRules.ts` (`mouseRoute`,
  `keyRoute`, `keyHeld`, `clickHeld`, `heldButton`, `arrivingEvent`): which
  buttons the gate holds, and which clicks picking leaves to Playwright.
- `timeline/domain/timeline.ts` (`add`, `keepRead`, `replace`, `retext`,
  `produce`, `writeInteraction`, `pressedAfter`, `beforeItsPress`, `measure`,
  `changedBefore`, `tell`, `package`) and
  `recorded.ts` (`TimelineAddition`).
- `session/application/recorderSession.ts` (`publishEntries`, the package write telling `saveFailed`, the time
  limit), `engine/startRecorder.ts` (Record sent first, for
  `--start-recording`), `server/infrastructure/toolbarBridge.ts`,
  `server/infrastructure/windowChannelRouter.ts`.

**Sync commit: `33ce414f`** (`recorder/1356-storage-flags`). To see what changed in
covered code since, from any folder of the repository (the procedure below
runs in the model's):

```sh
git log --oneline 33ce414f..HEAD -- ':(top)packages/recorder/src'
```

A change touches the model when it adds, removes or reorders a step of the
covered functions, changes what one of them waits for, or changes what a
rule in `Recorder.tla` promises. A rename, a comment, or code the README lists
as left out does not.

## Procedure

Run every command inside the repository's Devbox shell, from
`packages/recorder/lifecycle-model/`. Each check runs TLC with one worker; on
a shared machine run one at a time.

1. **Run the model as it is**, before you change it:

   ```sh
   ./run-all.sh
   ```

   For each config it checked, it writes `out/<config>/report.md`, with each
   rule that breaks told as its path in plain words, and
   `out/Chart-*/chart.mmd`. It compares the rules that break in each config
   with `expected.txt`, and a config that gives others, or that the tool could
   not check in full (no report, or TLC stopped with an error), is named with its log in `out-<config>.log`, and
   the run exits non-zero. Read every report with the `statechart` skill.
   `gen-configs.sh` says what each config is for. `./run.sh <config>` checks one config the same
   way. To check one config with TLC alone, set `TLA2TOOLS` (README,
   "Running it") and run `./tlc.sh Rules`.

2. **Read the change against the model.** For each covered function the
   change touches, open the operator in `Recorder.tla` that stands for it and
   decide: it no longer describes the code (a step split in two, a branch
   added or removed, a new wait, a new path into the state a rule guards), or
   the change alters a promise on purpose (the commit message, a doc comment,
   `packages/recorder/AGENTS.md` or the Recorder guide says so), or it has
   no effect on what the model describes.

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
   - Every config must still break exactly the rules `expected.txt` lists for
     it, its probes included.

5. **Update what the change made stale**: the rule comments in
   `Recorder.tla`, `expected.txt`, the README's known limits, races,
   assumptions and what the model leaves out, the coverage above, and the
   sync commit above. Move the sync commit only after the model describes
   the code at the new commit. When this step changes a line of
   `expected.txt`, run that config again with `./run.sh <config>`.
   Put the model's update in a commit of its own, apart from any engine fix.

## What a result means

- **Holds** covers the model within its bounds and assumptions (README, "How
  the model stands for the engine"): one page, a few inputs, the speed
  assumption Quick. It is not a proof of the whole recorder.
- A rule the README lists under "Known limits" or "Races" breaks on purpose
  in its own config; a new path to it is still a finding.
- The model has no clock and no Change Tree: it cannot tell whether a row is
  late or what a row says. Check those with the engine's tests
  (`packages/recorder/AGENTS.md`, "Testing") and the recorder fixture.
