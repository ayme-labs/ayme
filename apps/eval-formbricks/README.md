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

  A `CLAUDE_CODE_OAUTH_TOKEN` already exported in the shell wins over the file. The token reaches only the agent's environment; it is never written to a run's files. Claude Code itself keeps it out of the MCP servers and Bash commands it starts: with Claude Code 2.1.281, neither a stdio MCP server nor a Bash command sees `CLAUDE_CODE_OAUTH_TOKEN`.

- For the Ayme arms, the lab app started with `AYME_OPENROUTER_API_KEY` exported (see [the lab README](../lab-formbricks/README.md#decision-endpoint)), and the same key in this package's `.env.local`, so a run can ask OpenRouter what the Goal Loop's calls cost. Without it the Goal Loop's cost is recorded as unknown. The key never reaches the agent: every `AYME_*` variable is stripped from its environment.

The run checks these first and names whichever is missing before anything starts. One of them is a clean lab app folder: `apps/lab-formbricks`, submodule included, with no untracked or modified file (gitignored files do not count), because the agent would see it.

## One run

From this directory inside `devbox shell`:

```sh
pnpm eval:run -- --arm playwright-mcp
pnpm eval:run -- --arm playwright-cli
pnpm eval:run -- --arm ayme-goal-loop-off
pnpm eval:run -- --arm ayme-goal-loop-on
```

Options: `--model` (default `sonnet`), `--timeout-seconds` (default `600`, the task turn's; see [what is measured](#what-is-measured)), `--mission` (default `rename-survey-and-question`). Every run calls the model and costs money.

The run:

1. Checks the preconditions, names the missing ones and stops; builds Formbricks's database package on the first run.
2. Seeds its own user, organization, workspace and survey through Formbricks's database package. Nothing earlier is cleared. It then waits until Formbricks's background worker has projected the new rows into its authorization store; without that, sign-in lands on "create organization".
3. Signs the user in and opens the seeded survey's editor in a fresh browser profile, with the browser the arm uses.
4. Runs the arm's setup, if it has one: whatever its interface needs outside the measured window (see the arm table). The measured agent installs and downloads nothing.
5. Starts Claude Code on the lab app folder with the arm's interface and nothing else, from a fresh, empty configuration folder inside the run folder, which is deleted afterwards. It sends the setup message, waits for the agent's answer, then sends the shared prompt with the arm's interface line. The measured window is that second message alone.
6. Reads the survey back from the database and decides pass or fail from the mission's expected end state. The agent's final message is kept but has no say.
7. Reads the Goal Loop's decision calls made during the run from the lab app's usage file and asks OpenRouter what they cost (see [the Ayme arms](#the-ayme-arms)). Arms without the Goal Loop record no calls.
8. Moves any file the agent created in the lab app folder into `agent-files/` (nothing is deleted; modified tracked files stay and are recorded), closes what the arm's setup started and writes everything under `results/runs/<run id>/`.

The exit code is `0` for a pass, `1` for a fail and `2` when the run could not complete.

## What is measured

The agent gets two messages in one Claude Code session, over its stream-json input, and answers each as its own turn:

1. The setup message, the same for every arm (`setup-prompt.txt`): get ready to work in the open page; load the browser interface's skill if one is in the skill list, and otherwise don't look for one; read no files, don't use the browser, and reply ready. It names no app, no task and no arm. Claude Code's start-up, the MCP server's tool list and the skill load land in this turn.
2. The task message (`prompt.txt`): the shared mission text with the arm's interface line, unchanged from a single-message run.

Every measured figure is the task turn's. Wall time runs from sending the task message to its `result` event. Tokens are that turn's usage. Cost is the session's cumulative cost at the end of the task turn minus its value at the end of the setup turn, since Claude Code's `total_cost_usd` accumulates over the session. Tool calls are those made after the task message. The Goal Loop's window starts with the task message too. The setup turn's own time, tokens, cost and tool calls are kept in the result's `setupTurn` and are never added to the measured figures.

The setup turn has its own 120 second timeout. A setup turn that runs out of it, or ends with an error, is a run that could not complete: nothing is measured and the transcript stays in the run folder. The run's `--timeout-seconds` covers the task turn.

With a task this small, the agent's start-up and skill load would otherwise be a large share of every number, and a share that differs between arms. Longer, real tasks, where the setup matters less, are a later follow-up.

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

The report command rebuilds `summary.md` and `summary.json` from the stored runs listed in the suite's manifest. It launches no agent and needs neither the lab app nor a Claude Code token, so a change to the report costs nothing to re-run. The suite writes the same summary when it ends.

When the OpenRouter key is in `.env.local`, the report first fills in the Goal Loop cost of every stored run that still lacks it: OpenRouter's record of a generation can appear minutes to an hour after the call, so a run's end usually comes too early for it (see [the Ayme arms](#the-ayme-arms)). The run's `result.json` and `summary.md` are rewritten with the cost and the combined cost. Run `pnpm eval:report` again an hour after a suite with the Goal Loop before publishing its summary.

Per arm the summary shows:

- passes out of the runs stored for the arm; failed and timed-out runs count in the runs;
- the median, lowest and highest of wall time, tokens and combined cost, all of the task turn alone. Tokens are the agent's input, cache creation, cache read and output tokens added up. Combined cost is the agent's cost plus the Goal Loop's where it ran; when the Goal Loop ran at an unknown cost, the run's combined cost is unknown, and the notes say for how many runs. A failed run still contributes its time, tokens and cost. A run without a figure counts in the passes and the runs but not in that column; the cell then says how many runs it rests on, or `unknown` when none has it. With an even count the median is the mean of the two middle values.

It also records what a rerun must match: the Claude Code version, the model, the pinned browser interface of each arm (the Playwright CLI, Playwright MCP and `@ayme-dev/mcp` versions), the browser, the Ayme and Formbricks commits, the timeout and the date. If the runs of a suite differ in one of these, the summary lists every value and says so.

`--publish` writes the summary, formatted with the repository's Prettier, to `summaries/<date>/summary.md` and `summary.json`, dated by the day the suite started. That folder is meant to be committed; a second summary for the same day replaces the first. `results/` stays ignored, so transcripts, prompts and run folders are never committed.

## What a run stores

`results/` is ignored by git. Each run folder holds:

| File                 | Holds                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mission.json`       | The seeded values, ids, credentials and URLs                                                                                                                                                                                                                                                                                                         |
| `setup-prompt.txt`   | The setup message as sent, the first of the two messages (see [what is measured](#what-is-measured))                                                                                                                                                                                                                                                 |
| `prompt.txt`         | The task message as sent                                                                                                                                                                                                                                                                                                                             |
| `mcp.json`           | The MCP servers the agent was given (none for the Playwright CLI arm)                                                                                                                                                                                                                                                                                |
| `init-page.cjs`      | The script that opens the editor in the agent's browser                                                                                                                                                                                                                                                                                              |
| `transcript.jsonl`   | Claude Code's raw stream-json transcript, one event per line, the setup turn's events followed by the task turn's                                                                                                                                                                                                                                    |
| `stderr.log`         | Claude Code's standard error                                                                                                                                                                                                                                                                                                                         |
| `final.md`           | The agent's final message                                                                                                                                                                                                                                                                                                                            |
| `verdict.json`       | The database check: each expectation and what was found                                                                                                                                                                                                                                                                                              |
| `result.json`        | The normalized result: verdict, wall time, input, cache creation, cache read and output tokens, cost, the Goal Loop's calls, tokens and cost, combined cost, tool calls and failures per tool, all of the task turn; the setup turn's own figures; versions, isolation, what the arm's setup established, files the agent left in the lab app folder |
| `ayme-mcp.log`       | The standard error of the run's Ayme MCP server (the Ayme arms only)                                                                                                                                                                                                                                                                                 |
| `ayme-mcp-proxy.cjs` | The command Claude Code started as its `ayme` MCP server: a proxy to the run's server (the Ayme arms only)                                                                                                                                                                                                                                           |
| `agent-files/`       | Files the agent created in the lab app folder, moved here with their relative paths (the folder exists only then)                                                                                                                                                                                                                                    |
| `summary.md`         | The result in a few lines                                                                                                                                                                                                                                                                                                                            |

Wall time, tokens, cost and tool calls are the task turn's (see [what is measured](#what-is-measured)); seeding, sign-in and the setup turn are outside it. `setupTurn` holds the setup turn's own: when the agent was started, its wall time, tokens, cost and tool calls. `startedAt` is when the task message was sent. `goalLoop` holds the Goal Loop's decision calls during the run: how many, how many failed, their input and output tokens, their OpenRouter generation ids, and their cost from OpenRouter's own records, `null` while any call's record is missing (the report command fills it in later). `combinedCostUsd` is the agent's cost plus the Goal Loop's; it equals the agent's cost when the Goal Loop made no call and is `null` when either is unknown. `setup` holds what the arm's setup established before the measured window: for the Ayme arms the server's port, the page it paired with, when it paired and how long after the editor opened, its tools, and whether `goal` was published. A suite adds `results/suites/<suite id>/` with its manifest (`suite.json`) and summary.

The browser profile is deleted after the run; the seeded data stays.

## Missions and arms

A mission is data in [`src/missions.ts`](src/missions.ts): the values to seed and the end state to expect. The values the agent has to type carry a short random nonce, so typing length does not dominate the measurement; the full run id stays in the seeded user, organization and workspace names, where uniqueness matters. The one mission so far renames a survey, changes its question's headline, saves and closes, and confirms the summary page shows the new name.

An arm is an entry in [`src/arms.ts`](src/arms.ts): its one prompt line, its MCP servers, the built-in tools it leaves the agent, the permission rules that let it use its interface (and any that stay denied), its own preconditions, and an optional setup that runs before the measured window. Everything else is shared, in [`src/claude.ts`](src/claude.ts) and [`src/prompt.ts`](src/prompt.ts): Sonnet, the setup message, a 600 second timeout for the task turn, and an isolated Claude Code configuration: a fresh configuration folder per run, an environment stripped of every `CLAUDE*`, `ANTHROPIC*` and `AYME_*` variable of whoever launches the eval, no project settings, no user settings or skills beyond that empty folder, and no MCP servers beyond the arm's own. The agent keeps read-only file tools, so it can look at the Formbricks source but can change the app only through its browser interface. The result records the tools, MCP servers, skills and plugins the agent was given; the skills and plugins listed are the ones built into Claude Code, which an isolated configuration still has.

| Arm                  | Interface                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright-mcp`     | The pinned `@playwright/mcp` server, headless, on the system Chrome, with the signed-in profile and the editor open. The tools the page registers through WebMCP stay off, so the agent gets Playwright MCP's own tools only. Its version is recorded in the result. The agent calls it through Claude Code's MCP permissions.                                                                      |
| `playwright-cli`     | The pinned `@playwright/cli` command and its official skill, with no MCP server. Its version is recorded in the result. Details below.                                                                                                                                                                                                                                                              |
| `ayme-goal-loop-off` | The page's own tools, `snapshot`, Ayme's Browser Tools and Page Object Tools, through Ayme's MCP server, `ayme mcp` from this repository's `@ayme-dev/mcp`, paired with the page before the agent starts, and this package's `ayme` skill, with no Playwright interface. The Goal Loop is off, so the page does not publish `goal`. The package's version is recorded in the result. Details below. |
| `ayme-goal-loop-on`  | The same, with the lab app's Goal Loop switch on, so the page also publishes `goal`, and the prompt's interface line adds one sentence: hand the goal to `goal` first and use the other tools only if it can't finish. The Goal Loop's own model calls, tokens and cost are added to the result.                                                                                                    |

### The Ayme arms

The agent gets Ayme's MCP server, named `ayme`, as its one MCP server, and the read-only file tools. Nothing else: no Playwright interface, no Bash. The server is `ayme mcp` from the workspace's `@ayme-dev/mcp`, built by `pnpm build`, the same package `lab:prepare` packs into the lab app, so server and page client match. Its own tools stay allowed: `ayme_connect` only returns a link, which the agent has no tool to open, and a server busy with its tab ignores any other tab's scan, so the agent cannot move the server away from the harness's tab; `ayme_list_tools` and `ayme_call` are the fallbacks the server offers every agent. Both arms run the same build of the lab app; the Goal Loop switch is the cookie the setup sets before the page loads (see [the lab README](../lab-formbricks/README.md#goal-loop-switch)).

Set up outside the measured window:

- **The server, paired before the agent starts.** A coding agent normally starts `ayme mcp` itself, and a tab of the app on `localhost` pairs with it by itself when it loads or gains focus. Claude Code starts its MCP servers only when the agent starts and reads their tool lists at once, so a tab that paired then would reach the agent through a tool-list change somewhere around its first turn, before it in some runs and after it in others. So the harness starts the server itself, before the agent, on the first port of the range a page scans, 9350 to 9365, with `--port`, in the run's process, and hands its stdio to Claude Code through a small proxy over a Unix socket: the `ayme` server Claude Code starts is that proxy, written into the run folder, and the agent's first tool list already holds the page's tools. What the server says before the agent connects, the tool-list change of a pairing no agent saw, is dropped. The run refuses to start while anything listens in that range, such as another coding agent's `ayme mcp`, because the page would then find two servers and pair with neither. The server's standard error is kept in the run folder.
- **The page.** A headless system Chrome on the profile the harness signed in to, with the Goal Loop cookie for the "on" arm, opens the seeded survey's editor and stays open for the run. The page looks for a server as it loads and pairs with the run's. The setup waits until the tab holds the pairing the server welcomed it with, until the server has logged the pairing, and until the page publishes the editor's Page Object Tools, with `goal` for the "on" arm and without it for the "off" arm; what it saw, with the time the pairing took, is recorded in the result's `setup`. The browser is closed and the server stopped after the run.
- **The skill.** This package's own [`skills/ayme`](skills/ayme/SKILL.md), the same for both Ayme arms, copied into the run's fresh Claude Code configuration folder under `skills/`, as the Playwright CLI arm's skill is; the permission rules allow only this one. It tells the agent to prefer the Page Object Tools, to read each action's answer instead of taking a snapshot, and, when `goal` is listed, to pass the values the task names. It names no app and no task.
- **Time per call.** The `goal` tool runs the whole Goal Loop inside one call. The server waits for the page's answer however long it takes, so only Claude Code's own per-call limit (`MCP_TOOL_TIMEOUT`, set for these arms only) has to allow a call several minutes.

The Goal Loop's own model usage is read after the run from the lab app's Decision Endpoint usage file (see [the lab README](../lab-formbricks/README.md#decision-endpoint)): `apps/lab-formbricks/formbricks/apps/web/.ayme-lab/decision-usage.jsonl`, or the file `AYME_LAB_DECISION_USAGE_FILE` names, which must then be set to the same path for `lab:dev` and for the eval. The file lives for the lab app's lifetime, so a run's calls are the lines whose time falls between the agent's start and its end. Token counts come from those lines. Cost comes from OpenRouter's own record of each generation, fetched by the generation id the lab app recorded, with the key in `.env.local`: what OpenRouter charged plus what the model's provider charged upstream, since Jev is billed through the provider's own key and the response's own `cost` field reads zero. A call whose record OpenRouter does not have yet, or whose id is missing, makes the run's Goal Loop cost unknown (`null`), never zero, and with it the combined cost. OpenRouter writes those records minutes to an hour after the call, so the run asks once and the report command asks again later. The same measurement runs for every arm, so an arm without the Goal Loop records zero calls and its combined cost equals the agent's.

### The Playwright CLI arm

The agent gets the `playwright-cli` command on its `PATH`, the CLI's official skill, the read-only file tools and Bash limited by permission rules to that command. Nothing else: no MCP server, and no other browser interface.

Set up outside the measured window, from the pinned package, with no download:

- **The command.** A one-line `playwright-cli` executable in the run folder's `bin/`, first on the agent's `PATH`.
- **The skill.** The package's `skills/playwright-cli` folder, the one `playwright-cli install --skills` installs, copied into the run's fresh Claude Code configuration folder under `skills/`. That is where Claude Code loads user skills from when its user settings source is on; the folder is empty otherwise, so it loads no skill but this one (Claude Code's own built-in skills stay listed, as for every arm; the permission rules allow only this one). The agent is given read access to the skill folder and the CLI's output folder, and to nothing else outside the lab app.
- **The session.** `playwright-cli open` on the seeded survey's editor, in the profile the harness signed in to, on the system Chrome, headless. The CLI names its session after the run, so the plain command reaches it. A restart keeps the profile. The CLI keeps its snapshots and logs in the run's `playwright-output/`. The session is closed after the run.
- **No update check, and no page tools.** The CLI's update check is off, and so is its handling of tools a page registers through WebMCP, which would hand the agent the lab app's own Ayme tools.
- **Denied commands.** `npx` (the skill pre-approves `npx playwright`, which would run the lab app's own Playwright), `playwright-cli install` and `install-browser`, and `playwright-cli kill-all`, which kills every Playwright daemon on the machine.

## Tests

`pnpm test` runs the unit tests, which CI runs too. They cover building the summary from stored results (medians and ranges for odd and even run counts, failed runs in the pass counts, a run without usage data), the suite's options, the step from stored run artifacts to the normalized result, with recorded-shape two-turn fixture transcripts under [`src/fixtures/`](src/fixtures) (a complete run, with the measured figures taken from the task turn and the setup turn kept apart; a task turn without a usage block; a task turn that timed out), the Claude Code driver itself, against a stand-in `claude` in [`src/fixtures/bin/`](src/fixtures/bin) that replays a fixture turn by turn (the task sent only after the setup turn's result, a setup turn that ends with an error, a setup turn and a task turn that run out of their timeouts), the verdict function (mission plus survey record to pass or fail; the database read stays outside it), the Goal Loop's usage (selecting a run's lines by its window, tokens and cost from the lines and OpenRouter's records, an unknown cost when a record is missing, and the combined cost with and without a Goal Loop), the arms' interfaces, the Ayme arms' proxy to the server (its stdio reaches the socket and back), the prompt, which differs between arms in its interface line alone, and the setup message, which names no app, task or arm. Nothing in the tests needs the lab app, a browser or a model.
