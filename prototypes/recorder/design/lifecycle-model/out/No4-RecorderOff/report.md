# Recorder

TLC reached more states than the chart budget of 500, so the chart draws only the bug paths: 9 states and 8 arrows.

## R03b_StoppedAddsNothing breaks
The shortest path has 3 steps:
0. Not recording | gate off in the page
1. you click (click 1): it reaches the page untouched: Not recording | gate off in the page | click 1: reached the page; report on its way; not in the timeline
2. you press Record: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report on its way; not in the timeline
3. Playwright's report for 1 arrives: added to the timeline: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report in; in the timeline (before 1, after -)

## R03a_StoppedClicksAreUntouched breaks
The shortest path has 5 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you press Assert visibility: Recording, Playwright is picking | gate off in the page (switch-on on its way)
3. you press Stop: Wrapping up to pause, Playwright is picking | gate off in the page
4. the recorder finishes wrapping up: Paused, Playwright is picking | gate off in the page
5. you click (click 1): Playwright's picker swallows it: Paused | gate off in the page | click 1: picked for an assertion; report on its way; not in the timeline

## Rules not checked
R01_HeldClickReachesThePageOnce, R02_OneBeforeOneAfter, R03c_TracingRunsThroughPause, R04_FinishSavesEverything, R05_ClearLeavesNothing, R06_ReviewOnlyWhilePaused, R07_AssertionCarriesNoChanges, R09_NeverHalfWritten, R10_SavesOnce, X1_NothingOvertakesAHeldClick, X2_SnapshotsInTimeOrder, X3_NothingYouDidIsDropped, X4_WrapUpNeverGetsStuck, NoDeadlock
After the first break, each TLC run stops at 100,000 distinct states. A run reached that bound before it checked these rules in every state.
