# Inspector e2e harness

Flow-shaped tests of the Inspector on the fixture's `/dogfood.html`, written
for [e2e](https://github.com/tester-army/e2e): each step is a natural-language
`agent.act(...)` in the panel's own vocabulary (lens names, tool names), the
assertions stay in code. `@ayme-dev/e2e` answers each step from the Inspector's
Page Object Tools and stores the calls, so a recorded step replays with no
model. It is the test bed for that package.

```
base.config.ts           the engine, the app URL, the page object files, the cache dirs
e2e.scripted.config.ts   a model-free stand-in: each step scripted to its tool call or clicks
e2e.acp.config.ts        an ACP agent (Claude by default, or Cursor) solves the steps
scripted-solver.ts       the scripts of the stand-in
tests/*.e2e.ts           the tests; tests/dogfood.ts opens the page and names the panel
.e2e/                    e2e's cache and output, and the Ayme call store (ignored)
```

The page objects offered as tools are the fixture's `pom/Inspector.ts` (the
Inspector's Page Object as the dogfood page registers it, found through its
open shadow root with plain CSS) and `pom/ListPage.ts`. The Inspector's own
entry file would reach the panel through the `ayme-inspector` selector engine,
which the web engine's Playwright never registers. The assertions use e2e's
`screen`, whose observation walks open shadow roots, so they need no selector
engine either.

## Running

Run from `apps/inspector-fixture`, inside the Devbox shell, with the packages
built (`pnpm build` at the root; the fixture serves the built Inspector).

1. Start the fixture dev server on the port the harness expects:

   ```sh
   pnpm --filter @ayme-dev/inspector-fixture dev -- --port 4691 --strictPort
   ```

   `AYME_E2E_APP_URL` points the harness at another URL.

2. The free check, with the scripted stand-in, both arms:

   ```sh
   AYME_E2E_ARM=stock pnpm exec e2e run --config e2e/e2e.scripted.config.ts
   AYME_E2E_ARM=ayme pnpm exec e2e run --config e2e/e2e.scripted.config.ts
   ```

   The first run of a config records; the second replays. On the stock arm
   e2e replays its own recording of the clicks; on the ayme arm e2e reports
   each tool step as `missed/gap` and the store replays the stored tool calls.

3. A paid run, one agent session per test:

   ```sh
   AYME_E2E_ARM=ayme pnpm exec e2e run --config e2e/e2e.acp.config.ts
   ```

   Claude is the default agent and uses the machine's own `claude auth login`;
   nothing is read from a token file or injected into the adapter's
   environment. `--output e2e/.e2e/out/<name>` keeps one run's report apart
   from another's.

Each config run takes `--debug` (the step table on stderr) and the usual e2e
selection flags (`--grep`, a test file path).

## Environment

| Variable                 | Values                                                          | Default                                                            |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `AYME_E2E_ARM`           | `stock` (clicks only), `ayme` (tools)                           | `stock`                                                            |
| `AYME_E2E_AGENT`         | `claude`, `cursor` (ACP config)                                 | `claude`                                                           |
| `AYME_E2E_MODEL`         | the agent's model                                               | `sonnet` for Claude, Opus 4.6 for Cursor                           |
| `AYME_E2E_AVAILABILITY`  | `0` turns the live-tool filter off                              | on for the ayme arm (ACP); `1` turns it on for the scripted config |
| `AYME_E2E_CACHE`         | `read-only` replays without recording                           | `read-write`                                                       |
| `AYME_E2E_CONFIG_NAME`   | names the cache and store directories                           | `scripted-<arm>`, `acp-<agent>-<arm>`                              |
| `AYME_E2E_TESTS`         | a test glob                                                     | `tests/**/*.e2e.ts`                                                |
| `AYME_E2E_APP_URL`       | the fixture's URL                                               | `http://127.0.0.1:4691`                                            |
| `AYME_E2E_LOG`           | a path; the agent's stderr goes to `<path>.stderr`              | unset                                                              |
| `AYME_E2E_SYSTEM_PROMPT` | `meta` sends Claude the prompt through ACP `_meta`              | first prompt                                                       |
| `AYME_E2E_CURSOR_AGENT`  | the Cursor CLI binary                                           | `agent`                                                            |
| `AYME_E2E_ROUTE`         | `direct` calls tools outside e2e's accounting (scripted config) | `runTool`                                                          |

## Cache modes

e2e's cache (`e2e/.e2e/cache-<name>`) and the Ayme store
(`e2e/.e2e/ayme/<name>`) sit side by side, one pair per config name. The cache
mode is `read-write` by default: a run records what the agent did and the
next run replays it. `AYME_E2E_CACHE=read-only` replays what is there and
hands a miss to the agent without recording, for checking a committed
recording. `--no-cache` turns e2e's cache off for one run.

## The two arms

- `stock`: the agent gets e2e's grammar only (tap, type, ...), as any e2e
  project would. Every step is clicks, which e2e records and replays.
- `ayme`: the agent also gets the Page Object Tools, `Inspector_*` and
  `ListPage_*`, and the live-tool filter (ACP config). A step solved with a
  tool call is stored and replays from the store, shared between tests that
  take the same step. A step with no fitting tool, such as pressing a run
  card's Run (`RunCard.run` is not a tool), stays clicks.

## The tests

| Test         | Steps, and what each caches to                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `panel`      | collapse the panel → `Inspector_collapse`; open the panel → `Inspector_open`                                            |
| `toolsLens`  | show the Tools lens → `Inspector_navigator_showLens`                                                                    |
| `toolSearch` | show the Tools lens; search for addItem → `Inspector_navigator_search`; open the tool's page → `Inspector_tool`         |
| `runTool`    | open the ListPage.addItem page → `Inspector_tool`; run it with a text → clicks (e2e's cache)                            |
| `runs`       | runTool's two steps (shared store), then clear the runs → `Inspector_runs_clear`                                        |
| `modelLens`  | show the Model lens → `Inspector_navigator_showLens`; collapse the models pane → `Inspector_navigator_model_togglePane` |

`aymeTools` offers a top-level page object's own actions and those of its
Page Object Children reached through singular component members, named by
the member path as Ayme publishes them (`Inspector_navigator_showLens`).
Collection members are left out: their tools need a Structural Ref to pick
the instance, which Node has no source for yet. A step whose tool is not
offered is clicks; the scripted solver logs it as `tool-not-offered-clicks`.
