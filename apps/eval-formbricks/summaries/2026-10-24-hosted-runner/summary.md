# Formbricks eval summary, 2026-10-24

Suite `2026-10-24T07-02-59-666Z-suite-rename10`. Mission: rename-survey-and-question. Timeout: 600 s.

Passes are out of the runs stored for the arm. Each cell is the median, then the lowest and highest in parentheses. Wall time, tokens and cost are the task turn's alone: the setup turn before it, where Claude Code starts up and loads the arm's skill, is not counted. Input and output tokens are the agent's own, without the prompt cache; all tokens add the cache's reads and writes, which Claude Code bills at a fraction and a premium of the input price. Combined cost is the agent's cost plus the Goal Loop's where it ran.

| Arm                                | Passes   | Wall time                 | Tool calls    | Input and output tokens | All tokens                   | Combined cost             |
| ---------------------------------- | -------- | ------------------------- | ------------- | ----------------------- | ---------------------------- | ------------------------- |
| playwright-mcp                     | 10 of 10 | 42.7 s (37.1 s to 58.5 s) | 16 (12 to 20) | 1,870 (1,576 to 2,293)  | 351,056 (260,831 to 467,940) | $0.154 ($0.121 to $0.201) |
| playwright-cli                     | 10 of 10 | 36.7 s (28.6 s to 57.2 s) | 12 (10 to 18) | 1,278 (1,039 to 2,505)  | 420,394 (337,860 to 656,041) | $0.140 ($0.107 to $0.220) |
| ayme-goal-loop-off                 | 10 of 10 | 18.9 s (15.8 s to 23.5 s) | 5 (4 to 6)    | 842 (644 to 993)        | 117,837 (96,951 to 139,069)  | $0.055 ($0.046 to $0.069) |
| ayme-goal-loop-on                  | 10 of 10 | 17.3 s (15.6 s to 21.4 s) | 3 (2 to 5)    | 741 (625 to 1,087)      | 82,912 (62,746 to 129,282)   | $0.061 ($0.049 to $0.072) |
| ayme-no-page-objects-goal-loop-off | 10 of 10 | 23.1 s (21.2 s to 27.3 s) | 7 (6 to 8)    | 1,035 (926 to 1,207)    | 174,917 (156,826 to 197,998) | $0.081 ($0.079 to $0.103) |
| ayme-no-page-objects-goal-loop-on  | 10 of 10 | 18.2 s (13.4 s to 24.8 s) | 3 (3 to 5)    | 807 (699 to 1,057)      | 82,270 (79,345 to 143,888)   | $0.057 ($0.046 to $0.086) |

## Versions a rerun must match

- Date: 2026-10-24
- Claude Code: 2.1.281
- Model: claude-sonnet-5 (requested sonnet, effort medium)
- @playwright/mcp 0.0.83 (playwright-mcp)
- @playwright/cli 0.1.22 (playwright-cli)
- @ayme-dev/mcp 0.1.0-alpha.0 (ayme-goal-loop-off)
- @ayme-dev/mcp 0.1.0-alpha.0 (ayme-goal-loop-on)
- @ayme-dev/mcp 0.1.0-alpha.0 (ayme-no-page-objects-goal-loop-off)
- @ayme-dev/mcp 0.1.0-alpha.0 (ayme-no-page-objects-goal-loop-on)
- Browser: 155.0.8059.39
- Ayme commit: 8a9aad63476f3acd97517358b7f22fde8394d21e
- Formbricks commit: bf06fa583733c61334ede3e13b311fb9d89644af

## Notes

- 7 run(s) changed the lab app checkout while running.
