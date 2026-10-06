# Handoff: from the e2e experiments to the real build of `@ayme-dev/e2e`

Written 2026-10-06 (evening) by the "Ayme as a backend for tester-army/e2e" thread, for a fresh session that will grill, spec and ticket the real build. Saved in the shared project folder (the place other threads in this project can read), not the OS temp dir. Nothing here duplicates the result files; they are referenced by path.

## The idea in one paragraph

tester-army/e2e turns natural-language test steps into cached browser actions, but it caches raw locators and clicks, so a UI change invalidates every test that shares a step, and the recordings carry no page semantics. Ayme page objects give those steps a durable, named form: `ProjectsPage.createProject(name)`. The experiments showed that an Ayme package can sit on an **unmodified** e2e: page object methods become e2e tools, our own step executor hands off at e2e's cache misses and gaps, and a small call store replays "this act was this page object call with these parameters" without any agent. When a replayed call fails, the entry is kept and a repair proposal names the control that moved, so the page object gets fixed once for every test.

## What is proven (results in this folder)

- Page objects as e2e tools on stock e2e, own executor and call store, per-test and shared lookups, mixed acts, keep-and-propose with 5 s fail-fast: `results-no-fork.md`.
- One agent session per test over the Agent Client Protocol (ACP), tools served by the test process as a local MCP server; Claude, Cursor and Codex all pass the same suite with identical turns; Claude over ACP costs the same as the Claude Agent SDK driver, so one ACP driver is enough: `results-acp.md`.
- Earlier evidence (fork patch, Claude Code SDK driver, page objects generated from recordings, multi-act tests): `results-claude-code.md`, `results-pom-from-cache.md`, `results-multi-act.md`, `design-pom-cache.md`, `findings.md`.
- Live-tool filtering (offer a page object tool only while its root is present and uncovered) must refresh after every action, not only at the start of an act.
- Node-side liveness is small: the browser's availability definition is one self-contained in-page function that real Playwright runs unchanged. Two research notes with pilots: `research-node-liveness.md` (cloud agent) and `node-side-live-tools.md (the Mac pilot write-up, in docs/research/node-side-live-tools/)` (Mac agent, page-driver port proposal, effort table).

The full feature list with status words (proven / building / designed / idea) is `feature-backlog.md`. Treat it as the grilling's starting frontier.

## Decisions Abel already made (do not re-ask)

- One agent session per test, lazily started at the first act that needs it, reused across acts. One agent process per act was rejected.
- Agents run on the user's own coding-agent login. Never an OpenRouter key for e2e or eval runs.
- Both store lookups: per test (test id + call index) and shared (instruction + tool). A shared hit also writes the per-test entry.
- Verification of a replayed call is the method's own wait plus the test's next assertion. No extra snapshot.
- Store lives in `.e2e/ayme/` next to e2e's cache, committed like theirs: call records and repair proposals, never page object files. Generated page objects go to a visible folder in the user's source; placement is the user's.
- One package, `@ayme-dev/e2e`, in the ayme monorepo: tools adapter plus executor with its drivers. Executors are thin drivers over one agent-neutral core.
- ACP driver first; the SDK driver can be dropped.
- Repair should be done by the same agent that runs the test, or the agent that started e2e; opt-in, off in CI. Repair proposals must name controls, not only verbs.
- Liveness of Page Object Tools belongs in Ayme core and must work across Playwright and playwright-lite, in the browser and in Node. The e2e package is its first consumer. Own ticket and own grilling.
- Page object root convention: a `readonly root: Locator` member, recognised by name, from the ayme skill PR "docs(skills): add page object design and runtime integration to the ayme skill". Read-only page object methods are not tools.
- The e2e fork patches and upstream issues are a separate matter owned by the "Upstream e2e issue drafts" thread (`upstream-proposal-draft.md` (not in this PR)). The package needs none of them.

## Open questions for the grilling

