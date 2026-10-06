# Ayme x e2e: feature backlog for the real build

Everything the experiments on 2026-10-06 proved, designed or only raised, so the real (non-prototype) build knows what it can and wants to do. Status words: **proven** (ran in a prototype with results in this folder), **building** (in the current prototype), **designed** (agreed in the thread, not built), **idea** (raised, not decided), **research** (being investigated).

Related files: findings.md, design-pom-cache.md, results-claude-code.md, results-pom-from-cache.md, results-multi-act.md, results-no-fork.md, upstream-proposal-draft.md (owned by the "Upstream e2e issue drafts" thread; not in this PR).

## Core: page objects as e2e tools, on unmodified e2e

| Feature | Status | Notes |
|---|---|---|
| Ayme page object methods exposed as e2e tools (top-level classes only, from the plugin's manifests) | proven | Claude picked the tool whenever it fit, 3 turns vs 5 for clicks, about 25% cheaper per step |
| Our own step executor on stock e2e (`cache: 'inherit'`): e2e hands off at a miss or gap, we serve from our store or an agent session | proven | No change to e2e source. e2e records the step as a gap entry through `runTool` |
| Call store in `.e2e/ayme/`: one record per step ("this act was ProjectsPage.createProject with name from the name parameter") | proven | Lookups per test and shared by instruction + tool. Shared hits solved a repeated act once for the whole suite |
| Arguments templated by matching parameter values (`{"$param":"name"}`) | proven | Weaker than e2e's `unique()` placeholders for values that aren't parameters |
| Keep the entry when a replayed call fails; write a repair proposal; 5 s fail-fast; tell the agent which call failed so it doesn't retry | proven | Rename phase 21 s instead of 187 s |
| Repair proposals name the controls, not just the verbs (resolve node ids against the step's observation) | building | Abel: do it |
| A shared hit also writes a per-test entry | building | Abel: do it |
| Verification of a replayed call: the method's own wait plus the test's next assertion | designed | No extra snapshot. e2e's end anchors don't apply to our steps |
| Mixed act: e2e replays the click prefix, hands off at the gap, the store finishes with the page object call | proven | `replayedPrefix` from e2e |
| Page object steps stay in e2e's budgets, queue and report through `runTool` | proven | e2e's cache report counts them as gaps; `--strict-cache` flags them |

## Agent sessions

| Feature | Status | Notes |
|---|---|---|
| One agent session per test, started lazily at the first act that needs it, reused across acts | proven | Later acts cost about half; cache reads grow |
| Ledger of completed steps sent with each act, including steps the cache replayed without the agent | proven | The agent handled an act after a replayed act correctly |
| Claude Code driver over the Agent SDK: in-process MCP tools only (e2e grammar + page object tools + complete_step), no built-in tools, no prompts, empty cwd | proven | Login: the machine's Claude Code login (the Evals token in the experiments) |
| Token counts reported to e2e's ledger (`recordModelCall`), not only cost | building | e2e's "AI tokens" column showed 0 |
| Agent-driver seam: start a session for a test, send a message per act, receive tool calls, close; tools defined once | building | Drivers are thin; store, tools, ledger and checks are agent-neutral |
| ACP (Agent Client Protocol) driver: one driver for every ACP agent; tools served by the test process as an MCP server over local HTTP | proven | results-acp.md: Claude, Cursor and Codex all 8/8 through one 405-line driver; Claude matched the SDK driver on cost, turns and session reuse, so the SDK driver can go. Costs: HTTP MCP server instead of in-process tools, one permission round trip per tool call (Claude). Usage: Claude tokens+cost, Codex last-request tokens only, Cursor nothing. Cursor slow (14–43 s per act). Caveat: the Claude adapter reads the user's ~/.claude settings for defaults |
| Permission handling for ACP agents: our tools allowed, everything else denied, so a run never prompts | proven | Held for all three agents. Codex ran web search and a subagent without asking, which the isolation below closes |
| Per-agent isolation of the user's own agent tools (Codex: a per-session config disabling their MCP servers, plugins, web search and multi-agent) | proven | Without it Codex reached for the user's computer-use plugin tools and gave up when denied |
| Test sessions leave traces in the user's agent history (Codex writes sessions under ~/.codex); decide whether they should be ephemeral | design question | |
| `agent: 'auto'`: pick the driver from what's installed and logged in | idea | |
| MCP over ACP (draft RFD): tools over the ACP connection itself, no local port | idea | Not stabilized upstream yet |
| Cheap matcher before a full session: one small call picks a live tool and its arguments from the instruction, checked by the method's wait and the test's assertion, agent as fallback | idea | Would cut first-time solves; untested |

## Repair loop

| Feature | Status | Notes |
|---|---|---|
| Repair proposals written to `.e2e/ayme/repairs/` and printed in the run output, so whoever started the run (a coding agent included) sees them | designed | Abel: the agent that started e2e should be able to fix it |
| Opt-in: after the test, the test's own agent session gets the repair as a prompt with file tools allowed and fixes the method | designed | Off in CI, since it edits source during a test run. Over ACP, edits arrive as permission requests of kind edit when we advertise file-system capabilities, so the session could be allowed to edit the named page object file only (inference); Codex needs workspace-write mode; Cursor's edit path unverified |
| Repair as a prompt to a fresh session of the user's agent, started with one command | designed | The conservative fallback when no agent is attached |

## Page objects from recordings

| Feature | Status | Notes |
|---|---|---|
| Deterministic plan from cache entries: dedupe into flows, members, child candidates, repair patch from proposals | proven | Free |
| One coding-agent session writes the page object from the plan, with named members and child classes | proven | 7 turns, about $0.08; the result was used 3/3 and replayed 3/3 |
| Generated page objects land in the user's source, in a visible folder next to their tests, not a dot folder | designed | Placement left to users for now |
| Recording clicks as page object members (locators as members) | idea | Untested |

## Tool liveness

| Feature | Status | Notes |
|---|---|---|
| Offer a page object tool only while its root is present and not covered, refreshed after every action | proven | No turns saved on these tests; with the refresh, Cursor and Codex picked the counter tool right after mounting it. Replace the prototype's centre-point check with core's own liveness function |
| Liveness of Page Object Tools in Ayme core across Playwright, playwright-lite, browser and Node; the e2e package as first consumer | research done | research-node-liveness.md: the browser's liveness definition is one self-contained in-page function (pomReachability.ts) that Node can call unchanged; pilot agreed with the browser runtime in every scenario, 8-12 ms per check for five classes. Proposed: a "Page Object Availability" module in core with a Node-safe entry, the manifest fold and the rootless policy in the e2e package. Effort medium. Seven open questions for a grilling (rootless classes, entry point and ADR, visibility parity, children/collections, when to probe, ask the browser runtime instead, root diagnostics)  The Mac's own notes (node-side-live-tools.md (the Mac pilot write-up, in docs/research/node-side-live-tools/), pilot 15/15 checks on real Playwright) add: a page-driver port in front of one registry/liveness module; the registry's singleton state, running tools without `document`, and Structural Refs in Node are the hard parts; esbuild keepNames injects `__name` into the in-page callback and silently reports roots absent |
| Example page objects without a `root` (example-react ProjectsPage, CounterPage) get one, so liveness has something to decide | building | Prototype worktree only |

## Packaging and store

| Feature | Status | Notes |
|---|---|---|
| One package, `@ayme-dev/e2e`, exporting the tools adapter and the executor with its drivers | designed | |
| Store next to e2e's cache (`.e2e/ayme/`), committed like theirs; page objects are not in it | designed | |

## Not needed for the integration, parked

| Item | Where |
|---|---|
| e2e fork patches: replayable tool calls (`replay: 'call'`), keep-on-failure, instruction text in entries, container key fix | upstream-proposal-draft.md, owned by the "Upstream e2e issue drafts" thread |
| e2e container key bakes live text into recordings (counter keyed "0") | same; our store sidesteps it for page object steps, plain clicks still hit it |
