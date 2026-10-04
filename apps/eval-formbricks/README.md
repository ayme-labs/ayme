# Formbricks eval

Runs one mission on the [Formbricks lab app](../lab-formbricks/README.md) through a coding agent and measures it: pass or fail from the database, wall time, tokens and cost from Claude Code's own output. The same mission runs through different browser interfaces, called arms, so the interface is the only variable.

This package is separate from the lab app on purpose. The agent's working root is `apps/lab-formbricks` and nothing else; missions, results and transcripts live here, where the agent cannot read them.

It runs on a Mac only, by hand. It is never part of CI or `pnpm check`; only its unit tests are.

## Prerequisites

- The lab app prepared and running: `pnpm lab:prepare` and `pnpm lab:dev` in `apps/lab-formbricks`
- Docker Desktop, running
- Google Chrome
- A long-lived Claude Code token in this package's git-ignored `.env.local`, created with `claude setup-token`:

  ```sh
  CLAUDE_CODE_OAUTH_TOKEN=<the token>
  ```

  A `CLAUDE_CODE_OAUTH_TOKEN` already exported in the shell wins over the file. The token reaches only the agent's environment; it is never written to a run's files.

The run checks these first and names whichever is missing before anything starts.

## One run

From this directory inside `devbox shell`:

```sh
pnpm eval:run -- --arm playwright-mcp
```

Options: `--model` (default `sonnet`), `--timeout-seconds` (default `600`), `--mission` (default `rename-survey-and-question`). Every run calls the model and costs money.

The run:

1. Checks the preconditions, names the missing ones and stops; builds Formbricks's database package on the first run.
2. Seeds its own user, organization, workspace and survey through Formbricks's database package. Nothing earlier is cleared. It then waits until Formbricks's background worker has projected the new rows into its authorization store; without that, sign-in lands on "create organization".
3. Signs the user in and opens the seeded survey's editor in a fresh browser profile, with the browser the arm uses.
4. Starts Claude Code on the lab app folder with the shared prompt, the arm's interface and nothing else, from a fresh, empty configuration folder inside the run folder, which is deleted afterwards. The measured window is this step alone.
5. Reads the survey back from the database and decides pass or fail from the mission's expected end state. The agent's final message is kept but has no say.
6. Writes everything under `results/runs/<run id>/`.

The exit code is `0` for a pass, `1` for a fail and `2` when the run could not complete.

## What a run stores

`results/` is ignored by git. Each run folder holds:

| File               | Holds                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mission.json`     | The seeded values, ids, credentials and URLs                                                                                                                |
| `prompt.txt`       | The prompt as sent                                                                                                                                          |
| `mcp.json`         | The MCP servers the agent was given                                                                                                                         |
| `init-page.cjs`    | The script that opens the editor in the agent's browser                                                                                                     |
| `transcript.jsonl` | Claude Code's raw stream-json transcript, one event per line                                                                                                |
| `stderr.log`       | Claude Code's standard error                                                                                                                                |
| `final.md`         | The agent's final message                                                                                                                                   |
| `verdict.json`     | The database check: each expectation and what was found                                                                                                     |
| `result.json`      | The normalized result: verdict, wall time, input, cache creation, cache read and output tokens, cost, tool calls and failures per tool, versions, isolation |
| `summary.md`       | The result in a few lines                                                                                                                                   |

Wall time runs from the agent's first event to its last; seeding and sign-in are outside it. Cost and tokens come from Claude Code's result event. `goalLoop` and `combinedCostUsd` are reserved for arms that run the Goal Loop; the agent's cost stands alone until then.

The browser profile is deleted after the run; the seeded data stays.

## Missions and arms

A mission is data in [`src/missions.ts`](src/missions.ts): the values to seed and the end state to expect. The values the agent has to type carry a short random nonce, so typing length does not dominate the measurement; the full run id stays in the seeded user, organization and workspace names, where uniqueness matters. The one mission so far renames a survey, changes its question's headline, saves and closes, and confirms the summary page shows the new name.

An arm is an entry in [`src/arms.ts`](src/arms.ts): its one prompt line, its MCP servers, the built-in tools it leaves the agent and the permission rules that let it use its interface. Everything else is shared, in [`src/claude.ts`](src/claude.ts): Sonnet, a 600 second timeout, and an isolated Claude Code configuration: a fresh configuration folder per run, an environment stripped of every `CLAUDE*` and `ANTHROPIC*` variable of whoever launches the eval, no user or project settings, no skills and no MCP servers beyond the arm's own. The agent keeps read-only file tools, so it can look at the Formbricks source but can change the app only through its browser interface. The result records the tools, MCP servers, skills and plugins the agent was given; the skills and plugins listed are the ones built into Claude Code, which an isolated configuration still has.

| Arm              | Interface                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `playwright-mcp` | The pinned `@playwright/mcp` server, headless, on the system Chrome, with the signed-in profile and the editor open. The tools the page registers through WebMCP stay off, so the agent gets Playwright MCP's own tools only. Its version is recorded in the result. The agent calls it through Claude Code's MCP permissions. |

## Tests

`pnpm test` runs the unit tests, which CI runs too. They cover the step from stored run artifacts to the normalized result, with recorded fixture transcripts under [`src/fixtures/`](src/fixtures) (a complete run, a result without a usage block, a timed-out run), the verdict function (mission plus survey record to pass or fail; the database read stays outside it), and the prompt. Nothing in the tests needs the lab app, a browser or a model.
