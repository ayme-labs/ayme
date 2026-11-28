# Formbricks eval summary, 2026-11-28

Suite `2026-11-28T14-03-51-595Z-suite-f80a44`. Mission: sign-in-create-and-revise-survey. Timeout: 600 s.

Passes are out of the runs stored for the arm. Each cell is the median, then the lowest and highest in parentheses. Wall time, tokens and cost are the task turn's alone: the setup turn before it, where Claude Code starts up and loads the arm's skill, is not counted. Input and output tokens are the agent's own, without the prompt cache; all tokens add the cache's reads and writes, which Claude Code bills at a fraction and a premium of the input price.

| Arm                      | Passes   | Wall time                 | Tool calls    | Input and output tokens | All tokens                   | Cost                      |
| ------------------------ | -------- | ------------------------- | ------------- | ----------------------- | ---------------------------- | ------------------------- |
| playwright-mcp           | 10 of 10 | 49.2 s (43.2 s to 69.5 s) | 32 (28 to 36) | 2,772 (2,480 to 3,246)  | 483,009 (432,549 to 577,429) | $0.177 ($0.151 to $0.197) |
| playwright-mcp-with-ayme | 10 of 10 | 37.3 s (32.4 s to 43.3 s) | 16 (14 to 21) | 1,753 (1,594 to 1,963)  | 334,598 (308,905 to 442,390) | $0.092 ($0.083 to $0.104) |
| playwright-cli           | 9 of 10  | 63.4 s (27.6 s to 74.8 s) | 16 (7 to 21)  | 1,916 (1,263 to 2,284)  | 363,630 (155,775 to 525,884) | $0.095 ($0.050 to $0.128) |
| playwright-cli-with-ayme | 10 of 10 | 38.8 s (34.7 s to 49.1 s) | 14 (11 to 17) | 1,669 (1,519 to 2,201)  | 360,844 (297,456 to 455,014) | $0.074 ($0.068 to $0.093) |
| agent-browser            | 10 of 10 | 37.4 s (31.9 s to 74.1 s) | 12 (10 to 14) | 1,653 (1,414 to 2,151)  | 226,389 (185,822 to 281,046) | $0.072 ($0.065 to $0.096) |
| agent-browser-with-ayme  | 10 of 10 | 40.5 s (34.4 s to 48.1 s) | 12 (11 to 15) | 1,609 (1,501 to 1,997)  | 280,688 (251,608 to 354,228) | $0.076 ($0.059 to $0.091) |

## Versions a rerun must match

- Date: 2026-11-28
- Claude Code: 2.1.326
- Model: claude-sonnet-5-5 (requested sonnet, effort medium)
- @playwright/mcp 0.0.83 (playwright-mcp)
- @playwright/mcp 0.0.83 (playwright-mcp-with-ayme)
- @playwright/cli 0.1.22 (playwright-cli)
- @playwright/cli 0.1.22 (playwright-cli-with-ayme)
- agent-browser 0.41.2 (agent-browser)
- agent-browser 0.41.2 (agent-browser-with-ayme)
- Browser: 158.0.8127.36, 156.0.8078.4
- ayme commit: 482bad2baf85550acd54af8eb6bd2bc997dfc234
- Formbricks commit: 8abe0b4276d1e3aa25e40d5360ce59cd6e7a5bf2

## Notes

- 1 run(s) changed the lab app checkout while running.
