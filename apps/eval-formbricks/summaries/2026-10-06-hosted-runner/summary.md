# Formbricks eval summary, 2026-10-06

Suite `2026-10-06T18-38-55-966Z-suite-607b0c`. Mission: rename-survey-and-question. Timeout: 600 s.

Passes are out of the runs stored for the arm. Each cell is the median, then the lowest and highest in parentheses. Wall time, tokens and cost are the task turn's alone: the setup turn before it, where Claude Code starts up and loads the arm's skill, is not counted. Input and output tokens are the agent's own, without the prompt cache; all tokens add the cache's reads and writes, which Claude Code bills at a fraction and a premium of the input price. Combined cost is the agent's cost plus the Goal Loop's where it ran.

| Arm                | Passes | Wall time                 | Tool calls    | Input and output tokens | All tokens                   | Combined cost             |
| ------------------ | ------ | ------------------------- | ------------- | ----------------------- | ---------------------------- | ------------------------- |
| playwright-mcp     | 1 of 1 | 37.7 s (37.7 s to 37.7 s) | 11 (11 to 11) | 1,351 (1,351 to 1,351)  | 296,965 (296,965 to 296,965) | $0.121 ($0.121 to $0.121) |
| playwright-cli     | 1 of 1 | 65.3 s (65.3 s to 65.3 s) | 12 (12 to 12) | 1,315 (1,315 to 1,315)  | 440,489 (440,489 to 440,489) | $0.155 ($0.155 to $0.155) |
| ayme-goal-loop-off | 1 of 1 | 19.1 s (19.1 s to 19.1 s) | 6 (6 to 6)    | 781 (781 to 781)        | 143,339 (143,339 to 143,339) | $0.179 ($0.179 to $0.179) |
| ayme-goal-loop-on  | 1 of 1 | 17.4 s (17.4 s to 17.4 s) | 3 (3 to 3)    | 676 (676 to 676)        | 91,313 (91,313 to 91,313)    | $0.147 ($0.147 to $0.147) |

## Versions a rerun must match

- Date: 2026-10-06
- Claude Code: 2.1.281
- Model: claude-sonnet-5 (requested sonnet, effort medium)
- @playwright/mcp 0.0.83 (playwright-mcp)
- @playwright/cli 0.1.22 (playwright-cli)
- @ayme-dev/mcp 0.1.0 (ayme-goal-loop-off)
- @ayme-dev/mcp 0.1.0 (ayme-goal-loop-on)
- Browser: 154.0.8037.57
- Ayme commit: 30d9661575dcf0f05b1f73898650c191e5a95c8a
- Formbricks commit: 8535b463970d3f1d5c33ba6e4fe539a78b56c88c
