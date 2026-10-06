# Ayme page objects as a backend for tester-army/e2e

Research and local prototypes from 2026-10-06. Input to a decision (a spec for an `@ayme-dev/e2e` package and a core ticket for Page Object Tool availability in Node). Opened as a research PR per the research-notes convention in `docs/agents/issue-tracker.md` (for review and citation, closed unmerged). The supporting notes are in `docs/research/e2e-integration/`; the Node liveness research is its own topic in `docs/research/node-side-live-tools/`.

## The question

[tester-army/e2e](https://github.com/tester-army/e2e) turns natural-language test steps into browser actions once and caches them, so later runs need no model. Two questions: can Ayme act as a backend for it, and can e2e cache page object calls instead of raw locators and clicks? Raw recordings lose the page's semantics, and a shared step must be re-solved in every test when the UI changes.

## The answer

Yes to both, and without modifying e2e.

| Claim | Evidence |
|---|---|
| Ayme page object methods work as e2e tools; the agent picks them when they fit, in fewer turns than clicking | results-claude-code.md |
| A package on stock e2e (`cache: 'inherit'` executor plus its own call store) replays page object calls with no agent, keeps the entry when a replay fails and writes a repair proposal naming the control | results-no-fork.md, design-pom-cache.md |
| A step solved once is served to every test that repeats it (shared lookup by instruction and tool) | results-no-fork.md |
| One agent session per test over the Agent Client Protocol (ACP) runs Claude, Cursor and Codex through one driver; Claude over ACP costs the same as the Claude Agent SDK driver | results-acp.md |
| Page objects can be generated from the recordings (plan from cache entries, one coding-agent session writes the class) | results-pom-from-cache.md |
| The browser runtime's availability definition runs unchanged from Node against real Playwright; a Node-side live-tool list is a port in front of the registry, not a second implementation | research-node-liveness.md, node-side-live-tools.md (the Mac pilot write-up, in docs/research/node-side-live-tools/), the pilots |

Headline (two multi-act tests, three acts each, the example React app, Claude Sonnet): recording with page object tools took 4 agent acts where stock e2e needed 6; replay ran with no agent in both arms; after a button rename the page object arm re-solved nothing once the page object was fixed, while the stock arm re-solved every test. The tables are in the results files.

## How e2e works, in the parts that matter

- Steps are cached per test (test id and call index) as semantic targets (role, name, container key) with end anchors; mutating project tools are recorded as gaps and run live. findings.md has the model and the code pointers.
- A custom `StepExecutor` with `cache: 'inherit'` receives control at a miss or a gap, with the observation, the actions, budgets and a ledger of replayed steps. That seam is what the package uses; e2e records a page object step run through `runTool` as a one-action gap entry.
- Container keys are built from the first leaf text, so a counter is keyed by its current value. The call store sidesteps this for page object steps; plain clicks still hit it. The fork patch that fixes it, and the replayable tool call proposal, are drafted for upstream by another thread and are not part of the PR.

## What was built, in order

1. **Fork patch spike** (`replay: 'call'`, keep-and-propose, container key fix) on a local clone of e2e. It proved the idea and was superseded by the no-fork package. Not published.
2. **No-fork package** on an unmodified e2e checkout: tools adapter (top-level page object classes from the compiler's manifests), call store in `.e2e/ayme/` (per-test and shared lookups, arguments templated by parameter matching), store-first executor, agent solver, Claude Agent SDK driver, ACP driver, live-tool filter refreshed after every action. Its code lives on the prototype machine and should follow as a `prototype/` branch.
3. **Page object generation** from cache entries: a deterministic plan and one coding-agent session.
4. **Liveness pilots**, cloud and Mac: the in-page callback from `pomReachability.ts` on real Playwright, through playwright-lite and directly, with identical results; the Mac pilot adds a page-driver port (`isLocator`, `observeRoot`, `watch`) and a Node `MutationObserver` wake-up.

## What the agents taught us

- A live-tool list offered only at the start of an act made Claude click a button the page object covered; refreshed after every action, all three agents picked the tool. The live list is part of every action result.
- Codex reached for the user's own agent tools (computer-use plugins) when no page object fit and gave up when denied, and ran web search and a subagent without asking. A per-session config disabling those for our sessions fixed it. Per-agent isolation is a requirement.
- ACP has no system prompt field and no standard usage report (Claude: tokens and cost; Codex: last request's tokens; Cursor: none). Tools must be an MCP server, so the test process serves them over local HTTP per session.
- Cursor is slow per act (14 to 43 s) but correct; Claude and Codex are comparable.

## Decisions already taken, and what is open

handoff-e2e-package.md carries the decisions (one session per test, both store lookups, verification by the method's wait plus the test's assertion, store location, one package, ACP driver first, repair by the same agent, liveness in core), the open questions for the grilling, and the suggested skills. feature-backlog.md is the feature list with status words for the real build.

## Not for the PR

- The upstream e2e issue drafts (another thread owns them; whether to file them is undecided).
- The list of folders left on the prototype machine.
- The e2e fork patch.
