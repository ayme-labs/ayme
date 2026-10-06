# ACP driver prototype: results

Status: done (2026-10-06, evening). All three agents work through one ACP driver on unmodified e2e; Codex needed one isolation fix.

## What was built (free, on the clean e2e checkout, `apps/ayme-e2e`)

- `acp-driver.ts`, 405 lines, against 162 for the Claude Agent SDK driver. One driver for every Agent Client Protocol agent; a harness config picks the agent (claude, cursor, codex).
- Package-local, pinned installs: the ACP TypeScript SDK 1.7.0, Zed's Claude ACP adapter 0.86.0, the Codex ACP adapter 2.1.1 (bundles Codex 0.159.3), MCP SDK 1.32.1.
- Plumbing ACP forced:
  - Tools: an ACP agent takes tools only as an MCP server, so the test process serves ours over streamable HTTP on 127.0.0.1, random port and path per session. All three agents accept http. stdio is out, because the tools must run inside the test process. Claude loses the in-process SDK path.
  - Permissions: the driver answers `session/request_permission` itself: only our MCP server's tools are allowed, everything else rejected. It advertises no fs or terminal client capability, and the agent runs in an empty temp dir.
  - System prompt: ACP has no system-prompt field. For Claude, the adapter's `_meta` carries ours, so the comparison with the SDK driver is like for like.
- Usage is not standardized over ACP: Claude reports tokens per turn plus cumulative session cost; Codex reports tokens for the last model request of a turn only, no cost; Cursor unknown until a run. Turns are counted as our tool calls + 1, because ACP doesn't expose model requests.
- Free checks: initialize + session/new with our MCP server. All three agents connected.

