# Startup lane summary, 2026-11-01

Suite `2026-11-01T09-51-11-938Z-startup-suite-8e4a0b`. Timeout: 120 s.

Passes are out of the runs stored for the scenario. Each cell is the median, then the lowest and highest in parentheses. Setup time runs from sending the one message to its result; tokens add up input, cache creation, cache read and output. A run that timed out has neither.

| Scenario                      | Passes   | Setup time                | Tokens                    |
| ----------------------------- | -------- | ------------------------- | ------------------------- |
| drive-the-open-page           | 10 of 10 | 11.8 s (10.2 s to 14.5 s) | 28,801 (28,749 to 28,918) |
| drive-the-open-page-with-goal | 10 of 10 | 11.7 s (7.4 s to 18.8 s)  | 29,814 (29,672 to 29,887) |
| set-up-ayme                   | 9 of 10  | 12.9 s (9.9 s to 19.5 s)  | 27,624 (27,437 to 44,915) |
| design-page-objects           | 8 of 10  | 12.2 s (9.1 s to 15.5 s)  | 29,740 (29,402 to 30,052) |

## Files read

| Scenario                      | File                              | Runs that read it |
| ----------------------------- | --------------------------------- | ----------------- |
| drive-the-open-page           | references/page-tools.md          | 10 of 10          |
| drive-the-open-page-with-goal | references/goal.md                | 10 of 10          |
| drive-the-open-page-with-goal | references/page-tools.md          | 10 of 10          |
| set-up-ayme                   | references/onboarding.md          | 10 of 10          |
| set-up-ayme                   | references/runtime-integration.md | 10 of 10          |
| set-up-ayme                   | references/page-object-design.md  | 3 of 10           |
| set-up-ayme                   | references/browser-setup.md       | 1 of 10           |
| design-page-objects           | references/page-object-design.md  | 10 of 10          |
| design-page-objects           | references/live-mapping.md        | 2 of 10           |

## Versions a rerun must match

- Date: 2026-11-01
- Claude Code: 2.1.312
- Model: claude-sonnet-5-5 (requested sonnet, effort medium)
- Ayme commit: d243bdf267bfcb57c31d0bd36f15169f56ef6a65
