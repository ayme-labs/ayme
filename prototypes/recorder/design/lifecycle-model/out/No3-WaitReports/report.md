# Recorder

TLC reached more states than the chart budget of 500, so the chart draws only the bug paths: 27 states and 28 arrows.

## R04_FinishSavesEverything breaks
The shortest path has 5 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you click (click 1): it reaches the page untouched: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report on its way; not in the timeline
3. you press Finish: Wrapping up to save | gate off in the page | click 1: reached the page; report on its way; not in the timeline
4. the recorder finishes wrapping up: Saving | gate off in the page | click 1: reached the page; report on its way; not in the timeline
5. the recorder starts writing the package: Saving | gate off in the page | package writing | click 1: reached the page; report on its way; not in the timeline

## X3_NothingYouDidIsDropped breaks
The shortest path has 5 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you click (click 1): it reaches the page untouched: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report on its way; not in the timeline
3. you press Stop: Wrapping up to pause | gate off in the page | click 1: reached the page; report on its way; not in the timeline
4. the recorder finishes wrapping up: Paused | gate off in the page | click 1: reached the page; report on its way; not in the timeline
5. Playwright's report for 1 arrives: thrown away: Paused | gate off in the page | click 1: reached the page; report in; not in the timeline

## R05_ClearLeavesNothing breaks
The shortest path has 6 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you press Clear: Wrapping up to clear | gate off in the page
3. you click (click 1): it reaches the page untouched: Wrapping up to clear | gate off in the page | click 1: reached the page; report on its way; not in the timeline
4. the recorder finishes wrapping up: Not recording | gate off in the page | click 1: reached the page; report on its way; not in the timeline
5. you press Record: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report on its way; not in the timeline
6. Playwright's report for 1 arrives: added to the timeline: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report in; in the timeline (before 1, after -)

## X2_SnapshotsInTimeOrder breaks
The shortest path has 8 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you press Stop: Wrapping up to pause | gate off in the page
3. you click (click 1): it reaches the page untouched: Wrapping up to pause | gate off in the page | click 1: reached the page; report on its way; not in the timeline
4. you click (click 2): it reaches the page untouched: Wrapping up to pause | gate off in the page | click 1: reached the page; report on its way; not in the timeline | click 2: reached the page; report on its way; not in the timeline
5. Playwright's report for 1 arrives: added to the timeline: Wrapping up to pause | gate off in the page | click 1: reached the page; report in; in the timeline (before 1, after -) | click 2: reached the page; report on its way; not in the timeline
6. the recorder finishes wrapping up: Paused | gate off in the page | click 1: reached the page; report in; in the timeline (before 1, after 2) | click 2: reached the page; report on its way; not in the timeline
7. you press Continue: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report in; in the timeline (before 1, after 2) | click 2: reached the page; report on its way; not in the timeline
8. Playwright's report for 2 arrives: added to the timeline: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report in; in the timeline (before 1, after 2) | click 2: reached the page; report in; in the timeline (before 1, after -)

## R07_AssertionCarriesNoChanges breaks
The shortest path has 9 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you press Assert visibility: Recording, Playwright is picking | gate off in the page (switch-on on its way)
3. you type (typing 1): it reaches the page at once: Recording, Playwright is picking | gate off in the page (switch-on on its way) | typing 1: reached the page; report on its way; not in the timeline
4. you click (click 2): Playwright's picker swallows it: Recording | gate off in the page (switch-on on its way) | typing 1: reached the page; report on its way; not in the timeline | click 2: picked for an assertion; report on its way; not in the timeline
5. you press Stop: Wrapping up to pause | gate off in the page | typing 1: reached the page; report on its way; not in the timeline | click 2: picked for an assertion; report on its way; not in the timeline
6. Playwright's report for 1 arrives: added to the timeline: Wrapping up to pause | gate off in the page | typing 1: reached the page; report in; in the timeline (before 1, after -) | click 2: picked for an assertion; report on its way; not in the timeline
7. the recorder finishes wrapping up: Paused | gate off in the page | typing 1: reached the page; report in; in the timeline (before 1, after 2) | click 2: picked for an assertion; report on its way; not in the timeline
8. you press Continue: Recording | gate off in the page (switch-on on its way) | typing 1: reached the page; report in; in the timeline (before 1, after 2) | click 2: picked for an assertion; report on its way; not in the timeline
9. Playwright's report for 2 arrives: added to the timeline: Recording | gate off in the page (switch-on on its way) | typing 1: reached the page; report in; in the timeline (before 1, after 2) | click 2: picked for an assertion; report in; in the timeline (before 1, after 1)

## Rules not checked
R01_HeldClickReachesThePageOnce, R02_OneBeforeOneAfter, R03a_StoppedClicksAreUntouched, R03b_StoppedAddsNothing, R03c_TracingRunsThroughPause, R06_ReviewOnlyWhilePaused, R09_NeverHalfWritten, R10_SavesOnce, X1_NothingOvertakesAHeldClick, X4_WrapUpNeverGetsStuck, NoDeadlock
After the first break, each TLC run stops at 100,000 distinct states. A run reached that bound before it checked these rules in every state.
