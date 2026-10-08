# Formbricks eval summary, 2026-10-06

Suite `2026-10-06T17-36-24-528Z-suite-combined`. Mission: sign-in-create-and-revise-survey. Timeout: 600 s.

Passes are out of the runs stored for the arm. Each cell is the median, then the lowest and highest in parentheses. Wall time, tokens and cost are the task turn's alone: the setup turn before it, where Claude Code starts up and loads the arm's skill, is not counted. Input and output tokens are the agent's own, without the prompt cache; all tokens add the cache's reads and writes, which Claude Code bills at a fraction and a premium of the input price. Combined cost is the agent's cost plus the Goal Loop's where it ran.

| Arm                | Passes | Wall time                    | Tool calls    | Input and output tokens | All tokens                         | Combined cost             |
| ------------------ | ------ | ---------------------------- | ------------- | ----------------------- | ---------------------------------- | ------------------------- |
| playwright-mcp     | 3 of 3 | 130.7 s (126.9 s to 134.0 s) | 32 (28 to 33) | 3,700 (3,150 to 3,773)  | 1,035,679 (948,126 to 1,102,986)   | $0.359 ($0.342 to $0.391) |
| playwright-cli     | 3 of 3 | 101.4 s (87.5 s to 242.1 s)  | 34 (26 to 36) | 3,452 (2,394 to 3,793)  | 1,327,448 (1,036,574 to 1,483,796) | $0.383 ($0.351 to $0.444) |
| ayme-goal-loop-off | 3 of 3 | 53.9 s (52.5 s to 116.3 s)   | 18 (16 to 24) | 2,111 (1,765 to 2,606)  | 495,924 (459,335 to 707,845)       | $0.398 ($0.377 to $0.465) |
| ayme-goal-loop-on  | 3 of 3 | 66.8 s (62.8 s to 88.5 s)    | 13 (7 to 14)  | 1,870 (1,817 to 2,146)  | 430,447 (264,635 to 441,291)       | $0.376 ($0.355 to $0.476) |

## Versions a rerun must match

- Date: 2026-10-06
- Claude Code: 2.1.281
- Model: claude-sonnet-5 (requested sonnet, effort medium)
- @playwright/mcp 0.0.83 (playwright-mcp)
- @playwright/cli 0.1.22 (playwright-cli)
- @ayme-dev/mcp 0.1.0 (ayme-goal-loop-off)
- @ayme-dev/mcp 0.1.0 (ayme-goal-loop-on)
- Browser: 154.0.8037.98
- Ayme commit: d545f4de0658f4cda5c2dd766d2a893f6488f4bd
- Formbricks commit: 8535b463970d3f1d5c33ba6e4fe539a78b56c88c

## Notes

- The 12 runs come from three suites: 2026-10-06T17-36-24-528Z-suite-cd5bbc stopped after 7 runs, when the next run's setup turn got no answer from the model within its 120 s timeout; 2026-10-06T18-05-01-673Z-suite-4d046a and 2026-10-06T18-13-30-618Z-suite-970588 ran the 5 runs still missing. The run that could not complete is not counted. The load at each run is in load.md.
- 1 run(s) changed the lab app checkout while running.
