# e2e tools

Page Objects written on e2e's `screen` offered to an agent as tools, for the third arm of the Page Object study: tests are `agent.act` goals, and the agent answers each goal by calling a Page Object Tool. e2e is the test runner from [e2e.com](https://e2e.com). Private: only this repository's study uses it. CI runs its lint, typecheck and `test`, the patch loader's own tests; no CI job runs e2e through it.

The study writes the same Inspector journeys three ways, called arms: plain `agent.act` goals on e2e as published (arm 1); the e2e suite's Page Objects called directly (arm 2, [`apps/inspector-fixture/tests/e2e/pom`](../../apps/inspector-fixture/tests/e2e/pom)); and goals answered by calls of those same Page Objects as tools (arm 3, this package). An action stays deterministic code; e2e records the call and replays it with no model.

```
src/direct.ts        directPageObjects: one tool per Page Object Action, derived by ayme's
                     compiler from an entry file, called on the attempt's own `screen`
src/projectTools.ts  serveProjectTools: config tools for the patched ACP executor's `tools` option,
                     listed only while they can run, with a hook for each failed call
src/stale.ts         staleNotes: a note per failed call, for whoever fixes the Page Object
src/patched.ts       the patched e2e's additions, typed, and the guards that keep the arms apart
patched-e2e/         e2e-patched: e2e's CLI with the patches applied in its own processes only
patches/             the patches, one per package, named as pnpm names them
```

What arm 3's agent is told about the tools is the fixture's, beside its tool entry ([`tests/e2e/tools/rules.ts`](../../apps/inspector-fixture/tests/e2e/tools/rules.ts)).

## How patched and unpatched e2e share one checkout

The patches stand in for changes e2e does not ship. They are not pnpm patches: the installed `e2e`, `@e2e-dev/core` and `@e2e-dev/acp` are the published packages, byte for byte, for every arm. `e2e-patched <args>` runs e2e's own CLI with a module hook ([`patched-e2e/register.mjs`](patched-e2e/register.mjs)) that hands Node the patched source of each file a patch changes as it loads it, in the runner and in the test workers it forks, which get the hook as an `--import` of their own (the `e2e` patch). The app server and the ACP agent those processes start inherit nothing of it. A run started with `e2e run`, as arms 1 and 2 are, never loads the hook. Each hunk must match the published file exactly and carry as many lines as its header says, and the installed version must be the patch's, so an upgraded e2e or a damaged patch stops the run instead of half-applying a patch (`pnpm test` checks the loader).

Four guards keep the arms apart:

