# Formbricks eval summary, 2026-10-06

Suite `2026-10-06T13-32-52-625Z-suite-b045d9`. Mission: rename-survey-and-question. Timeout: 600 s.

Passes are out of the runs stored for the arm. Each cell is the median, then the lowest and highest in parentheses. Wall time, tokens and cost are the task turn's alone: the setup turn before it, where Claude Code starts up and loads the arm's skill, is not counted. Input and output tokens are the agent's own, without the prompt cache; all tokens add the cache's reads and writes, which Claude Code bills at a fraction and a premium of the input price. Combined cost is the agent's cost plus the Goal Loop's where it ran.

| Arm                | Passes | Wall time                  | Tool calls    | Input and output tokens | All tokens                   | Combined cost                          |
| ------------------ | ------ | -------------------------- | ------------- | ----------------------- | ---------------------------- | -------------------------------------- |
| playwright-mcp     | 3 of 3 | 46.9 s (45.1 s to 54.7 s)  | 13 (11 to 14) | 1,546 (1,463 to 1,806)  | 381,043 (306,340 to 406,431) | $0.155 ($0.126 to $0.166)              |
| playwright-cli     | 3 of 3 | 60.8 s (56.7 s to 137.3 s) | 14 (13 to 20) | 1,557 (1,459 to 2,575)  | 473,416 (449,694 to 743,024) | $0.140 ($0.140 to $0.225)              |
| ayme-goal-loop-off | 3 of 3 | 38.1 s (23.2 s to 38.9 s)  | 6 (5 to 6)    | 755 (752 to 763)        | 142,361 (119,833 to 166,395) | $0.129 ($0.126 to $0.171)              |
| ayme-goal-loop-on  | 3 of 3 | 56.7 s (25.5 s to 63.3 s)  | 5 (5 to 9)    | 1,055 (904 to 1,679)    | 136,070 (133,330 to 316,723) | $0.151 ($0.103 to $0.198), 2 of 3 runs |

## Versions a rerun must match

- Date: 2026-10-06
- Claude Code: 2.1.281
- Model: claude-sonnet-5 (requested sonnet, effort medium)
- @playwright/mcp 0.0.83 (playwright-mcp)
- @playwright/cli 0.1.22 (playwright-cli)
- @ayme-dev/mcp 0.1.0 (ayme-goal-loop-off)
- @ayme-dev/mcp 0.1.0 (ayme-goal-loop-on)
- Browser: 154.0.8037.98
- Ayme commit: f91c98a4dc4c4eb789d6502008a0c3f05c1a8b5b
- Formbricks commit: 8535b463970d3f1d5c33ba6e4fe539a78b56c88c

## Notes

- ayme-goal-loop-on: combined cost is over 2 of 3 runs; the others have no data.
- ayme-goal-loop-on: the Goal Loop's cost is unknown in 1 of 3 runs, so their combined cost is unknown.
- 2 run(s) changed the lab app checkout while running.
