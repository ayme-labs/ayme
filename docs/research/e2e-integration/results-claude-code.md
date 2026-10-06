# e2e with Ayme page objects: Claude Code comparison (2026-10-06)

Local spike on Abel's Mac, nothing committed or pushed. Three "create a project" tests on the React example. The stock arm uses only e2e's own tools; the Ayme arm also offers the `ProjectsPage` page object tools, replayed as tool calls.

## Setup

- Agent: a custom e2e step executor that runs one Claude Agent SDK session per test. Each `act` arrives as a user message, Claude Code's built-in tools are off, and only in-process MCP tools are offered: observe, tap, type, select, check, press, scroll, navigate, back, complete_step, plus the page object tools in the Ayme arm. The permission mode is `dontAsk` and `settingSources` is empty.
- Model: the "sonnet" alias, which resolved to claude-sonnet-5-5.
- Login: the Claude Code token the Evals runs use, read at run time and never copied or logged. The free probe showed tokenSource CLAUDE_CODE_OAUTH_TOKEN and apiProvider firstParty. No OpenRouter key was involved.
- Cache: e2e's local file cache in read-write mode. Only the planned phases ran, with no reruns.

## Results (21/21 tests passed)

| Arm / phase | Sessions | Turns | Agent wall / run wall | Cost (SDK estimate) | Tokens in / out / cache read / cache write | Cache | Claude's choice |
|---|---|---|---|---|---|---|---|
| Stock record | 3 | 15 | 33 s / 38 s | $0.052 | 24 / 1098 / 31.0k / 7.9k | 3 missed (no entry) | clicks ×3 (tap, type, tap) |
| Stock replay | 0 | 0 | none / 11 s | $0 | none | 3 replayed | none |
| Stock after rename | 3 | 15 | 37 s / 85 s | $0.045 | 24 / 990 / 32.8k / 6.2k | 3 missed (target not found) | clicks ×3 |
| Ayme record | 3 | 9 | 19 s / 24 s | $0.039 | 18 / 762 / 21.0k / 5.9k | 3 missed (no entry) | `ProjectsPage_createProject` ×3 |
| Ayme replay | 0 | 0 | none / 11 s | $0 | none | 3 replayed | none |
| Ayme after rename | 3 | 15 | 36 s / 56 s | $0.047 | 24 / 1131 / 34.7k / 6.3k | 3 missed (page object call failed: "locator.click: Timeout 5000ms exceeded."). Entries unchanged (md5), 3 repair proposals | clicks ×3, page object call not retried |
| Ayme after the `ProjectsPage` fix | 0 | 0 | none / 13 s | $0 | none | 3 replayed | none |

The paid total was 12 step sessions, about $0.18 by the SDK's estimate. On the subscription token this counts against plan usage, not a bill. The cost includes Claude Code's own internal claude-haiku-4-5 helper calls, which appear in every session.

## Cache entries

- Ayme: `[tool ProjectsPage_createProject {"name":"{{param:/name}}"}]`
- Stock: `[tap "New project", type "{{param:/name}}" into "Project name" within "New project", tap "Create" within "New project"]`. Claude's clicks matched the scripted stand-in's exactly.
- Repair proposal after the rename (`.e2e/repairs/`): the failed call's gap, then tap "Add project", type the name into "Project name" within "Add project", and tap "Create" within "Add project".

## What it shows

- Claude chose the page object method on its own every time it was offered and working. When the method had just failed, it went straight to clicks and never retried it.
- A page object step took 3 turns (call, complete_step, end) against 5 for clicks, and was about 25% cheaper.
- After a UI change, both arms re-solve each affected test once. The difference is what the cache keeps and how it is repaired:
  - Stock re-records clicks per test, and it does so again for every later UI change.
  - Ayme keeps the semantic entry and writes a repair proposal naming the new control. One fix in `ProjectsPage` restores every test that shares the step.
  - If the page object fix lands in the same change as the UI change, Ayme re-solves nothing.
  - Until the method is fixed, Ayme re-solves that step on every run.
- Ayme's 5 s replay budget made its rename run 56 s, against 85 s for stock. Stock's replay waits about 15 s per test for the missing button before it gives up.

## Not covered yet

- Each test has one `act`, so the run never checked that one session carries over several acts. That needs a multi-act test.
- Proposal rough edges: the args hold this run's values rather than the slot, the fallback starts with the failed call's gap, and one repairs directory is shared by every cache.

## Where things are (Abel's Mac, uncommitted)

- <local>/e2e-spike, branch `ayme-tool-replay`: the e2e patch (replayable tool calls, keeping entries with repair proposals, a 5 s replay budget) and apps/ayme-spike, which holds the adapter, the scripted and Claude Code executors, the configs and the tests. Logs are in apps/ayme-spike/.e2e/out/claude/<arm>-<phase>/ (runsteps.jsonl, report.json).
- ../ayme-e2e-spike worktree, branch `claude/e2e-spike`: the ProjectsPage added to example-react.
