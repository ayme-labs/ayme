# e2e tools

Page Objects written on e2e's `screen` offered to an agent as tools, for the third arm of the Page Object study: tests are `agent.act` goals, and the agent answers each goal by calling a Page Object Tool. e2e is the test runner from [e2e.com](https://e2e.com). Private: only this repository's study uses it, and nothing in CI runs it.

The study writes the same Inspector journeys three ways, called arms: plain `agent.act` goals on e2e as published (arm 1); the e2e suite's Page Objects called directly (arm 2, [`apps/inspector-fixture/tests/e2e/pom`](../../apps/inspector-fixture/tests/e2e/pom)); and goals answered by calls of those same Page Objects as tools (arm 3, this package). An action stays deterministic code; e2e records the call and replays it with no model.

```
src/direct.ts        directPageObjects: one tool per Page Object Action, derived by ayme's
                     compiler from an entry file, called on the attempt's own `screen`
src/projectTools.ts  serveProjectTools: e2e config tools for the patched ACP executor's `tools` option
src/patched.ts       what the patched e2e adds, typed again so this package builds on e2e as published
```

It runs only on a patched e2e, whose patches stand in for changes e2e does not ship. A pnpm patch changes the one installed copy for the whole workspace, and arms 1 and 2 must run on e2e as published, so the patches come in a commit of their own on top of this one, with a section here on what they change; arm 3 is run from there.

## Running the model-free check

[`apps/inspector-fixture/e2e.tools-check.config.ts`](../../apps/inspector-fixture/e2e.tools-check.config.ts) calls the e2e suite's Page Objects as tools from a scripted executor, through e2e's tool accounting, as an agent's call would go. From `apps/inspector-fixture`, with the fixture's dependencies built (`pnpm turbo build --filter='@ayme-dev/inspector-fixture^...'`):

| Run                                                 | Command                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| Record                                              | `pnpm test:tools-check`                                                |
| Replay only: a step that reaches the executor fails | `AYME_E2E_CACHE=read-only pnpm test:tools-check`                       |
| Replay only, through the ACP executor               | `AYME_E2E_CACHE=read-only AYME_E2E_EXECUTOR=acp pnpm test:tools-check` |

The recordings are under `.e2e/cache-tools-check`; delete it to record afresh.
