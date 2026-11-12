# Recorder

TLC reached more states than the chart budget of 500, so the chart draws only the bug paths: 9 states and 8 arrows.

## T3_NoClickStuckAfterSaving breaks
The shortest path has 8 steps:
0. Not recording | gate off in the page
1. you press Record: Recording | gate off in the page (switch-on on its way)
2. the page switches the gate on: Recording | gate ON in the page
3. you press Finish: Wrapping up to save | gate ON in the page (switch-off on its way)
4. you click (click 1): the gate holds it back: Wrapping up to save | gate ON in the page (switch-off on its way) | click 1: held back, no 'before' yet; no report; not in the timeline
5. the page switches the gate off: Wrapping up to save | gate off in the page | click 1: held back, no 'before' yet; no report; not in the timeline
6. the recorder finishes wrapping up: Saving | gate off in the page | click 1: held back, no 'before' yet; no report; not in the timeline
7. the recorder starts writing the package: Saving | gate off in the page | package writing | click 1: held back, no 'before' yet; no report; not in the timeline
8. the package is written: Ended: package saved | gate off in the page | package complete | click 1: held back, no 'before' yet; no report; not in the timeline

## Rules not checked
NoDeadlock
After the first break, each TLC run stops at 100,000 distinct states. A run reached that bound before it checked this rule in every state.
