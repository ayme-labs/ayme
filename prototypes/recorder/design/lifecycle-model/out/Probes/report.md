# Recorder

TLC reached more states than the chart budget of 500, so the chart draws only the bug paths: 47 states and 47 arrows.

## P7_NeverHoldsAClickDuringWrapUp breaks
The shortest path has 4 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you press Stop: Wrapping up to pause | gate ON in the page (switch-off on its way)
4. you click (click 1): the gate holds it back: Wrapping up to pause | gate ON in the page (switch-off on its way) | click 1: held back, no 'before' yet; no report; not in the timeline

## P8_NeverEndsEmptyAfterRecording breaks
The shortest path has 4 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you press Clear: Wrapping up to clear | gate off in the page
3. the last page closes: Wrapping up to clear and end | page closed
4. the recorder finishes wrapping up: Ended: nothing to save | page closed

## P6_NeverClearsThenRecordsAgain breaks
The shortest path has 6 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you press Clear: Wrapping up to clear | gate off in the page
3. the recorder finishes wrapping up: Not recording | gate off in the page
4. you press Record: Recording | gate off in the page (switch-on on its way)
5. you click (click 1): it reaches the page untouched: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report on its way; not in the timeline
6. Playwright's report for 1 arrives: added to the timeline: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report in; in the timeline (before 1, after -)

## P9_NeverSavesWithPageClosed breaks
The shortest path has 7 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you click (click 1): it reaches the page untouched: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report on its way; not in the timeline
3. Playwright's report for 1 arrives: added to the timeline: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report in; in the timeline (before 1, after -)
4. the last page closes: Wrapping up to save | page closed | click 1: reached the page; report in; in the timeline (before 1, after none: left the page)
5. the recorder finishes wrapping up: Saving | page closed | click 1: reached the page; report in; in the timeline (before 1, after none: left the page)
6. the recorder starts writing the package: Saving | page closed | package writing | click 1: reached the page; report in; in the timeline (before 1, after none: left the page)
7. the package is written: Ended: package saved | page closed | package complete | click 1: reached the page; report in; in the timeline (before 1, after none: left the page)

## P4_NeverRecordsANavigation breaks
The shortest path has 8 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you press Finish: Wrapping up to save | gate off in the page
3. you click (click 1): it reaches the page untouched and starts a navigation: Wrapping up to save | gate off in the page | navigation under way | click 1: reached the page; report on its way; not in the timeline
4. Playwright's report for 1 arrives: added to the timeline: Wrapping up to save | gate off in the page | navigation under way | click 1: reached the page; report in; in the timeline (before 1, after -)
5. the new page loads: Wrapping up to save | gate off in the page | on the new page | click 1: reached the page; report in; in the timeline (before 1, after none: left the page)
6. the recorder finishes wrapping up: Saving | gate off in the page | on the new page | click 1: reached the page; report in; in the timeline (before 1, after none: left the page)
7. the recorder starts writing the package: Saving | gate off in the page | on the new page | package writing | click 1: reached the page; report in; in the timeline (before 1, after none: left the page)
8. the package is written: Ended: package saved | gate off in the page | on the new page | package complete | click 1: reached the page; report in; in the timeline (before 1, after none: left the page)

## P5_NeverCutsASettleShort breaks
The shortest path has 8 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you click (click 1): the gate holds it back: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline
4. the recorder takes the 'before' of click 1: Recording | gate ON in the page | click 1: held back, 'before' taken; no report; not in the timeline
5. the recorder passes click 1 on to the page: Recording | gate ON in the page | click 1: reached the page; report on its way; not in the timeline
6. you type (typing 2): it reaches the page at once: Recording | gate ON in the page | click 1: reached the page; report on its way; not in the timeline | typing 2: reached the page; report on its way; not in the timeline
7. Playwright's report for 1 arrives: added to the timeline: Recording | gate ON in the page | click 1: reached the page; report in; in the timeline (before 2, after -) | typing 2: reached the page; report on its way; not in the timeline
8. Playwright's report for 2 arrives: added to the timeline: Recording | gate ON in the page | click 1: reached the page; report in; in the timeline (before 2, after 2) | typing 2: reached the page; report in; in the timeline (before 2, after -)

