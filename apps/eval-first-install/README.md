# First-install eval

Checks how a developer installing Ayme for the first time gets on with each of three browser automations: Playwright CLI, Playwright MCP and agent-browser. A headless Claude Code worker (Sonnet, medium effort) gets a project folder with Ayme installed and Page Objects in `.ayme/`, is told only which browser automation to use, sets things up, is restarted, and then does a task on a small list app that does not include Ayme. Neither prompt names a channel, a skill or a document.

It is never part of `pnpm check` or the repo's CI: the package has no build, lint, typecheck or test task. It runs by hand or through [its own workflow](../../.github/workflows/eval-first-install.yml).

## What a run does

1. **Packs the ref under test** (`src/pack.ts`, default `feat/page-object-tools-beside-browser-automation`): checks it out in a throwaway worktree under the main checkout's `.claude/worktrees/`, sets `@ayme-dev/ayme`, `mcp`, `webmcp` and `inspector` to the prerelease version `<version>-first-install.g<sha>`, builds and packs them, and copies the `ayme` skill and `docs/guide` with [doc-changes.patch](doc-changes.patch) applied. A patch that no longer applies stops the run. A packed ref is reused from `results/packed/<sha>`.
2. **Starts a local npm registry**: Verdaccio, run with `npx`, holding the packed tarballs and passing everything else through to npmjs. The project's `.npmrc` points at it, so the documented `npx -y @ayme-dev/mcp@<version>` works as for a real user.
3. **Builds the project** in a fresh temporary folder, outside the repo so the worker finds none of its files: [fixture/project](fixture/project) (a `package.json` pinning the prerelease, `tsconfig.json`, and `.ayme/` with the Page Objects from `apps/example-vue/playwright/pom/`), the skill in `.claude/skills/ayme/`, the guide in `ayme-docs/`, then `npm install`.
4. **Serves the fixture app** ([fixture/app](fixture/app)): a static list app with no Ayme in it, whose DOM matches the Page Objects. Its server keeps the list.
5. **Runs the worker** twice with `claude -p`: the setup prompt, then, resumed with the project's `.mcp.json`, the task prompt ([src/prompts.ts](src/prompts.ts)). Claude Code asks before any edit of `.mcp.json`, and a headless run declines every question, so a hook ([src/approve-mcp-json.mjs](src/approve-mcp-json.mjs)) answers yes to that one question, as the developer would, and logs it to `approvals.log`.
6. **Checks the outcome** from the server's list: active items include "Soy milk N" and neither "Oat milk N" nor "Rye bread N", and "Rye bread N" is archived.
7. **Stops everything the worker started**: every process that carries the run's marker variable or names the run's folder.
8. **Scores the run** from its files ([src/score.ts](src/score.ts)).

## Run it

From the repo root, in `devbox shell` (Node 24), with Claude Code logged in and Google Chrome installed:

```sh
cd apps/eval-first-install
node src/run.ts --tool playwright-cli                  # one paid run
node src/run.ts --tool agent-browser --ref <ref>       # another ref
node src/run.ts --tool playwright-mcp --agent none     # the task done by a script, no model: checks the harness
node src/score.ts results/runs/*/                      # one table over several runs
```

`--packed <dir>` reuses a packed ref, `--out <dir>` names the run's folder (default `results/runs/<tool>-<time>`), and `--keep` keeps the temporary project.

On a shared machine, note that the worker chooses its own ports and browser, and its downloads go to the usual caches.

## In CI

[eval-first-install.yml](../../.github/workflows/eval-first-install.yml) runs on a push to `t3/validate-real-playwright-evals` that changes [ci.json](ci.json), which names the ref, the tools and the runs per tool. `"docPatch": false` makes it a control round, run on the ref's own skill and guide. A `workflow_dispatch` workflow could not be dispatched from this branch, because GitHub dispatches only workflows on the default branch. One job packs the ref and runs the self-check; then each run gets its own fresh runner, with Claude Code 2.1.326 and the `CLAUDE_CODE_OAUTH_TOKEN_FALLBACK` secret, the eval's second login. The score table goes to the job summary, and each run's folder is uploaded as an artifact.

## A run's folder

| File                                                      | What it holds                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `setup.jsonl`, `task.jsonl`                               | The worker's stream-json transcripts                                                                                              |
| `setup-prompt.txt`, `task-prompt.txt`                     | The prompts as sent                                                                                                               |
| `ayme-record.jsonl`                                       | Every stdio line of every `ayme mcp` the worker started (below)                                                                   |
| `outcome.json`                                            | The harness's outcome check and the server's final list                                                                           |
| `REPORT.md`                                               | The worker's own report                                                                                                           |
| `mcp.json`, `configs/`                                    | The worker's `.mcp.json`, the project's JSON files, `.playwright/`, `.claude/` settings and the init script, as the run left them |
| `meta.json`, `harness.log`, `fixture.log`, `registry.log` | Versions, timings and the logs of the harness, the app's server and the registry                                                  |
| `score.json`, `score.md`                                  | The run's score                                                                                                                   |

### The `ayme mcp` recording

[src/recorder.mjs](src/recorder.mjs) is loaded into every Node process the worker starts, through `NODE_OPTIONS=--import`, and does nothing unless the process is `ayme mcp` from `@ayme-dev/mcp`, however it was started. It appends each line `ayme mcp` reads or writes, its start command and its exit code, to `ayme-record.jsonl` in the run's folder, outside the worker's project, so the worker's `npm install` cannot replace it. Each line is `{"t", "pid", "dir": "start" | "in" | "out" | "err" | "exit", "line"}`. A fatal error Node prints itself, outside `process.stderr.write`, is not recorded, but the exit code is.

## The score

One row per run:

- **Outcome (harness)**: the outcome check above; `n/a` for a folder without `outcome.json`.
- **Claimed**: what the Outcome section of the worker's REPORT.md says.
- **Skill**: the phases in which the worker loaded the `ayme` skill with the Skill tool.
- **Docs read**: the skill and guide files the worker read with Read or `cat`/`sed`/`head`-style commands, in order. `skill` is SKILL.md, a bare name is a skill reference, `docs/…` is the guide.
- **Channel (default)**: how the task's Page Object actions (`ListPage.*`, `ListItem.*`, `ArchiveDialog.*`) were called: `mcp` (the `ayme` server's tools or `ayme_call`), `webmcp` (`playwright-cli webmcp-call`, `agent-browser webmcp invoke`, Playwright MCP's `webmcp_*` tools), `both` or `none`; in brackets, the channel the skill names for that tool and whether the run used it.
- **PO calls (errors)**: those action calls in the task phase, and how many answered with an error.
- **Plain actions**: clicks, fills, key presses and the like through the browser automation in the task phase.
- **Restart asked in task**: whether the worker asked to be restarted again during the task.
- **Browser downloads**: browser install commands, `browser_install` calls, and download output, by phase.
- **Turns, time, cost**: summed over both phases, from Claude Code's result events.
- **ayme mcp starts (non-zero exits)**: from the recording.

The command classes are heuristics over the transcripts; check a surprising cell against the transcript.

## The doc changes under test

[doc-changes.patch](doc-changes.patch) is applied to the copies of the skill and the guide given to the worker, never to the repo. It is made against the PR head `6b0b4d79`. `node src/pack.ts --no-doc-patch` packs the skill and the guide as the ref has them, for a control round.
