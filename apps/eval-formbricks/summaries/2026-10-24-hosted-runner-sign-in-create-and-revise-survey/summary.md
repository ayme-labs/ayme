# Formbricks eval summary, 2026-10-24

Suite `2026-10-24T07-37-27-184Z-suite-7db05d`. Mission: sign-in-create-and-revise-survey. Timeout: 600 s.

Passes are out of the runs stored for the arm. Each cell is the median, then the lowest and highest in parentheses. Wall time, tokens and cost are the task turn's alone: the setup turn before it, where Claude Code starts up and loads the arm's skill, is not counted. Input and output tokens are the agent's own, without the prompt cache; all tokens add the cache's reads and writes, which Claude Code bills at a fraction and a premium of the input price. Combined cost is the agent's cost plus the Goal Loop's where it ran.

| Arm                                | Passes   | Wall time                  | Tool calls    | Input and output tokens | All tokens                       | Combined cost             |
| ---------------------------------- | -------- | -------------------------- | ------------- | ----------------------- | -------------------------------- | ------------------------- |
| playwright-mcp                     | 10 of 10 | 91.3 s (82.8 s to 112.4 s) | 34 (31 to 38) | 3,672 (3,442 to 4,319)  | 953,639 (874,299 to 1,192,941)   | $0.365 ($0.337 to $0.444) |
| playwright-cli                     | 10 of 10 | 86.0 s (73.4 s to 119.5 s) | 26 (25 to 34) | 2,945 (2,368 to 3,667)  | 1,024,229 (943,478 to 1,400,776) | $0.325 ($0.305 to $0.433) |
| ayme-goal-loop-off                 | 10 of 10 | 56.7 s (47.8 s to 61.0 s)  | 21 (19 to 24) | 2,323 (2,134 to 2,570)  | 581,355 (521,119 to 697,366)     | $0.251 ($0.233 to $0.301) |
| ayme-goal-loop-on                  | 10 of 10 | 47.8 s (38.6 s to 60.5 s)  | 5 (4 to 20)   | 2,162 (1,469 to 2,654)  | 147,281 (115,765 to 620,843)     | $0.113 ($0.093 to $0.258) |
| ayme-no-page-objects-goal-loop-off | 10 of 10 | 56.3 s (51.3 s to 69.4 s)  | 22 (19 to 28) | 2,217 (1,959 to 2,619)  | 626,300 (553,827 to 885,732)     | $0.256 ($0.230 to $0.343) |
| ayme-no-page-objects-goal-loop-on  | 10 of 10 | 62.4 s (48.0 s to 71.3 s)  | 13 (8 to 19)  | 2,750 (2,045 to 3,342)  | 419,796 (225,408 to 636,142)     | $0.216 ($0.124 to $0.277) |

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

- 3 run(s) changed the lab app checkout while running.