## P1_NeverSavesTwoEntries breaks
The shortest path has 9 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you press Finish: Wrapping up to save | gate off in the page
3. you click (click 1): it reaches the page untouched: Wrapping up to save | gate off in the page | click 1: reached the page; report on its way; not in the timeline
4. you click (click 2): it reaches the page untouched: Wrapping up to save | gate off in the page | click 1: reached the page; report on its way; not in the timeline | click 2: reached the page; report on its way; not in the timeline
5. Playwright's report for 1 arrives: added to the timeline: Wrapping up to save | gate off in the page | click 1: reached the page; report in; in the timeline (before 1, after -) | click 2: reached the page; report on its way; not in the timeline
6. Playwright's report for 2 arrives: added to the timeline: Wrapping up to save | gate off in the page | click 1: reached the page; report in; in the timeline (before 1, after 1) | click 2: reached the page; report in; in the timeline (before 1, after -)
7. the recorder finishes wrapping up: Saving | gate off in the page | click 1: reached the page; report in; in the timeline (before 1, after 1) | click 2: reached the page; report in; in the timeline (before 1, after 2)
8. the recorder starts writing the package: Saving | gate off in the page | package writing | click 1: reached the page; report in; in the timeline (before 1, after 1) | click 2: reached the page; report in; in the timeline (before 1, after 2)
9. the package is written: Ended: package saved | gate off in the page | package complete | click 1: reached the page; report in; in the timeline (before 1, after 1) | click 2: reached the page; report in; in the timeline (before 1, after 2)

## P3_NeverRecordsAnAssertionAfterAClick breaks
The shortest path has 9 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you click (click 1): the gate holds it back: Recording | gate ON in the page | click 1: held back, no 'before' yet; no report; not in the timeline
4. the recorder takes the 'before' of click 1: Recording | gate ON in the page | click 1: held back, 'before' taken; no report; not in the timeline
5. the recorder passes click 1 on to the page: Recording | gate ON in the page | click 1: reached the page; report on its way; not in the timeline
6. you press Assert visibility: Recording, Playwright is picking | gate ON in the page | click 1: reached the page; report on its way; not in the timeline
7. you click (click 2): Playwright's picker swallows it: Recording | gate ON in the page | click 1: reached the page; report on its way; not in the timeline | click 2: picked for an assertion; report on its way; not in the timeline
8. Playwright's report for 1 arrives: added to the timeline: Recording | gate ON in the page | click 1: reached the page; report in; in the timeline (before 2, after -) | click 2: picked for an assertion; report on its way; not in the timeline
9. Playwright's report for 2 arrives: added to the timeline: Recording | gate ON in the page | click 1: reached the page; report in; in the timeline (before 2, after 2) | click 2: picked for an assertion; report in; in the timeline (before 2, after 2)

## P2_NeverSavesADiscard breaks
The shortest path has 10 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you press Stop: Wrapping up to pause | gate off in the page
3. you click (click 1): it reaches the page untouched: Wrapping up to pause | gate off in the page | click 1: reached the page; report on its way; not in the timeline
4. Playwright's report for 1 arrives: added to the timeline: Wrapping up to pause | gate off in the page | click 1: reached the page; report in; in the timeline (before 1, after -)
5. the recorder finishes wrapping up: Paused | gate off in the page | click 1: reached the page; report in; in the timeline (before 1, after 2)
6. you discard an entry: Paused | gate off in the page | click 1: reached the page; report in; in the timeline (before 1, after 2), discarded
7. you press Finish: Wrapping up to save | gate off in the page | click 1: reached the page; report in; in the timeline (before 1, after 2), discarded
8. the recorder finishes wrapping up: Saving | gate off in the page | click 1: reached the page; report in; in the timeline (before 1, after 2), discarded
9. the recorder starts writing the package: Saving | gate off in the page | package writing | click 1: reached the page; report in; in the timeline (before 1, after 2), discarded
10. the package is written: Ended: package saved | gate off in the page | package complete | click 1: reached the page; report in; in the timeline (before 1, after 2), discarded

## Rules not checked
NoDeadlock
After the first break, each TLC run stops at 100,000 distinct states. A run reached that bound before it checked this rule in every state.
