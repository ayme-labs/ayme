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

## A suite

From this directory inside `devbox shell`:

```sh
pnpm eval:suite -- --runs 3
```

Options: `--arms` (comma-separated, default every arm in [`src/arms.ts`](src/arms.ts)), `--runs` per arm (default `3`), `--model` (default `sonnet`), `--timeout-seconds` (default `600`), `--mission`. Every run uses the same timeout and settings and seeds its own mission. Every run calls the model and costs money; the smallest suite is one arm and one run:

```sh
pnpm eval:suite -- --arms playwright-mcp --runs 1
```

The suite:

1. Checks the preconditions before it creates anything. Each run checks them again, so a lab app that goes down mid-suite is caught.
2. Warms the lab app, outside every measured window: Turbopack compiles each route on its first visit, so it seeds a throwaway mission, signs in and visits the editor, the survey list and the summary page. This only checks that the lab app is reachable and visits it; it never starts or restarts it. The save itself compiles on its first call and cannot be warmed without changing data, so the first run of a suite can still carry that cost.
3. Runs the arms round-robin (run 1 of each arm, then run 2, and so on), so a suite that stops early still holds comparable runs.
4. Writes its manifest and summary to `results/suites/<suite id>/`.

The first run that cannot complete (a missing precondition, an unreachable lab app, a failed seed) ends the suite. The runs stored so far are summarized and the summary says the suite stopped early. A failed verdict is a result, not an error.

## The summary

```sh
pnpm eval:report                         # the newest suite
pnpm eval:report -- --suite <suite id>
pnpm eval:report -- --publish            # also write summaries/<date>/
```

The report command rebuilds `summary.md` and `summary.json` from the stored runs listed in the suite's manifest. It launches no agent and needs neither the lab app nor a token, so a change to the report costs nothing to re-run. The suite writes the same summary when it ends.

Per arm the summary shows:

- passes out of the runs stored for the arm; failed and timed-out runs count in the runs;
- the median, lowest and highest of wall time, tokens and combined cost. Tokens are the agent's input, cache creation, cache read and output tokens added up. Combined cost is the agent's cost plus the Goal Loop's where it ran. A failed run still contributes its time, tokens and cost. A run without usage data counts in the passes and the runs but not in tokens and cost; the cell then says how many runs it rests on. With an even count the median is the mean of the two middle values.

It also records what a rerun must match: the Claude Code version, the model, the pinned browser interface of each arm (Playwright CLI and Playwright MCP versions), the browser, the Ayme and Formbricks commits, the timeout and the date. If the runs of a suite differ in one of these, the summary lists every value and says so.

`--publish` writes the summary, formatted with the repository's Prettier, to `summaries/<date>/summary.md` and `summary.json`, dated by the day the suite started. That folder is meant to be committed; a second summary for the same day replaces the first. `results/` stays ignored, so transcripts, prompts and run folders are never committed.

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

Wall time runs from the agent's first event to its last; seeding and sign-in are outside it. Cost and tokens come from Claude Code's result event. `goalLoop` and `combinedCostUsd` are reserved for arms that run the Goal Loop; the agent's cost stands alone until then. A suite adds `results/suites/<suite id>/` with its manifest (`suite.json`) and summary.

The browser profile is deleted after the run; the seeded data stays.

## Missions and arms

A mission is data in [`src/missions.ts`](src/missions.ts): the values to seed and the end state to expect. The values the agent has to type carry a short random nonce, so typing length does not dominate the measurement; the full run id stays in the seeded user, organization and workspace names, where uniqueness matters. The one mission so far renames a survey, changes its question's headline, saves and closes, and confirms the summary page shows the new name.

An arm is an entry in [`src/arms.ts`](src/arms.ts): its one prompt line, its MCP servers, the built-in tools it leaves the agent and the permission rules that let it use its interface. Everything else is shared, in [`src/claude.ts`](src/claude.ts): Sonnet, a 600 second timeout, and an isolated Claude Code configuration: a fresh configuration folder per run, an environment stripped of every `CLAUDE*` and `ANTHROPIC*` variable of whoever launches the eval, no user or project settings, no skills and no MCP servers beyond the arm's own. The agent keeps read-only file tools, so it can look at the Formbricks source but can change the app only through its browser interface. The result records the tools, MCP servers, skills and plugins the agent was given; the skills and plugins listed are the ones built into Claude Code, which an isolated configuration still has.

| Arm              | Interface                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright-mcp` | The pinned `@playwright/mcp` server, headless, on the system Chrome, with the signed-in profile and the editor open. Its version is recorded in the result. The agent calls it through Claude Code's MCP permissions. |

## Tests

`pnpm test` runs the unit tests, which CI runs too. They cover building the summary from stored results (medians and ranges for odd and even run counts, failed runs in the pass counts, a run without usage data), the suite's options, the step from stored run artifacts to the normalized result, with recorded fixture transcripts under [`src/fixtures/`](src/fixtures) (a complete run, a result without a usage block, a timed-out run), the verdict function (mission plus survey record to pass or fail; the database read stays outside it), and the prompt. Nothing in the tests needs the lab app, a browser or a model.
