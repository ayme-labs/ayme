# Recorder

TLC reached more states than the chart budget of 500, so the chart draws only the bug paths: 10 states and 9 arrows.

## R01_HeldClickReachesThePageOnce breaks
The shortest path has 5 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you click (click 1): the gate holds it back: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline
4. you stop the recorder from the terminal: Wrapping up to save | gate ON in the page (switch-off on its way) | click 1: held back, no 'before' yet; no report; not in the timeline
5. you stop it from the terminal a second time: Killed | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline

## R09_NeverHalfWritten breaks
The shortest path has 5 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you stop the recorder from the terminal: Wrapping up to save | gate off in the page
3. the recorder finishes wrapping up: Saving | gate off in the page
4. the recorder starts writing the package: Saving | gate off in the page | package writing
5. you stop it from the terminal a second time: Killed | gate off in the page | package writing

## Rules not checked
R02_OneBeforeOneAfter, R03a_StoppedClicksAreUntouched, R03b_StoppedAddsNothing, R03c_TracingRunsThroughPause, R04_FinishSavesEverything, R05_ClearLeavesNothing, R06_ReviewOnlyWhilePaused, R07_AssertionCarriesNoChanges, R10_SavesOnce, X1_NothingOvertakesAHeldClick, X2_SnapshotsInTimeOrder, X3_NothingYouDidIsDropped, X4_WrapUpNeverGetsStuck, NoDeadlock
After the first break, each TLC run stops at 100,000 distinct states. A run reached that bound before it checked these rules in every state.
