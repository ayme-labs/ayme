---
status: accepted
---

# The Goal Loop hands back success only when the model is confident the goal holds

The Goal Loop handed back success when the model chose no further operation and judged the goal met with a probability above one half. On a page that does not show whether the goal holds, that probability sits near one half, so the loop handed back success on a coin flip, often with no step taken, and its caller reported a success that did not happen. Success now needs the probability to clear a bar well above one half. Below a second bar well under one half, the loop hands back that no operation fits; between the two bars it hands back a reason of its own, that it could not tell, and the caller checks the page. The model's judgement that no step is outstanding counts only after a step ran, and only when it is confident. The bars are set from recorded goal runs, weighing a false success above the caller's extra look at the page.

We considered also requiring the chosen operation to clearly beat the runner-up, rejected because on the runs measured the bar on the goal already catches every uncertain stop it would. We considered handing back that no operation fits for the uncertain case, rejected because an operation may fit; running the runner-up operation, rejected because it acts when the goal may already hold; and keeping success with reworded advice, rejected because a caller that reads the reason still reports success. We considered never handing back success with no step taken, rejected because a goal can hold before the loop starts. The cost is that some runs that did reach the goal, judged only just past one half, now send their caller to check the page, and that a confident wrong answer still clears the bar.