| | Claude (Zed's adapter) | Cursor (`agent acp`, CLI 2026.10.01) | Codex (adapter + bundled Codex 0.159.3) |
|---|---|---|---|
| Model asked for | sonnet = Sonnet 5.5, selected | non-max Opus 4.6: `claude-opus-4-6[thinking=true,context=200k,effort=high]`, selected | two Luna models offered, gpt-6-luna and gpt-5.6-luna; a plain "luna" is refused; gpt-6-luna chosen |
| Session close | yes | no, the driver kills the process | yes |
| Auth | session/new works; the Evals token is passed at run time | logged in | ChatGPT Plus login reported |

Risk accepted by Abel for Codex: the adapter's bundled Codex 0.159.3 runs against `~/.codex` while the installed Codex is 0.154.0; a newer version can migrate shared state so the older one can't read it. A file-name and size snapshot of `~/.codex` is taken before the run (no secrets read).

## Claude through ACP (done)

Sonnet, same system prompt as the SDK driver, multi-act record and replay, both arms, 8/8 test runs passed, no re-runs.

| Arm / phase | Sessions | Acts Claude handled | Cost | Tokens (e2e summary) | Act sources |
|---|---|---|---|---|---|
| Stock, record (ACP) | 2 | 6 | $0.083 | 106.6k, 90% cached | e2e missed 6, Claude 6 (clicks) |
| Stock, record (SDK driver, earlier today) | 2 | 6 | $0.078 | not reported then | same |
| Stock, replay (ACP) | 0 | 0 | $0 | | e2e replayed 6 |
| Ayme, record (ACP + root filter) | 2 | 4 | $0.052 | 54.2k, 86% cached | Claude 4, store-shared 2 |
| Ayme, record (SDK driver, no roots or filter) | 2 | 4 | $0.050 | | same split |
| Ayme, replay (ACP) | 0 | 0 | $0 | | e2e replayed 2, store-test 4 |

- Turns per act match the SDK run: 5 for a click flow, 3 for one page object call, 4 for two calls. Wall time per act 5–8 s in both.
- Session reuse across acts works the same: lazy start, later acts read more from the prompt cache (stock T1: 9.1k, 17.5k, 23.2k cached).
- Usage: the Claude adapter returns per-turn tokens for each model (Sonnet plus Claude Code's internal Haiku calls) and the cumulative session cost, so nothing is lost against the SDK driver. Token reporting into e2e works.
- Permissions and containment: every permission request was for our tools, all allowed; no built-in tool asked or ran. Claude asks permission for each MCP call, one round trip per tool call that the SDK driver avoids by pre-approving.
- Containment caveat: at session create the adapter read the user's `~/.claude` settings and defaulted the model from them before the driver set Sonnet. Usage confirms Sonnet did the work. `settingSources: []` passed through `_meta` did not stop that.
- Reading: Claude through ACP matched the SDK driver on cost, turns and session reuse, so the ACP driver can replace it (inference from one run). The costs are an HTTP MCP server instead of in-process tools, and one permission round trip per tool call.

### Root filter (page objects given a `root`, live tools listed at the start of each act)

- No turns saved, and one choice got worse: in "bring the counter back and increment it once" the counter was unmounted when the act started, so only ProjectsPage was listed. Claude clicked Mount and then clicked Increment instead of calling `CounterPage_increment`, which the run without the filter had done. The act stayed clicks, so e2e replays it rather than our store.
- Fix: refresh the live list after every action, in each action's result, not only at the start of the act. Being added during the pause.

## Cursor through ACP (done)

Cursor CLI 2026.10.01 in `agent acp` mode, non-max Opus 4.6. Multi-act record and replay, both arms, 8/8 test runs passed. Every call went through our MCP server; no built-in tool ran, no user-level MCP server showed up. Cursor reports no usage over ACP. It is slow: 14–43 s per act against 5–8 s for Claude. Its page object arm ran in parallel with Codex's first attempt, at Abel's request, so its wall time is loose.

## Codex through ACP (done, after one fix)

Codex ACP adapter 2.1.1 with its bundled Codex 0.159.3, model gpt-6-luna.

- Attempt 1, no isolation: 1 test failed per arm. When no page object fit, Codex reached for the user's own Codex tools (a computer-use/browser plugin's MCP tool) instead of our tap; we denied them, so it concluded the app was blocked and quit. Web search and a subagent call ran with no permission request at all: a containment gap.
- Fix: a per-session Codex config, which the adapter merges into the session, disables the user's MCP servers and plugins, web search and multi-agent for our sessions only. The user's `~/.codex` config is untouched. Token accounting fixed too.
- Attempt 2: 8/8 passed, nothing outside our tools, no denials.
- `~/.codex` after the runs (names, sizes and modification times only, no secrets read): no migration visible, the database files keep their version names, and the installed Codex 0.154.0 still starts. Normal session writes happened, so the test sessions probably appear in the user's Codex history.
- Usage: Codex reports tokens only for a turn's last model request, and no cost.

## Comparison, 2 tests x 3 acts

Record = sessions / acts the agent handled / turns / run wall time / cost. Load varied a lot during the day (Spotlight indexing, the Evals suite, parallel runs), so wall times compare loosely.

| Driver / agent | Stock record | Page object record | Replay |
|---|---|---|---|
| SDK driver, Claude Sonnet 5.5 | 2 / 6 / 26 / 70 s / $0.078 | 2 / 4 / 14 / 42 s / $0.050 (no roots, no filter) | 6/6, 0 sessions |
| ACP, Claude Sonnet 5.5 | 2 / 6 / 26 / 49 s / $0.083 | 2 / 4 / 14 / 37 s / $0.052 | 6/6, 0 sessions |
| ACP, Cursor Opus 4.6 non-max | 2 / 6 / 26 / 170 s / no usage reported | 2 / 4 / 14 / 98 s (parallel with Codex) / none | 6/6, 0 sessions |
| ACP, Codex gpt-6-luna (attempt 2) | 2 / 6 / 26 / 62 s / tokens only | 2 / 4 / 14 / 157 s / tokens only | 6/6, 0 sessions |

- Every agent: one session per test, started lazily. The same 2 of 6 page object acts were served by the shared store, and turns per act were identical across agents. With page objects, every agent chose `ProjectsPage_createProject` and `CounterPage_increment`.
- Driver size: 405 lines for all three agents against 162 for the Claude-only SDK driver. Claude through ACP matched the SDK driver on cost, turns and session reuse, so one ACP driver can replace per-agent drivers.
- Per-agent config: Claude needed `_meta` options and the system-prompt route; Cursor needed nothing; Codex needed the isolation above.
- Plumbing ACP forces: tools as a local HTTP MCP server on an OS-assigned port, not in-process, and our own permission handler. Claude asks permission for every call to our tools, one round trip each.
- Usage over ACP: Claude reports tokens per model plus cost; Codex tokens for the last request only, no cost; Cursor nothing.

## Live-tool filter

Rooted ProjectsPage and CounterPage (per the page object design skill), live tools listed per act.

- With the list only at the act's start, Claude clicked Increment instead of calling `CounterPage_increment` after mounting the counter.
- With the list refreshed in every action result, Cursor and Codex both did tap Mount, then `CounterPage_increment`, stored and replayed from the store.
- No turns saved in this app. Its value is the right pick when a tool becomes live mid-act.
- Free flip test passed: the counter tool is live, gone after Unmount, back after Mount.

## Repair hand-off over ACP (inference, untested)

Workable: edits arrive as permission requests of kind edit when the client advertises file-system capabilities, so an opt-in repair session could allow edits to the named page object file only. Codex would need its workspace-write mode. Cursor's built-in edit path is unverified.

## State on the Mac

Dev servers stopped by PID, no agent processes left, no token in any output, nothing committed. Files: `e2e-clean/apps/ayme-e2e/{RESULTS-ACP.md, FEATURES.md, src/, harness/}`. The spike worktree keeps the rooted example page objects (originals backed up). The `ayme-node-live` worktree holds the Mac's own Node-liveness notes (`docs/research/node-side-live-tools.md`, uncommitted; copied to node-side-live-tools.md (the Mac pilot write-up, in docs/research/node-side-live-tools/)). The folders left on the prototype machine are listed in the project folder (not in this PR).
