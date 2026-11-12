# Recorder

TLC reached more states than the chart budget of 500, so the chart draws only the bug paths: 13 states and 12 arrows.

## R01_HeldClickReachesThePageOnce breaks
The shortest path has 6 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you click (click 1): the gate holds it back: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline
4. you press Assert visibility: Recording, Playwright is picking | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline
5. the recorder takes the 'before' of click 1: Recording, Playwright is picking | gate ON in the page | click 1: held back, 'before' taken; no report; not in the timeline
6. the recorder passes click 1 on: Playwright's picker swallows it: Recording | gate ON in the page | click 1: swallowed by Playwright's picker after being held; report on its way; not in the timeline

## R07_AssertionCarriesNoChanges breaks
The shortest path has 10 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you click (click 1): the gate holds it back: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline
4. you press Assert visibility: Recording, Playwright is picking | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline
5. you click (click 2): Playwright's picker swallows it: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline | click 2: picked for an assertion; report on its way; not in the timeline
6. you press Assert visibility: Recording, Playwright is picking | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline | click 2: picked for an assertion; report on its way; not in the timeline
7. Playwright's report for 2 arrives: added to the timeline: Recording, Playwright is picking | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline | click 2: picked for an assertion; report in; in the timeline (before 1, after 1)
8. the recorder takes the 'before' of click 1: Recording, Playwright is picking | gate ON in the page | click 1: held back, 'before' taken; no report; not in the timeline | click 2: picked for an assertion; report in; in the timeline (before 1, after 1)
9. the recorder passes click 1 on: Playwright's picker swallows it: Recording | gate ON in the page | click 1: swallowed by Playwright's picker after being held; report on its way; not in the timeline | click 2: picked for an assertion; report in; in the timeline (before 1, after 1)
10. Playwright's report for 1 arrives: added to the timeline: Recording | gate ON in the page | click 1: swallowed by Playwright's picker after being held; report in; in the timeline (before 2, after 2) | click 2: picked for an assertion; report in; in the timeline (before 1, after 1)

## X2_SnapshotsInTimeOrder breaks
The shortest path has 10 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you click (click 1): the gate holds it back: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline
4. you press Assert visibility: Recording, Playwright is picking | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline
5. you click (click 2): Playwright's picker swallows it: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline | click 2: picked for an assertion; report on its way; not in the timeline
6. you press Assert visibility: Recording, Playwright is picking | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline | click 2: picked for an assertion; report on its way; not in the timeline
7. Playwright's report for 2 arrives: added to the timeline: Recording, Playwright is picking | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline | click 2: picked for an assertion; report in; in the timeline (before 1, after 1)
8. the recorder takes the 'before' of click 1: Recording, Playwright is picking | gate ON in the page | click 1: held back, 'before' taken; no report; not in the timeline | click 2: picked for an assertion; report in; in the timeline (before 1, after 1)
9. the recorder passes click 1 on: Playwright's picker swallows it: Recording | gate ON in the page | click 1: swallowed by Playwright's picker after being held; report on its way; not in the timeline | click 2: picked for an assertion; report in; in the timeline (before 1, after 1)
10. Playwright's report for 1 arrives: added to the timeline: Recording | gate ON in the page | click 1: swallowed by Playwright's picker after being held; report in; in the timeline (before 2, after 2) | click 2: picked for an assertion; report in; in the timeline (before 1, after 1)

## Rules not checked
R02_OneBeforeOneAfter, R03a_StoppedClicksAreUntouched, R03b_StoppedAddsNothing, R03c_TracingRunsThroughPause, R04_FinishSavesEverything, R05_ClearLeavesNothing, R06_ReviewOnlyWhilePaused, R09_NeverHalfWritten, R10_SavesOnce, X1_NothingOvertakesAHeldClick, X3_NothingYouDidIsDropped, X4_WrapUpNeverGetsStuck, NoDeadlock
After the first break, each TLC run stops at 100,000 distinct states. A run reached that bound before it checked these rules in every state.
