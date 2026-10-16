# Formbricks eval summary, 2026-10-15

Suite `2026-10-15T21-32-51-327Z-suite-0c8d9a`. Mission: sign-in-create-and-revise-survey. Timeout: 600 s.

Passes are out of the runs stored for the arm. Each cell is the median, then the lowest and highest in parentheses. Wall time, tokens and cost are the task turn's alone: the setup turn before it, where Claude Code starts up and loads the arm's skill, is not counted. Input and output tokens are the agent's own, without the prompt cache; all tokens add the cache's reads and writes, which Claude Code bills at a fraction and a premium of the input price. Combined cost is the agent's cost plus the Goal Loop's where it ran.

| Arm                                | Passes | Wall time                  | Tool calls    | Input and output tokens | All tokens                       | Combined cost             |
| ---------------------------------- | ------ | -------------------------- | ------------- | ----------------------- | -------------------------------- | ------------------------- |
| playwright-mcp                     | 3 of 3 | 85.0 s (82.4 s to 93.6 s)  | 31 (30 to 32) | 3,567 (3,317 to 3,656)  | 876,558 (850,165 to 929,705)     | $0.344 ($0.332 to $0.359) |
| playwright-cli                     | 3 of 3 | 85.3 s (81.6 s to 86.8 s)  | 27 (26 to 28) | 2,889 (2,639 to 3,703)  | 1,035,028 (988,223 to 1,083,511) | $0.346 ($0.323 to $0.382) |
| ayme-goal-loop-off                 | 3 of 3 | 55.4 s (53.0 s to 61.4 s)  | 21 (20 to 22) | 2,196 (2,118 to 2,483)  | 587,551 (584,450 to 594,449)     | $0.254 ($0.249 to $0.264) |
| ayme-goal-loop-on                  | 3 of 3 | 43.1 s (37.3 s to 47.0 s)  | 6 (5 to 6)    | 2,020 (1,828 to 2,247)  | 161,207 (145,086 to 161,793)     | $0.109 ($0.107 to $0.111) |
| ayme-no-page-objects-goal-loop-off | 3 of 3 | 54.6 s (46.1 s to 102.3 s) | 24 (20 to 25) | 2,511 (2,194 to 2,754)  | 797,591 (621,859 to 850,673)     | $0.330 ($0.259 to $0.336) |
| ayme-no-page-objects-goal-loop-on  | 3 of 3 | 57.2 s (51.7 s to 71.6 s)  | 22 (10 to 24) | 2,948 (2,286 to 3,087)  | 690,497 (304,944 to 835,148)     | $0.281 ($0.163 to $0.335) |

## Versions a rerun must match

- Date: 2026-10-15
- Claude Code: 2.1.281
- Model: claude-sonnet-5 (requested sonnet, effort medium)
- @playwright/mcp 0.0.83 (playwright-mcp)
- @playwright/cli 0.1.22 (playwright-cli)
- @ayme-dev/mcp 0.1.0 (ayme-goal-loop-off)
- @ayme-dev/mcp 0.1.0 (ayme-goal-loop-on)
- @ayme-dev/mcp 0.1.0 (ayme-no-page-objects-goal-loop-off)
- @ayme-dev/mcp 0.1.0 (ayme-no-page-objects-goal-loop-on)
- Browser: 155.0.8059.39
- Ayme commit: 1f300f8f0a2188b07027532217c34c9e9b944492
- Formbricks commit: 211ad704de30aabf96c059cc1cf00391d5b63a27

## Notes

- 1 run(s) changed the lab app checkout while running.
