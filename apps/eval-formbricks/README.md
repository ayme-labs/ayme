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
pnpm eval:run -- --arm playwright-cli
```

Options: `--model` (default `sonnet`), `--timeout-seconds` (default `600`), `--mission` (default `rename-survey-and-question`). Every run calls the model and costs money.

The run:

1. Checks the preconditions, names the missing ones and stops; builds Formbricks's database package on the first run.
2. Seeds its own user, organization, workspace and survey through Formbricks's database package. Nothing earlier is cleared. It then waits until Formbricks's background worker has projected the new rows into its authorization store; without that, sign-in lands on "create organization".
3. Signs the user in and opens the seeded survey's editor in a fresh browser profile, with the browser the arm uses.
4. Runs the arm's setup, if it has one: whatever its interface needs outside the measured window (see the arm table). The measured agent installs and downloads nothing.
5. Starts Claude Code on the lab app folder with the shared prompt, the arm's interface and nothing else, from a fresh, empty configuration folder inside the run folder, which is deleted afterwards. The measured window is this step alone.
6. Reads the survey back from the database and decides pass or fail from the mission's expected end state. The agent's final message is kept but has no say.
7. Closes what the arm's setup started and writes everything under `results/runs/<run id>/`.

The exit code is `0` for a pass, `1` for a fail and `2` when the run could not complete.

## What a run stores

`results/` is ignored by git. Each run folder holds:

| File               | Holds                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mission.json`     | The seeded values, ids, credentials and URLs                                                                                                                |
| `prompt.txt`       | The prompt as sent                                                                                                                                          |
| `mcp.json`         | The MCP servers the agent was given (none for the Playwright CLI arm)                                                                                       |
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

An arm is an entry in [`src/arms.ts`](src/arms.ts): its one prompt line, its MCP servers, the built-in tools it leaves the agent, the permission rules that let it use its interface (and any that stay denied), and an optional setup that runs before the measured window. Everything else is shared, in [`src/claude.ts`](src/claude.ts): Sonnet, a 600 second timeout, and an isolated Claude Code configuration: a fresh configuration folder per run, an environment stripped of every `CLAUDE*` and `ANTHROPIC*` variable of whoever launches the eval, no project settings, no user settings or skills beyond that empty folder, and no MCP servers beyond the arm's own. The agent keeps read-only file tools, so it can look at the Formbricks source but can change the app only through its browser interface. The result records the tools, MCP servers, skills and plugins the agent was given; the skills and plugins listed are the ones built into Claude Code, which an isolated configuration still has.

| Arm              | Interface                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright-mcp` | The pinned `@playwright/mcp` server, headless, on the system Chrome, with the signed-in profile and the editor open. Its version is recorded in the result. The agent calls it through Claude Code's MCP permissions. |
| `playwright-cli` | The pinned `@playwright/cli` command and its official skill, with no MCP server. Its version is recorded in the result. Details below.                                                                                |

### The Playwright CLI arm

The agent gets the `playwright-cli` command on its `PATH`, the CLI's official skill, the read-only file tools and Bash limited by permission rules to that command. Nothing else: no MCP server, and no other browser interface.

Set up outside the measured window, from the pinned package, with no download:

- **The command.** A one-line `playwright-cli` executable in the run folder's `bin/`, first on the agent's `PATH`.
- **The skill.** The package's `skills/playwright-cli` folder, the one `playwright-cli install --skills` installs, copied into the run's fresh Claude Code configuration folder under `skills/`. That is where Claude Code loads user skills from when its user settings source is on; the folder is empty otherwise, so it loads no skill but this one (Claude Code's own built-in skills stay listed, as for every arm; the permission rules allow only this one). The agent is given read access to the skill folder and the CLI's output folder, and to nothing else outside the lab app.
- **The session.** `playwright-cli open` on the seeded survey's editor, in the profile the harness signed in to, on the system Chrome, headless. The CLI names its session after the run, so the plain command reaches it. A restart keeps the profile. The CLI keeps its snapshots and logs in the run's `playwright-output/`. The session is closed after the run.
- **No update check, and no page tools.** The CLI's update check is off, and so is its handling of tools a page registers through WebMCP, which would hand the agent the lab app's own Ayme tools.
- **Denied commands.** `npx` (the skill pre-approves `npx playwright`, which would run the lab app's own Playwright), `playwright-cli install` and `install-browser`, and `playwright-cli kill-all`, which kills every Playwright daemon on the machine.

## Tests

`pnpm test` runs the unit tests, which CI runs too. They cover the step from stored run artifacts to the normalized result, with recorded fixture transcripts under [`src/fixtures/`](src/fixtures) (a complete run, a result without a usage block, a timed-out run), the verdict function (mission plus survey record to pass or fail; the database read stays outside it), and the prompt. Nothing in the tests needs the lab app, a browser or a model.
