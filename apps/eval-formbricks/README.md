# Formbricks eval

Runs a mission on the [Formbricks lab app](../lab-formbricks/README.md) through a coding agent and measures it: pass or fail from the database, wall time, tokens and cost from Claude Code's own output. The same mission runs through different browser interfaces, called arms, so the interface is the only variable.

This package is separate from the lab app on purpose. The agent's working root is the Formbricks source, `apps/lab-formbricks/formbricks`, and nothing else; missions, results, transcripts and the lab app's Page Objects in `apps/lab-formbricks/.ayme/` stay outside it, where the agent cannot read them.

It runs by hand, on a Mac or [on a hosted runner](#on-a-hosted-runner). It is never part of CI or `pnpm check`; only its unit tests are.

The package also holds [the startup lane](#the-startup-lane), which checks that the shipped `ayme` skill routes an agent to the right references. It needs none of what follows but Claude Code and the token.

## Prerequisites

- The lab app prepared and running: `pnpm lab:prepare` and `pnpm lab:dev` in `apps/lab-formbricks`
- Docker Desktop, running
- Google Chrome
- A long-lived Claude Code token in this package's git-ignored `.env.local`, created with `claude setup-token`:

  ```sh
  CLAUDE_CODE_OAUTH_TOKEN=<the token>
  ```

  A `CLAUDE_CODE_OAUTH_TOKEN` already exported in the shell wins over the file. The token reaches only the agent's environment; it is never written to a run's files. Claude Code itself keeps it out of the MCP servers and Bash commands it starts: with Claude Code 2.1.281, neither a stdio MCP server nor a Bash command sees `CLAUDE_CODE_OAUTH_TOKEN`.

- For the agent-browser arms, nothing more: the pinned `agent-browser` package ships its native binary, and it attaches to the harness's Chrome
- For the arms with Ayme, the workspace built (`pnpm lab:prepare` builds `@ayme-dev/mcp`, `@ayme-dev/ayme` and `@ayme-dev/webmcp`), and nothing listening on ports 9350 to 9365

The run checks these first and names whichever is missing before anything starts. One of them is a clean lab app folder: `apps/lab-formbricks`, submodule included, with no untracked or modified file (gitignored files do not count), because the agent would see it.

## One run

From this directory inside `devbox shell`:

```sh
pnpm eval:run -- --arm playwright-mcp
pnpm eval:run -- --arm playwright-mcp-with-ayme-page-objects
pnpm eval:run -- --arm playwright-cli-with-ayme-webmcp
pnpm eval:run -- --arm agent-browser
```

Options: `--model` (default `sonnet`), `--timeout-seconds` (default `600`, the task turn's; see [what is measured](#what-is-measured)), `--mission` (default `rename-survey-and-question`; see [missions and arms](#missions-and-arms)). Every run calls the model and costs money.

The run:

1. Checks the preconditions, names the missing ones and stops; builds Formbricks's database package on the first run.
2. Seeds its own user, organization and workspace, and the mission's survey when it has one, through Formbricks's database package. Nothing earlier is cleared. It then waits until Formbricks's background worker has projected the new rows into its authorization store; without that, sign-in lands on "create organization".
3. Opens the mission's start page in a fresh browser profile, with the browser the arm uses: signed in on the seeded survey's editor, or, for a mission that starts signed out, the sign-in page in a profile that holds no session. Either way the route is compiled before the agent's browser opens it.
4. Runs the arm's setup, if it has one: whatever its interface needs outside the measured window (see the arm table). The measured agent installs and downloads nothing.
5. Starts Claude Code on the Formbricks source with the arm's interface and nothing else, from a fresh, empty configuration folder inside the run folder, which is deleted afterwards. It sends the setup message, waits for the agent's answer, then sends the shared prompt with the arm's interface line. The measured window is that second message alone.
6. Reads the seeded workspace's surveys back from the database and decides pass or fail from the mission's expected end state. The agent's final message is kept but has no say.
7. Moves any file the agent created in the lab app folder into `agent-files/` (nothing is deleted; modified tracked files stay and are recorded), closes what the arm's setup started and writes everything under `results/runs/<run id>/`.

The exit code is `0` for a pass, `1` for a fail and `2` when the run could not complete.

## What is measured

The agent gets two messages in one Claude Code session, over its stream-json input, and answers each as its own turn:

1. The setup message (`setup-prompt.txt`): get ready to work in the open page; load the arm's skill, named, with the Skill tool, or, for an arm without one, don't look for a skill; read no files, don't use the browser, and reply ready. The arms with Ayme are told instead to load the `ayme` skill beside their browser automation's, to read its `references/browser-automation-tools.md`, and to read no other file. It names no app and no task, and differs between arms only in those skills and that reading. Claude Code's start-up, the MCP servers' tool lists and the skill loads land in this turn, with the reference for the arms with Ayme. An unnamed "load your skill if you have one" left the agent skipping the load in some runs and loading the skill in the measured turn instead.
2. The task message (`prompt.txt`): the shared mission text with the arm's interface line, unchanged from a single-message run.

Every measured figure is the task turn's. Wall time runs from sending the task message to its `result` event. Tokens are that turn's usage. Cost is the session's cumulative cost at the end of the task turn minus its value at the end of the setup turn, since Claude Code's `total_cost_usd` accumulates over the session. Tool calls are those made after the task message. The setup turn's own time, tokens, cost and tool calls are kept in the result's `setupTurn` and are never added to the measured figures.

The setup turn has its own 120 second timeout. A setup turn that runs out of it, or ends with an error, is a run that could not complete: nothing is measured and the transcript stays in the run folder. The run's `--timeout-seconds` covers the task turn.

With a task as small as the default mission's, the agent's start-up and skill load would otherwise be a large share of every number, and a share that differs between arms. The longer mission (see [missions and arms](#missions-and-arms)) is where the setup matters less.

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
2. Warms the lab app, outside every measured window: Turbopack compiles each route on its first visit, so it seeds a throwaway user without a survey and walks the screens the missions touch: the sign-in page, signed out; then, signed in, the root the sign-in form sends the browser to and the screen where a new organization creates its first survey, from which it starts a survey from scratch to reach the editor; then the survey list and the summary page. This only checks that the lab app is reachable and visits it; it never starts or restarts it. The save itself compiles on its first call and cannot be warmed without changing data, so the first run of a suite can still carry that cost.
3. Runs the arms round-robin (run 1 of each arm, then run 2, and so on), so a suite that stops early still holds comparable runs.
4. Writes its manifest and summary to `results/suites/<suite id>/`.

The first run that cannot complete (a missing precondition, an unreachable lab app, a failed seed) ends the suite. The runs stored so far are summarized and the summary says the suite stopped early. A failed verdict is a result, not an error.

## On a hosted runner

The [Formbricks eval workflow](../../.github/workflows/eval-formbricks.yml) runs a suite on a standard GitHub-hosted Ubuntu runner, started by hand only (Actions, Formbricks eval, Run workflow). It never runs on pull requests or pushes. Its inputs are the mission, the arms (empty for every arm), the runs per arm, the model (default `sonnet`), and `qualify_only`, which prepares the lab app and runs `lab:qualify` without starting an agent, so it calls no model and costs nothing.

The job installs the pinned Claude Code, runs `lab:prepare`, starts `lab:dev` in the background and waits for the sign-in page, then runs `pnpm eval:suite`. It reads one repository secret, `CLAUDE_CODE_OAUTH_TOKEN`, the agent's Claude Code login; a qualify-only run does not get it. Only people with write access to the repository can start it, and runs from forks never get the secrets. The job summary holds the machine (OS, runner image, CPUs, memory) and the suite summary; the `eval-formbricks-results` artifact holds `results/` with the same machine record, and `lab-formbricks-log` holds the lab app's output. The repository is public, so its Actions logs and artifacts are too.

A runner is not a Mac, so its timings are not comparable with a Mac's: compare runs from the same kind of machine only. One eval runs at a time, since every paid run uses the same Claude Code login. A runner's summary is committed in a folder of its own, with the machine beside it, so it never replaces a Mac's summary of the same day: the first is [`summaries/2026-10-06-hosted-runner/`](summaries/2026-10-06-hosted-runner/summary.md), and the latest, with ten runs per arm, are [`summaries/2026-10-24-hosted-runner/`](summaries/2026-10-24-hosted-runner/summary.md) and [`summaries/2026-10-24-hosted-runner-sign-in-create-and-revise-survey/`](summaries/2026-10-24-hosted-runner-sign-in-create-and-revise-survey/summary.md).

## The summary

```sh
pnpm eval:report                         # the newest suite
pnpm eval:report -- --suite <suite id>
pnpm eval:report -- --publish            # also write summaries/<date>/
```

The report command rebuilds `summary.md` and `summary.json` from the stored runs listed in the suite's manifest. It launches no agent and needs neither the lab app nor a Claude Code token, so a change to the report costs nothing to re-run. The suite writes the same summary when it ends.

Per arm the summary shows:

- passes out of the runs stored for the arm; failed and timed-out runs count in the runs;
- the median, lowest and highest of wall time, tokens and cost, all of the task turn alone. Tokens are the agent's input, cache creation, cache read and output tokens added up. A failed run still contributes its time, tokens and cost. A run without a figure counts in the passes and the runs but not in that column; the cell then says how many runs it rests on, or `unknown` when none has it. With an even count the median is the mean of the two middle values.

It also records what a rerun must match: the Claude Code version, the model, the pinned browser interface of each arm (the Playwright CLI, Playwright MCP, agent-browser and `@ayme-dev/mcp` versions), the browser, the Ayme and Formbricks commits, the timeout and the date. If the runs of a suite differ in one of these, the summary lists every value and says so.

`--publish` writes the summary, formatted with the repository's Prettier, to `summaries/<date>/summary.md` and `summary.json`, dated by the day the suite started; a suite of a mission other than the default one goes to `summaries/<date>-<mission>/`. That folder is meant to be committed; a second summary for the same day replaces the first. `results/` stays ignored, so transcripts, prompts and run folders are never committed.

## What a run stores

`results/` is ignored by git. Each run folder holds:

| File                 | Holds                                                                                                                                                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mission.json`       | The seeded values, ids and credentials, the seeded survey if the mission has one, and where the agent starts                                                                                                                                                                                  |
| `setup-prompt.txt`   | The setup message as sent, the first of the two messages (see [what is measured](#what-is-measured))                                                                                                                                                                                          |
| `prompt.txt`         | The task message as sent                                                                                                                                                                                                                                                                      |
| `mcp.json`           | The MCP servers the agent was given (none for the Playwright CLI arm)                                                                                                                                                                                                                         |
| `init-page.cjs`      | The script that opens the mission's start page in the agent's browser                                                                                                                                                                                                                         |
| `transcript.jsonl`   | Claude Code's raw stream-json transcript, one event per line, the setup turn's events followed by the task turn's                                                                                                                                                                             |
| `stderr.log`         | Claude Code's standard error                                                                                                                                                                                                                                                                  |
| `final.md`           | The agent's final message                                                                                                                                                                                                                                                                     |
| `verdict.json`       | The database check: each expectation and what was found                                                                                                                                                                                                                                       |
| `result.json`        | The normalized result: verdict, wall time, input, cache creation, cache read and output tokens, cost, tool calls and failures per tool, all of the task turn; the setup turn's own figures; versions, isolation, what the arm's setup established, files the agent left in the lab app folder |
| `ayme-mcp.log`       | The standard error of the run's Ayme MCP server (the arms with Ayme)                                                                                                                                                                                                                          |
| `ayme-mcp-proxy.cjs` | The command Claude Code started as its `ayme` MCP server: a proxy to the run's server (the arms with Ayme as its own MCP server)                                                                                                                                                              |
| `agent-files/`       | Files the agent created in the lab app folder, moved here with their relative paths (the folder exists only then)                                                                                                                                                                             |
| `summary.md`         | The result in a few lines                                                                                                                                                                                                                                                                     |

Wall time, tokens, cost and tool calls are the task turn's (see [what is measured](#what-is-measured)); seeding, the start page and the setup turn are outside it. `setupTurn` holds the setup turn's own: when the agent was started, its wall time, tokens, cost and tool calls. `startedAt` is when the task message was sent. `setup` holds what the arm's setup established before the measured window: for the arms with Ayme the server's command and port, the page it paired with, when it paired and how long after the start page opened, and the tools the channel offered. A suite adds `results/suites/<suite id>/` with its manifest (`suite.json`) and summary.

The browser profile is deleted after the run; the seeded data stays.

## Missions and arms

A mission is data in [`src/missions.ts`](src/missions.ts): the values to seed, the screen the agent starts on, the task's steps and the end state to expect. The values the agent has to type carry a short random nonce, so typing length does not dominate the measurement; the full run id stays in the seeded user, organization and workspace names, where uniqueness matters. The task message is the same shape for every mission: the shared text, the arm's interface line, where the browser is, the mission's numbered steps, and what must hold before the agent finishes. The verdict is a pure function of the mission and the seeded workspace's surveys, read from the database after the run.

| Mission                            | Start                                                                | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Pass when                                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rename-survey-and-question`       | Signed in, on the editor of a seeded survey with one question        | Rename the survey, change its question's headline, save and close, confirm the summary page shows the new name. Two page object calls' worth of work; the published table rests on it.                                                                                                                                                                                                                                                                         | The seeded survey has the expected name and its question the expected headline.                                                                                                                |
| `sign-in-create-and-revise-survey` | Signed out, on the sign-in page; a user and workspace with no survey | Sign in with the seeded email and password, which this mission's task message carries; create a survey from scratch; name it and set its question's headline; save and close; close the share dialog on the summary page; open the survey in the editor again; change the headline to a second text; save and close; confirm the summary page shows the survey's name. Eight page object calls, across four screens, so an interface's fixed costs weigh less. | The workspace holds exactly one survey, with the expected name, and its first question's headline is the second text. Two surveys, the first headline left in place, or no survey at all fail. |

The default mission stays `rename-survey-and-question`, so its runs stay comparable with the published numbers; the other is chosen with `--mission`. For a mission that starts signed out, no arm is signed in by the harness: each arm's browser opens the sign-in page in a profile with no session. Sign-in in Formbricks ends in one full page load; for the arms with Ayme the pairing follows the tab through it, as through the client-side navigations after it (see [the arms with Ayme](#the-arms-with-ayme)).

An arm is an entry in [`src/arms.ts`](src/arms.ts): its one prompt line, its MCP servers, the built-in tools it leaves the agent, the permission rules that let it use its interface (and any that stay denied), its own preconditions, and an optional setup that runs before the measured window. Everything else is shared, in [`src/claude.ts`](src/claude.ts) and [`src/prompt.ts`](src/prompt.ts): Sonnet at the same `medium` thinking effort (`--effort`), which keeps the model from pausing for minutes before a single step of a short task, the setup message, a 600 second timeout for the task turn, and an isolated Claude Code configuration: a fresh configuration folder per run, an environment stripped of every `CLAUDE*`, `ANTHROPIC*` and `AYME_*` variable of whoever launches the eval, no project settings, no user settings or skills beyond that empty folder, and no MCP servers beyond the arm's own. The agent keeps read-only file tools, so it can look at the Formbricks source but can change the app only through its browser interface. The result records the tools, MCP servers, skills and plugins the agent was given; the skills and plugins listed are the ones built into Claude Code, which an isolated configuration still has.

| Arm                                           | Interface                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright-mcp`                              | The pinned `@playwright/mcp` server, headless, on the system Chrome, with the profile the harness prepared and the mission's start page open. The tools a page registers through WebMCP stay off, so the agent gets Playwright MCP's own tools only. The agent calls it through Claude Code's MCP permissions. |
| `playwright-cli`                              | The pinned `@playwright/cli` command and its official skill, with no MCP server. Details below.                                                                                                                                                                                                                |
| `agent-browser`                               | The pinned `agent-browser` command and the skill its package ships, with no MCP server, attached over CDP to the Chrome the harness launched on the start page. Its WebMCP support is off. Details below.                                                                                                      |
| `<browser automation>-with-ayme-webmcp`       | The same browser automation on a page the run's `ayme mcp --webmcp` serves the lab app's Page Objects to, which publishes the Page Object Tools and `page_objects` through WebMCP; the browser automation's own WebMCP support is on, and the agent gets no `ayme` server. Details below.                      |
| `<browser automation>-with-ayme-page-objects` | The same browser automation on a page paired with the run's `ayme mcp`, which the agent gets as its `ayme` MCP server; the browser automation's own WebMCP support stays off. Details below.                                                                                                                   |

The three browser automations are `playwright-mcp`, `playwright-cli` and `agent-browser`, so there are nine arms. The interface line of an arm with Ayme is its browser automation's line with one sentence added, stating where the Page Object Tools are listed. What to call or read after a Page Object Tool is in the skill's reference alone. Every version is recorded in the result.

### The arms with Ayme

The agent keeps its browser automation, its skill and its permissions, and gets the repository's [`skills/ayme`](../../skills/ayme/SKILL.md) beside them, the skill consumers install, so the eval measures what ships. It is copied with its references into the run's fresh Claude Code configuration folder under `skills/`, and `Skill(ayme)` is allowed. The setup turn loads it and reads its [browser automation tools reference](../../skills/ayme/references/browser-automation-tools.md), so the measured turn starts with it in context. The arms through the `ayme` server also allow `mcp__ayme`.

Set up outside the measured window:

- **The server.** The harness starts `ayme mcp` from the workspace's `@ayme-dev/mcp` in `apps/lab-formbricks`, with the command the reference gives for the browser automation and channel (`mcp`, or `mcp --webmcp`), on the first port of the range a page scans, 9350 to 9365, with `--port`. It builds the lab app's Page Objects in `.ayme/` and writes `.ayme/init-script.js`. The run refuses to start while anything listens in that range, such as another coding agent's `ayme mcp`, because the page would then find two servers and pair with neither. Through the `ayme` server, Claude Code starts a small proxy over a Unix socket, written into the run folder, so the agent's first tool list already holds the paired page's tools. The server's standard error is kept in the run folder; the server and its process group are stopped after the run.
- **The page.** A headless system Chrome on the profile the harness prepared, launched with a remote-debugging port and `--enable-features=WebMCP`, with the init script on every document and the content security policy bypassed so the served modules and the loopback WebSocket load. The agent-browser arm through WebMCP adds the Chrome features its WebMCP support needs. The setup waits until the page has paired with the server and the channel offers the start screen's Page Object Tool and `page_objects`, and nothing of Ayme's own browser driving (`snapshot`, `goal`, Browser Tools). What it saw is recorded in the result's `setup`.
- **The browser automation.** Attached over CDP to that browser instead of launching its own, with its WebMCP support on for the WebMCP channel alone: Playwright MCP with `--cdp-endpoint`, Playwright CLI with `attach --cdp`, agent-browser through `AGENT_BROWSER_CDP`.

The lab app needs `@ayme-dev/webmcp` beside `@ayme-dev/ayme` for the WebMCP channel; `lab:prepare` builds it.

### The Playwright CLI arm

The agent gets the `playwright-cli` command on its `PATH`, the CLI's official skill, the read-only file tools and Bash limited by permission rules to that command. Nothing else: no MCP server, and no other browser interface.

Set up outside the measured window, from the pinned package, with no download:

- **The command.** A one-line `playwright-cli` executable in the run folder's `bin/`, first on the agent's `PATH`.
- **The skill.** The package's `skills/playwright-cli` folder, the one `playwright-cli install --skills` installs, copied into the run's fresh Claude Code configuration folder under `skills/`. That is where Claude Code loads user skills from when its user settings source is on; the folder is empty otherwise, so it loads no skill but this one (Claude Code's own built-in skills stay listed, as for every arm; the permission rules allow only this one). The agent is given read access to the skill folder and the CLI's output folder, and to nothing else outside the Formbricks source.
- **The session.** `playwright-cli open` on the mission's start page, in the profile the harness prepared, on the system Chrome, headless. The CLI names its session after the run, so the plain command reaches it. A restart keeps the profile. The CLI keeps its snapshots and logs in the run's `playwright-output/`. The session is closed after the run.
- **No update check, and no page tools.** The CLI's update check is off, and so is its handling of tools a page registers through WebMCP, which would hand the agent the lab app's own Ayme tools.
- **Denied commands.** `npx` (the skill pre-approves `npx playwright`, which would run the lab app's own Playwright), `playwright-cli install` and `install-browser`, and `playwright-cli kill-all`, which kills every Playwright daemon on the machine.

### The agent-browser arms

The agent gets the `agent-browser` command on its `PATH`, the skill the package ships, the read-only file tools and Bash limited by permission rules to that command. Set up outside the measured window, from the pinned package, with no download: a one-line `agent-browser` executable in the run folder's `bin/` that runs the package's native binary for the machine; the package's `skills/agent-browser` folder copied into the run's configuration folder; and a session named after the run, attached over CDP to the Chrome the harness launched on the start page, which `agent-browser get url` must report before the agent starts. Its configuration travels in the environment (`AGENT_BROWSER_CDP`, `AGENT_BROWSER_SESSION`, its socket folder, its screenshot folder in the run's output folder, no version check), and its WebMCP support is off (`AGENT_BROWSER_NO_WEBMCP`) except in the arm through WebMCP, where `agent-browser webmcp` stays allowed; the other two arms deny it. The sessions are closed after the run, then the browser.

## The startup lane

Measures only the agent's first turn after loading the skill: whether the skill sends it to the references the task needs, and nothing more. A run costs cents and takes under a minute. It needs Claude Code and the token from [the prerequisites](#prerequisites), and no lab app, Docker, browser or key.

From this directory inside `devbox shell`:

```sh
pnpm eval:startup
pnpm eval:startup -- --scenario drive-the-open-page --model sonnet
```

Every run calls the model and costs money. The exit code is `0` for a pass, `1` for a fail and `2` when the run could not complete, as for [a mission](#one-run).

A scenario is data in [`src/scenarios.ts`](src/scenarios.ts): a framing of the task, the references it should lead the agent to read, and optionally references it must not read, references the verdict ignores and tools for a stub server to list. There are no arms.

| Scenario                        | Framing                                                  |
| ------------------------------- | -------------------------------------------------------- |
| `drive-the-open-page`           | Get ready to drive the open, connected page through Ayme |
| `drive-the-open-page-with-goal` | The same, with `goal` among the listed tools             |
| `set-up-ayme`                   | Get ready to set up Ayme in this project                 |
| `design-page-objects`           | Get ready to design page object models for this project  |

An allowed reference counts neither as expected nor as surplus, read or not; the summary still counts it under files read.

A scenario with tools gets a stub of Ayme's MCP server, [`src/stubMcpServer.ts`](src/stubMcpServer.ts), in the run's MCP configuration under the name `ayme`, so the agent sees `mcp__ayme__<tool>` as with the real server. Behind it is no browser and no app. It lists the scenario's tools and nothing else: the server's own `ayme_connect`, `ayme_list_tools` and `ayme_call`, the Browser Tools `snapshot`, `click`, `fill`, `type` and `navigate`, and two Page Object Tools, `SurveyEditorPage.fillSurveyForm` and `SurveyEditorPage.saveAndClose`. `goal` is listed in one drive scenario and not the other, so its route is checked both ways. A call answers that the tool is a stub, but the agent has no permission to make one. A scenario without tools starts no server.

The agent starts on the lab app folder, which every checkout holds, with the [shared isolated configuration](#missions-and-arms). Its one file tool is `Read`, so no reference is seen without counting as read; beside it, it has the `Skill` tool and no MCP server but the stub, and the shipped skill is copied into its configuration folder as for the arms with Ayme. That copy is the one place outside the working root it can read. It gets one message: the scenario's framing and a setup sentence that names the skill, says to read what it points to, to read no file outside its folder, not to use the browser, and to reply ready. The message names no reference, so routing stays the skill's job.

The verdict is read from the transcript. A run passes when no condition fails, and `failed` names each one that did:

| Condition                | Holds when                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `skill-loaded`           | The Skill tool loaded `ayme`.                                                                                                         |
| `expected-files-read`    | The files read, without allowed references, equal the expected set. A surplus read fails, `SKILL.md` or a working-root file included. |
| `no-forbidden-file`      | None of the scenario's forbidden references was read.                                                                                 |
| `nothing-denied`         | Claude Code's result reports no permission denial.                                                                                    |
| `no-browser-or-mcp-tool` | Every tool called is one of the lane's own, which no browser or MCP tool is, the stub's included.                                     |
| `within-setup-timeout`   | The turn ended within the [setup turn's 120 seconds](#what-is-measured).                                                              |

A timed-out turn is a failed run and stores a result without a wall time or tokens. A turn that ends with an error, or an agent that ends without answering, says nothing about routing: the run could not complete, and only the transcript stays. A `Read` that failed or was denied is not a file read.

Under `results/runs/<run id>/`, a run holds `setup-prompt.txt`, the message as sent; `mcp.json`, the stub with its tools or an empty MCP server list; `transcript.jsonl`; `stderr.log`; and `result.json`, printed when the run ends: `pass`, `failed` and the measures, `wallTimeMs`, `tokens` and `filesRead`, with what a rerun must match. The configuration folder is deleted afterwards.

### A startup suite

From this directory inside `devbox shell`:

```sh
pnpm eval:startup-suite -- --runs 10
pnpm eval:report -- --publish
```

Options: `--runs` per scenario (default `3`), `--model` (default `sonnet`). The suite runs every scenario round-robin (run 1 of each, then run 2), writes its manifest (`suite.json`) after every run, and writes its summary at the end, both under `results/suites/<suite id>/`. Its manifest carries `lane: "startup"`, which is how the report tells it from a mission suite; `pnpm eval:report` takes the newest suite of either kind, or `--suite <suite id>`.

A failed verdict, a timed-out turn included, is a result, and the suite goes on. The first run that cannot complete ends it: the runs stored so far are summarized and the summary says the suite stopped early, with any local path taken out of the error, which the manifest keeps whole. The exit code is `0` when every run completed, whatever their verdicts, and `2` when the suite stopped early. A suite killed mid-way leaves a manifest of the runs it finished, and `pnpm eval:report` summarizes those.

Per scenario the summary shows the passes out of the runs stored, the median, lowest and highest of setup time and tokens (input, cache creation, cache read and output added up; a timed-out run has neither and the cell says how many runs it rests on), and how many runs read each file, allowed references included. A file outside the skill's folder counts under one line, `outside the skill's folder`, so a local path is never published; `result.json` keeps the path. It also records what a rerun must match: the date, the Claude Code version, the model and effort, the Ayme commit and the timeout. The skill is read from the working tree, so the commit pins it only for a clean one.

`--publish` writes the summary, formatted with the repository's Prettier, to `summaries/<date>-startup/`, a folder of its own that no Formbricks summary uses. A second startup summary for the same day replaces the first.

## Tests

`pnpm test` runs the unit tests, which CI runs too. They cover building the summary from stored results (medians and ranges for odd and even run counts, failed runs in the pass counts, a run without usage data), the suite's options, the step from stored run artifacts to the normalized result, with recorded-shape two-turn fixture transcripts under [`src/fixtures/`](src/fixtures) (a complete run, with the measured figures taken from the task turn and the setup turn kept apart; a task turn without a usage block; a task turn that timed out), the Claude Code driver itself, against a stand-in `claude` in [`src/fixtures/bin/`](src/fixtures/bin) that replays a fixture turn by turn (the task sent only after the setup turn's result, a setup turn that ends with an error, a setup turn and a task turn that run out of their timeouts), the missions (their start, and a stored mission read back), the verdict function (mission plus the workspace's survey records to pass or fail, the database read staying outside it: for the seeded survey, and for a created one, with two surveys, the first headline left in place and no survey failing), the nine arms and their interfaces (the arms without Ayme get no Ayme tool, server, skill or sentence; each arm with Ayme starts `ayme mcp` with the command the skill reference gives for its browser automation and channel), the `ayme mcp` command, the init script and the tools each channel must not list, the proxy to the server (its stdio reaches the socket and back), the prompt, which for either mission differs between arms in its interface line alone and for the default mission is the text the published numbers were measured with, the setup message, which names no app or task, names the arm's skills, and has the arms with Ayme read the `ayme` skill's browser automation tools reference and no other file, with the Playwright CLI and agent-browser arms' texts pinned, an interface line of an arm with Ayme that carries no instruction on what to read after a Page Object Tool, the `ayme` skill, which resolves inside the repository's `skills/`, with no copy in this package, and the startup lane, which runs through the same stand-in on fixtures under [`src/fixtures/`](src/fixtures) and checks what it stored: the expected set read exactly, a reference too many, one missing, an allowed reference read or not, the stub server's list and its answer to a call, a drive run that reads `goal` when it is listed and one that reads it when it is not, a skill never loaded, a denied `Read`, a browser tool called, a setup turn that times out and one that ends with an error, that the references its scenarios name ship with the skill, each in one set, a suite through the same stand-in (round-robin order, the manifest, a failed verdict that goes on, a run that cannot complete and ends it), and the startup summary from stored results (per-scenario counts, file-read frequencies, medians for odd and even run counts, a published folder of its own, no local path from a stored error). Nothing in the tests needs the lab app, a browser or a model.