For the e2e package:
1. Test sessions leave traces in the user's agent history (Codex writes sessions under its home dir). Ephemeral or not?
2. `agent: 'auto'` (pick the installed, logged-in agent) versus an explicit agent in config.
3. The Claude ACP adapter reads the user's Claude settings for defaults. Acceptable, or pin model and settings per session?
4. Cursor reports no usage over ACP and Codex only the last request's tokens. What does the ledger show when usage is missing?
5. Repair over ACP: edits arrive as permission requests of kind edit when file-system capabilities are advertised. Scope to the named page object file only? Codex needs workspace-write mode; Cursor's edit path is unverified.
6. A cheap matcher (one small call picks a live tool and arguments) before a full session: worth a spike?
7. Arguments templated by parameter-value matching are weaker than e2e's `unique()` placeholders. Good enough for a first release?
8. Local MCP port per session now; MCP over ACP (draft RFD) later. Any reason to wait?
9. The toy example app cannot show where the approach breaks. Run the suite against a real app (the Formbricks lab from the evals work) over a few UI changes, measuring model calls, cost, flakes and repair quality against stock e2e, before any polish?

For Node-side availability in core (two lists already written; merge them): rootless top-level classes in Node (error, omit or live), a Node-safe package entry versus `/internal` (ADR-0025 and 0031 call `/internal` transitional), turning the registry's module-level state into an instance behind a page-driver port, Node tool results (plain return versus Settled Page and Change Record), children and collections in Node (a ref space is needed), when to probe (after every action is the proven minimum), hardening the in-page callback against loader helpers (esbuild keepNames), and root diagnostics for authors.

## Where the prototypes are (Abel's Mac, nothing committed or pushed)

The project folder lists every folder (not in this PR). The ones a spec should point at as primary sources:
- `<local>/e2e-clean/apps/ayme-e2e` (clone of tester-army/e2e, branch `ayme-nofork`): the no-fork package: `src/` adapter, store, executor, agent solver, Claude SDK driver, ACP driver; `harness/` configs and tests; its own `FEATURES.md` and `RESULTS-ACP.md`.
- `<local>/ayme-e2e-spike` (ayme worktree): example-react page objects with roots.
- `<local>/ayme-node-live` (ayme worktree): the Node liveness pilot under `packages/ayme/scratch/node-live/`.
- `<local>/e2e-spike`: the fork patch; belongs with the upstream drafts, not this build.

Suggested: keep them as `prototype/<name>` branches of the ayme repo (the prototype skill's convention) and point at them from the spec.

## Candidate tracer bullets (the Mac session's suggestion, smallest first)

1. Core: the live-tools module behind a page-driver port plus a Node Playwright adapter (top-level and singular children, plain results).
2. The `@ayme-dev/e2e` skeleton in the ayme repo, porting the prototype's adapter, store, executor and ACP driver onto it; Claude and Cursor first, Codex once isolation is generic.
3. A real-app eval on the Formbricks lab against stock e2e.
4. Opt-in repair hand-off through the same ACP session type, edits allowed only on the named page object file, off in CI.

## Constraints to carry

- Nothing public yet: no fork of e2e, no upstream issue from this work. Abel decides.
- Agent runs cost money and share one 10-core Mac with other threads; paid runs wait for Abel's word.
- Ports used by other work on the Mac: 3000, 4291, 4591, 9350 to 9365. Ours were 4391 and 4392.

## Suggested skills for the next session

- `/grill-with-docs` in the ayme repo, one session for the e2e package and a separate one for Node-side availability in core; keep grilling, spec and tickets in one unbroken context.
- `/codebase-design` while shaping the package: agent driver seam, call store, availability module behind a page-driver port.
- `/domain-modeling` for the new terms (call record, repair proposal, agent driver, page object availability) before they reach GLOSSARY.md or an ADR; Abel approves ADR and glossary text.
- `/to-spec`, then `/to-tickets` with a blocking edge from the package's live-tool ticket to the core availability ticket.
- `/implement-spec` for the build, on the Mac, as the Peek work runs today.
- `/prototype` to keep the three prototypes as primary-source branches.
