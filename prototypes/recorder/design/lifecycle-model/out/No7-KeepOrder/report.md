# Recorder

TLC reached more states than the chart budget of 500, so the chart draws only the bug paths: 9 states and 9 arrows.

## X1_NothingOvertakesAHeldClick breaks
The shortest path has 4 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you click (click 1): the gate holds it back: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline
4. you type (typing 2): it reaches the page at once: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline | typing 2: reached the page; report on its way; not in the timeline

## X2_SnapshotsInTimeOrder breaks
The shortest path has 9 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you click (click 1): the gate holds it back: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline
4. you type (typing 2): it reaches the page at once: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline | typing 2: reached the page; report on its way; not in the timeline
5. Playwright's report for 2 arrives: added to the timeline: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline | typing 2: reached the page; report in; in the timeline (before 1, after -)
6. the recorder takes the 'before' of click 1: Recording | gate ON in the page | click 1: held back, 'before' taken; no report; not in the timeline | typing 2: reached the page; report in; in the timeline (before 1, after -)
7. the recorder passes click 1 on to the page: Recording | gate ON in the page | click 1: reached the page; report on its way; not in the timeline | typing 2: reached the page; report in; in the timeline (before 1, after -)
8. the page settles: the recorder takes the 'after' of 1: Recording | gate ON in the page | click 1: reached the page; report on its way; not in the timeline | typing 2: reached the page; report in; in the timeline (before 1, after -)
9. Playwright's report for 1 arrives: added to the timeline: Recording | gate ON in the page | click 1: reached the page; report in; in the timeline (before 2, after 3) | typing 2: reached the page; report in; in the timeline (before 1, after -)

## Rules not checked
R01_HeldClickReachesThePageOnce, R02_OneBeforeOneAfter, R03a_StoppedClicksAreUntouched, R03b_StoppedAddsNothing, R03c_TracingRunsThroughPause, R04_FinishSavesEverything, R05_ClearLeavesNothing, R06_ReviewOnlyWhilePaused, R07_AssertionCarriesNoChanges, R09_NeverHalfWritten, R10_SavesOnce, X3_NothingYouDidIsDropped, X4_WrapUpNeverGetsStuck, NoDeadlock
After the first break, each TLC run stops at 100,000 distinct states. A run reached that bound before it checked these rules in every state.
