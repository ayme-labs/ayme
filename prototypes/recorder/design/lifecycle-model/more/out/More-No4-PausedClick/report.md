# RecorderMore

TLC reached more states than the chart budget of 500, so the chart draws only the bug paths: 7 states and 6 arrows.

## M1_PausedClickNeverRecorded breaks
The shortest path has 6 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. you press Stop: Wrapping up to pause | gate off in the page
3. the recorder finishes wrapping up: Paused | gate off in the page
4. you click (click 1): it reaches the page untouched: Paused | gate off in the page | click 1: reached the page; report on its way; not in the timeline
5. you press Continue: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report on its way; not in the timeline
6. Playwright's report for 1 arrives: added to the timeline: Recording | gate off in the page (switch-on on its way) | click 1: reached the page; report in; in the timeline (before 1, after -)

## Rules not checked
NoDeadlock
After the first break, each TLC run stops at 100,000 distinct states. A run reached that bound before it checked this rule in every state.
