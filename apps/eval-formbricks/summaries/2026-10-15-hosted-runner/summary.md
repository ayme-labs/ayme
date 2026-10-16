# Formbricks eval summary, 2026-10-15

Suite `2026-10-15T21-11-38-852Z-suite-bdd6c7`. Mission: rename-survey-and-question. Timeout: 600 s.

Passes are out of the runs stored for the arm. Each cell is the median, then the lowest and highest in parentheses. Wall time, tokens and cost are the task turn's alone: the setup turn before it, where Claude Code starts up and loads the arm's skill, is not counted. Input and output tokens are the agent's own, without the prompt cache; all tokens add the cache's reads and writes, which Claude Code bills at a fraction and a premium of the input price. Combined cost is the agent's cost plus the Goal Loop's where it ran.

| Arm                                | Passes | Wall time                 | Tool calls    | Input and output tokens | All tokens                   | Combined cost             |
| ---------------------------------- | ------ | ------------------------- | ------------- | ----------------------- | ---------------------------- | ------------------------- |
| playwright-mcp                     | 3 of 3 | 44.6 s (35.3 s to 51.1 s) | 17 (14 to 18) | 2,011 (1,619 to 2,266)  | 377,084 (328,139 to 378,674) | $0.149 ($0.144 to $0.150) |
| playwright-cli                     | 3 of 3 | 41.9 s (34.4 s to 42.0 s) | 13 (10 to 14) | 1,260 (1,057 to 1,857)  | 465,080 (329,642 to 468,394) | $0.160 ($0.131 to $0.171) |
| ayme-goal-loop-off                 | 3 of 3 | 21.9 s (20.4 s to 22.0 s) | 6 (6 to 6)    | 842 (803 to 1,076)      | 134,304 (134,079 to 134,607) | $0.060 ($0.060 to $0.063) |
| ayme-goal-loop-on                  | 3 of 3 | 22.8 s (21.9 s to 23.7 s) | 5 (4 to 6)    | 957 (844 to 1,059)      | 120,314 (98,319 to 146,114)  | unknown                   |
| ayme-no-page-objects-goal-loop-off | 3 of 3 | 25.8 s (24.0 s to 26.3 s) | 9 (8 to 9)    | 1,095 (1,038 to 1,198)  | 211,305 (211,282 to 220,183) | $0.092 ($0.091 to $0.109) |
| ayme-no-page-objects-goal-loop-on  | 3 of 3 | 21.9 s (20.6 s to 25.4 s) | 4 (4 to 6)    | 846 (822 to 1,096)      | 112,959 (101,653 to 157,777) | unknown                   |

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

- ayme-goal-loop-on: no run has combined cost.
- ayme-goal-loop-on: the Goal Loop's cost is unknown in 3 of 3 runs, so their combined cost is unknown.
- ayme-no-page-objects-goal-loop-on: no run has combined cost.
- ayme-no-page-objects-goal-loop-on: the Goal Loop's cost is unknown in 3 of 3 runs, so their combined cost is unknown.
- 1 run(s) changed the lab app checkout while running.
