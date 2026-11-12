# Recorder

TLC reached more states than the chart budget of 500, so the chart draws only the bug paths: 26 states and 25 arrows.

## R01_HeldClickReachesThePageOnce breaks
The shortest path has 7 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you press Clear: Wrapping up to clear | gate ON in the page (switch-off on its way)
4. you click (click 1): the gate holds it back: Wrapping up to clear | gate ON in the page (switch-off on its way) | click 1: held back, no 'before' yet; no report; not in the timeline
5. the page switches the gate off: Wrapping up to clear | gate off in the page | click 1: held back, no 'before' yet; no report; not in the timeline
6. you stop the recorder from the terminal: Wrapping up to clear and end | gate off in the page | click 1: held back, no 'before' yet; no report; not in the timeline
7. the recorder finishes wrapping up: Ended: nothing to save | gate off in the page | click 1: held back, no 'before' yet; no report; not in the timeline

## R03a_StoppedClicksAreUntouched breaks
The shortest path has 7 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you press Stop: Wrapping up to pause | gate ON in the page (switch-off on its way)
4. you click (click 1): the gate holds it back: Wrapping up to pause | gate ON in the page (switch-off on its way) | click 1: held back, no 'before' yet; no report; not in the timeline
5. the page switches the gate off: Wrapping up to pause | gate off in the page | click 1: held back, no 'before' yet; no report; not in the timeline
6. the recorder finishes wrapping up: Paused | gate off in the page | click 1: held back, no 'before' yet; no report; not in the timeline
7. you click (click 2): the gate holds it back: Paused | gate off in the page | click 1: held back, no 'before' yet; no report; not in the timeline | click 2: held back, no 'before' yet; no report; not in the timeline

## R04_FinishSavesEverything breaks
The shortest path has 9 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you click (click 1): the gate holds it back: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline
4. you press Finish: Wrapping up to save | gate ON in the page (switch-off on its way) | click 1: held back, no 'before' yet; no report; not in the timeline
5. the recorder takes the 'before' of click 1: Wrapping up to save | gate ON in the page (switch-off on its way) | click 1: held back, 'before' taken; no report; not in the timeline
6. the page switches the gate off: Wrapping up to save | gate off in the page | click 1: held back, 'before' taken; no report; not in the timeline
7. the recorder finishes wrapping up: Saving | gate off in the page | click 1: held back, 'before' taken; no report; not in the timeline
8. the recorder passes click 1 on to the page: Saving | gate off in the page | click 1: reached the page; no report; not in the timeline
9. the recorder starts writing the package: Saving | gate off in the page | package writing | click 1: reached the page; no report; not in the timeline

## R05_ClearLeavesNothing breaks
The shortest path has 10 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you press Clear: Wrapping up to clear | gate ON in the page (switch-off on its way)
4. you click (click 1): the gate holds it back: Wrapping up to clear | gate ON in the page (switch-off on its way) | click 1: held back, no 'before' yet; no report; not in the timeline
5. the recorder takes the 'before' of click 1: Wrapping up to clear | gate ON in the page (switch-off on its way) | click 1: held back, 'before' taken; no report; not in the timeline
6. the page switches the gate off: Wrapping up to clear | gate off in the page | click 1: held back, 'before' taken; no report; not in the timeline
7. the recorder finishes wrapping up: Not recording | gate off in the page | click 1: held back, 'before' taken; no report; not in the timeline
8. you press Record: Recording | gate off in the page (switch-on on its way) | click 1: held back, 'before' taken; no report; not in the timeline
9. the recorder passes click 1 on to the page: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report on its way; not in the timeline
10. Playwright's report for 1 arrives: added to the timeline: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report in; in the timeline (before 2, after -)

## Rules not checked
R02_OneBeforeOneAfter, R03b_StoppedAddsNothing, R03c_TracingRunsThroughPause, R06_ReviewOnlyWhilePaused, R07_AssertionCarriesNoChanges, R09_NeverHalfWritten, R10_SavesOnce, X1_NothingOvertakesAHeldClick, X2_SnapshotsInTimeOrder, X3_NothingYouDidIsDropped, X4_WrapUpNeverGetsStuck, NoDeadlock
After the first break, each TLC run stops at 100,000 distinct states. A run reached that bound before it checked these rules in every state.
