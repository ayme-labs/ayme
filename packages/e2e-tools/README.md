# e2e tools

Page Objects written on e2e's `screen` offered to an agent as tools, for the third arm of the Page Object study: tests are `agent.act` goals, and the agent answers each goal by calling a Page Object Tool. e2e is the test runner from [e2e.com](https://e2e.com). Private: only this repository's study uses it, and nothing in CI runs it.

The study writes the same Inspector journeys three ways, called arms: plain `agent.act` goals on e2e as published (arm 1); the e2e suite's Page Objects called directly (arm 2, [`apps/inspector-fixture/tests/e2e/pom`](../../apps/inspector-fixture/tests/e2e/pom)); and goals answered by calls of those same Page Objects as tools (arm 3, this package). An action stays deterministic code; e2e records the call and replays it with no model.

```
src/direct.ts        directPageObjects: one tool per Page Object Action, derived by ayme's
                     compiler from an entry file, called on the attempt's own `screen`
src/projectTools.ts  serveProjectTools: config tools for the patched ACP executor's `tools` option,
                     listed only while they can run, with a hook for each failed call
src/stale.ts         staleNotes: a note per failed call, for whoever fixes the Page Object
src/rules.ts         what arm 3's agent is told about the tools
src/patched.ts       the patched e2e's additions, typed, and assertPatchedE2e
patched-e2e/         e2e-patched: e2e's CLI with the patches applied in its own processes only
patches/             the patches, one per package, named as pnpm names them
```

## How patched and unpatched e2e share one checkout

The patches stand in for changes e2e does not ship. They are not pnpm patches: the installed `@e2e-dev/core` and `@e2e-dev/acp` are the published packages, byte for byte, for every arm. `e2e-patched <args>` runs e2e's own CLI with a module hook ([`patched-e2e/register.mjs`](patched-e2e/register.mjs)) that hands Node the patched source of each file a patch changes as it loads it, in the runner and, through `NODE_OPTIONS`, in the test workers it forks. A run started with `e2e run`, as arms 1 and 2 are, never loads the hook. Each hunk must match the published file exactly and the installed version must be the patch's, so an upgraded e2e stops the run instead of half-applying a patch. A config that needs the patches calls `assertPatchedE2e`, so a plain `e2e run` of it stops at once.

To change a patch, unpack the published package, apply the patch with `git apply`, edit, and write the diff back with `git diff`; keep its `.js` files only, since the types are in [`src/patched.ts`](src/patched.ts).

## What the patches change

`@e2e-dev/core` (`patches/@e2e-dev__core@0.25.0.patch`; e2e's runner lives there since 0.25.0):

- **A call that hands over its input is recorded and replayed.** A tool call made with `budgets.runTool({ ..., replay: { input } })`, or a config tool annotated `repeatable: true`, is recorded with its tool name and input once it succeeded; a call that failed is not recorded. A cached replay runs it again through the executor's new `replayTool(ctx, name, input)`, where e2e as published stops the replay and hands the step to the model. The built-in agent implements `replayTool` for its repeatable config tools.
- **A step of calls alone is saved without a change on screen.** e2e saves a step only when the screen changed, so its replay has a change to check. A step made only of recorded calls is saved without one, and its replay passes when the calls run again without failing; e2e as published asks the model again on every run.
- **A recorded call keeps the version of its Page Object source.** `directPageObjects` hands e2e a digest of the files its actions are written in (`Symbol.for("e2e.patch.toolSourceVersion")`), and each recorded call keeps it (`source`). With `AYME_E2E_REFRESH_AFTER_PO_CHANGE` set, a replayed step of calls alone whose source changed since the recording passes once every call ran, without the end screen the recording kept, and is recorded afresh; the test's own assertions still run. Without it, e2e checks that end screen and hands a step whose end screen changed to the model. A call always runs first on replay: the experiment's fallback to the actions a call made on the screen is not carried over.
- **A stale call keeps its recording, and what healed it is kept beside it.** When a recorded call fails on replay, the Page Object went stale, not the recording: the step keeps the recording whatever the agent does to finish it. What the agent did from the failed call on is stored beside the call as its healed fallback (`healed` in the entry). While the call keeps failing, a replay runs the fallback from there with no model; once the call runs again, the fallback is dropped. Each says so in an `[e2e-patch] healed:` line. In the package, `serveProjectTools`'s `onFailure` hears of every failed call, and `staleNotes` writes a note per failed call for whoever fixes the Page Object.
- **The attempt's `screen` for project tools.** e2e gives a config tool no `screen`; the patch keeps the newest attempt's fixtures under `Symbol.for("e2e.patch.screens")`, which `directPageObjects` builds the Page Objects on.

`@e2e-dev/acp` (`patches/@e2e-dev__acp@0.1.3.patch`; 0.1.3 is the version arm 1 runs, so both arms run one ACP executor):

- **Config tools served over ACP.** A `tools` option serves tools to the agent beside e2e's own action tools, under the same step guard, and the executor implements `replayTool` for them.
- **The tool list holds what can run now.** A served tool with `hidden` is listed only while it answers false. The list is checked when the agent asks for it and after each call, and when a call changed it, the call's answer carries MCP's `tools/list_changed` notice, so the agent reads it again; any other request reaches every tool, so a call reaches its tool's own refusal. In the package, `serveProjectTools`'s `hidden` asks `ruledOutNow` (the Page Object's presence, root and availability rules), and `dropAfterFailure` takes a tool that failed out of the list and refuses it for the rest of the test. `AYME_E2E_DEBUG` logs when the list changes.

## Running the model-free check

[`apps/inspector-fixture/e2e.tools-check.config.ts`](../../apps/inspector-fixture/e2e.tools-check.config.ts) calls the e2e suite's Page Objects as tools from a scripted executor, through e2e's tool accounting, as an agent's call would go. From `apps/inspector-fixture`, with the fixture's dependencies built (`pnpm turbo build --filter='@ayme-dev/inspector-fixture^...'`):

| Run                                                 | Command                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| Record                                              | `pnpm test:tools-check`                                                |
| Replay only: a step that reaches the executor fails | `AYME_E2E_CACHE=read-only pnpm test:tools-check`                       |
| Replay only, through the ACP executor               | `AYME_E2E_CACHE=read-only AYME_E2E_EXECUTOR=acp pnpm test:tools-check` |

The recordings are under `.e2e/cache-tools-check`; delete it to record afresh.

`AYME_E2E_STALE=<tool>` makes that tool fail as a stale Page Object would; the check's collapse step then heals by tapping, which shows the healed fallback being kept, replayed and dropped.

## Running arm 3

[`apps/inspector-fixture/e2e.goals-tools.config.ts`](../../apps/inspector-fixture/e2e.goals-tools.config.ts) runs arm 1's goal tests (`tests/goals`, its config `e2e.goals.config.ts`) unchanged, with the same agent and model, and the e2e suite's Page Objects as tools beside e2e's own action tools. From `apps/inspector-fixture`:

| Run                                                      | Command                                            |
| -------------------------------------------------------- | -------------------------------------------------- |
| Arm 3, Claude Code on your own login                     | `pnpm test:goals:tools`                            |
| The same goals answered by scripted calls, with no model | `AYME_E2E_EXECUTOR=scripted pnpm test:goals:tools` |

The scripted run takes its calls from [`tests/e2e/tools/goalCalls.ts`](../../apps/inspector-fixture/tests/e2e/tools/goalCalls.ts), one entry per goal, and keeps its recordings apart from the agent's. Arm 1's config reuses a fixture server already on its port (5199, or `AYME_GOALS_PORT`), whichever checkout started it: give each checkout its own port.