- `e2e-patched` starts only with a `--config`, and fails that config as it finishes loading unless `assertPatchedE2e` ran in it, so it never runs e2e's default config or another arm's, which may be a baseline arm's.
- `assertPatchedE2e` (arm 3's configs) stops a run that is not patched, and loads every file a patch names through the hook, so a file loaded before it or from another copy stops the run too.
- `assertUnpatchedE2e` (arm 1's `e2e.goals.config.ts`) stops a baseline run that carries the hook, through `e2e-patched` or `NODE_OPTIONS`, and lets arm 3 read the baseline's settings through `importBaseline`.
- `assertOwnCacheDir` (arm 3) stops a run whose replay cache is not the config's own, or is a baseline arm's, with the directory as e2e picks it (the last `--cache-dir`, else a non-blank `E2E_CACHE_DIR`, else `cache.dir`, from the folder of `--config` as given) and symlinks resolved. The agent's and the scripted runs each have their own.

To change a patch, unpack the published package, apply the patch with `git apply`, edit, and write the diff back with `git diff`; keep its `.js` files only, since the types are in [`src/patched.ts`](src/patched.ts).

## What the patches change

`@e2e-dev/core` (`patches/@e2e-dev__core@0.25.0.patch`; e2e's runner lives there since 0.25.0):

- **A call that hands over its input is recorded and replayed.** A tool call made with `budgets.runTool({ ..., replay: { input } })`, as `serveProjectTools` makes every call, is recorded with its tool name and input once it succeeded; a call that failed is not recorded. A cached replay runs it again through the executor's new `replayTool(ctx, name, input)`, where e2e as published stops the replay and hands the step to the model.
- **A step of calls alone is saved without a change on screen.** e2e saves a step only when the screen changed, so its replay has a change to check. A step made only of recorded calls is saved without one, and its replay passes when the calls run again without failing; e2e's alert check still runs.
- **A call that may have changed the page before it failed is never kept, nor taken for a stale tool.** A page action is counted where e2e's engine dispatches one, and, in the package, on each call of the `browser` fixture but its reads. When a recorded call fails after one, or with e2e's `ACTION_MAY_HAVE_COMMITTED`, its replay stops as e2e's uncertain action: the executor gets e2e's hand-off, which says to verify before acting again, even when no action completed before it. When a call fails after a page action anywhere in a step, the replay of the recording, its fallback or the executor's own run, nothing of that step's run is saved and the entry it replayed is evicted, fallback and all. It says so in an `[e2e-patch] ... is not saved` line.
- **A recorded call is no gap.** e2e treats every tool entry of a trace as one that stops replay. A recorded call replays and runs on, so where e2e decides whether a trace opens with a navigate (and needs no start route), and where a fill of this run's data becomes a gap, a recorded call counts as an action and only a call without input as a gap.
- **A tool's fill proves no more than e2e's own.** The evidence check discounts a changed value on a control a step filled, because a recorded fill names its target. A call names none, so for a step with recorded calls every control whose value or state changed is discounted the same way.
- **A recorded call keeps the version of its Page Object source.** `directPageObjects` hands e2e a digest of the files its actions are written in (`Symbol.for("e2e.patch.toolSourceVersion")`), and each recorded call keeps it (`source`). With `AYME_E2E_REFRESH_AFTER_PO_CHANGE` set, a replayed step whose every action, the fallback's included, is a recorded call, and one of whose calls' source changed since the recording, passes once every call ran and no new alert shows, without the end screen the recording kept, and is recorded afresh; the test's own assertions still run. Without it, e2e checks that end screen and hands a step whose end screen changed to the model.
- **A stale call keeps its recording, and what healed it is kept beside it.** When a recorded call fails on replay before any page action, the Page Object went stale, not the recording: the step keeps the recording whatever the agent does to finish it. What the agent did from the failed call on is stored beside the call as its healed fallback (`healed` in the entry). While the call keeps failing, a replay runs the fallback from there with no model; once the call runs again, the fallback is dropped. Each says so in an `[e2e-patch] healed:` line. In the package, `serveProjectTools`'s `onFailure` hears of every failed call, and `staleNotes` writes a note for whoever fixes the Page Object, for every failed call but an agent's live call its Page Object's own rules refused ([`src/stale.ts`](src/stale.ts)).
- **The attempt's `screen` for project tools.** e2e gives a config tool no `screen`; the patch keeps the newest attempt's fixtures under `Symbol.for("e2e.patch.screens")`, which `directPageObjects` builds the Page Objects on.

`@e2e-dev/acp` (`patches/@e2e-dev__acp@0.1.3.patch`; 0.1.3 is the version arm 1 runs, so both arms run one ACP executor):

- **Config tools served over ACP.** A `tools` option serves tools to the agent beside e2e's own action tools, under the same step guard, and the executor implements `replayTool` for them. As for the action tools, the guard is asked again when a call's turn in e2e's action queue comes (`stepEnded`), so a call queued behind the step's verdict does not act.
- **The tool list holds what can run now.** A served tool with `hidden` is listed only while it answers false. The list is checked when the request being served asks for `tools/list` alone, as its JSON body says, after each call, and before each live turn but the first: a call's answer carries MCP's `tools/list_changed` notice when the call changed the list, and a turn's message names the served tools that can run when the list changed since the agent's last call, as a replay or the test itself may have changed the screen. That line is the one difference between what arm 3's agent and the goals-only arm's agent are told, beside the tools and the rules about them. Any other request reaches every tool, so a call reaches its tool's own refusal. In the package, `serveProjectTools`'s `hidden` asks `ruledOutNow` (the Page Object's presence, root and availability rules), and `dropAfterFailure` refuses a call that failed with the same input for the rest of the test. `AYME_E2E_DEBUG` logs when the list changes. The rules read the tab in front only, which is the screen the agent sees: a Page Object of a window in the back is not listed until the agent switches to its tab.

`e2e` (`patches/e2e@0.25.0.patch`): the runner forks its test workers with the hook's `--import`, which `e2e-patched` hands it.

## Known limits

Arm 3's tools do not hit these:

- The recorder keeps a call's JSON `null` input as `{}`.
- Under `e2e-patched`, even with no config tools, the patched core keeps the newest attempt's fixtures on `globalThis`, the patched ACP executor parses every POST body its MCP server gets, and `AYME_E2E_DEBUG` adds logs. The independent review found no change of verdict for an ordinary step from them.

These they can:

- `evaluate` on the `browser` fixture counts as a page action, since page code can change anything, so a call that read through it before failing is handed off as uncertain and keeps no fallback.
- Activating a tab, as a Page Object brings its tab forward, is no page action: it changes which tab is in front, not the app, and the same call activates it again on every replay before it fails.
- When a stale call fails before any page action and the agent finishes the step with nothing e2e saves, such as a hover alone, no fallback is kept, so that step goes to the model on every run until the Page Object is fixed.
- Whether the agent's MCP client takes the list's change notice between turns is untested without a model; the turn's message names the change either way, and the first call's answer carries the notice.
- No model-free check runs the ACP path live: the check's ACP executor only replays, with an agent that cannot start. So the re-check of a call queued behind the step's verdict (`stepEnded`), the refresh before a turn and the MCP listing are exercised only by a run with the real agent. A fake ACP agent for them needs an ACP agent on stdio and an MCP client over HTTP, more than the check is worth now.

## Running the model-free check

[`apps/inspector-fixture/e2e.tools-check.config.ts`](../../apps/inspector-fixture/e2e.tools-check.config.ts) calls the e2e suite's Page Objects as tools from a scripted executor, through e2e's tool accounting, as an agent's call would go; its switches are listed there. From `apps/inspector-fixture`, with the fixture's dependencies built (`pnpm turbo build --filter='@ayme-dev/inspector-fixture^...'`):

| Run                                                 | Command                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| Record                                              | `pnpm test:tools-check`                                                |
| Replay only: a step that reaches the executor fails | `AYME_E2E_CACHE=read-only pnpm test:tools-check`                       |
| Replay only, through the ACP executor               | `AYME_E2E_CACHE=read-only AYME_E2E_EXECUTOR=acp pnpm test:tools-check` |

The recordings are under `.e2e/cache-tools-check`; delete it to record afresh.

## Running arm 3

[`apps/inspector-fixture/e2e.goals-tools.config.ts`](../../apps/inspector-fixture/e2e.goals-tools.config.ts) runs arm 1's goal tests (`tests/goals`, its config `e2e.goals.config.ts`) unchanged, with the same agent, model and ports, and the e2e suite's Page Objects as tools beside e2e's own action tools. From `apps/inspector-fixture`:

| Run                                                      | Command                          |
| -------------------------------------------------------- | -------------------------------- |
| Arm 3, Claude Code on your own login                     | `pnpm test:goals:tools`          |
| The same goals answered by scripted calls, with no model | `pnpm test:goals:tools:scripted` |

The scripted run takes its calls from [`tests/e2e/tools/goalCalls.ts`](../../apps/inspector-fixture/tests/e2e/tools/goalCalls.ts), one entry per goal, and keeps its recordings apart from the agent's.
