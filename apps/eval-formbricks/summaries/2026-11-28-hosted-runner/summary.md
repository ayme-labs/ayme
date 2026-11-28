# Formbricks eval summary, 2026-11-28

Suite `2026-11-28T13-22-19-138Z-suite-26327d`. Mission: rename-survey-and-question. Timeout: 600 s.

Passes are out of the runs stored for the arm. Each cell is the median, then the lowest and highest in parentheses. Wall time, tokens and cost are the task turn's alone: the setup turn before it, where Claude Code starts up and loads the arm's skill, is not counted. Input and output tokens are the agent's own, without the prompt cache; all tokens add the cache's reads and writes, which Claude Code bills at a fraction and a premium of the input price.

| Arm                      | Passes   | Wall time                 | Tool calls   | Input and output tokens | All tokens                   | Cost                      |
| ------------------------ | -------- | ------------------------- | ------------ | ----------------------- | ---------------------------- | ------------------------- |
| playwright-mcp           | 10 of 10 | 22.1 s (16.8 s to 25.5 s) | 12 (9 to 13) | 1,281 (1,113 to 1,470)  | 144,341 (119,176 to 177,485) | $0.075 ($0.063 to $0.082) |
| playwright-mcp-with-ayme | 10 of 10 | 16.7 s (12.9 s to 20.2 s) | 6 (4 to 7)   | 863 (720 to 1,064)      | 127,820 (90,307 to 147,172)  | $0.032 ($0.025 to $0.041) |
| playwright-cli           | 10 of 10 | 20.8 s (18.2 s to 27.5 s) | 4 (3 to 8)   | 748 (667 to 1,264)      | 107,555 (84,482 to 170,401)  | $0.045 ($0.043 to $0.055) |
| playwright-cli-with-ayme | 10 of 10 | 17.9 s (15.4 s to 23.1 s) | 5 (4 to 7)   | 876 (724 to 1,104)      | 139,328 (115,610 to 187,781) | $0.034 ($0.028 to $0.041) |
| agent-browser            | 6 of 10  | 12.9 s (6.2 s to 17.2 s)  | 4 (2 to 6)   | 793 (708 to 1,144)      | 79,425 (45,503 to 122,060)   | $0.037 ($0.030 to $0.052) |
| agent-browser-with-ayme  | 10 of 10 | 15.9 s (13.6 s to 18.1 s) | 5 (4 to 6)   | 782 (732 to 949)        | 110,489 (92,170 to 129,867)  | $0.029 ($0.027 to $0.034) |

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
