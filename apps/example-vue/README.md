# Ayme WebMCP playground

This browser playground combines a functional list app with an Ayme inspector so the same Page Object behavior can be exercised by a person or an agent. It is published at [ayme-labs.github.io/ayme](https://ayme-labs.github.io/ayme/) so developers can try Ayme WebMCP before adding it to their own project. This README is for people reading the repository; visitors follow the instructions on the page itself.

- The demo app lets you add items and archive them through a confirmation dialog.
- `ListPage` is a normal TypeScript class using `Page` and `Locator` types from Playwright. Vite bundles that same class for WebMCP and constructs it with the DOM-backed browser implementation.
- `@WebMCP` and `@WebMCP.tool()` choose the production WebMCP surface. Tool descriptions come from the decorator.
- Registered page tools use their fully qualified POM method name, such as `ListPage.addItem`. A collection component action is registered once, at its collection path, such as `ListPage.items.archive`.
- A collection component action receives a `ref` (the Structural Ref of the instance's Page Object Root, as labelled in the page state) followed by an `args` object derived from its TypeScript method parameters: `ListPage.items.archive({ ref: "e5", args: {} })`.
- The bundler-neutral POM compiler reads the nearest `tsconfig.json` and derives each decorated method's input schema and each public `Locator` member as POM metadata. The Vite plugin is a thin adapter that places this metadata in the browser bundle. It derives nested, JSON-shaped object inputs too; the decorator does not duplicate parameter types or schemas.
- POM metadata also describes components constructed from a locator root, including repeated components exposed as paths such as `items[0].archiveButton`.
- `App.vue` calls `useAymeWebMcp()` to own the runtime and `usePageObject(ListPage)` to register the imported POM instance.
- The runtime publishes the same registered tool objects to `document.modelContext` and the in-page debug console.
- The in-page inspector separates the App Model view (POM metadata, actions, executions, and traces) from the Page State view, which renders a YAML snapshot of the demo application with capture-scoped refs and POM decorations.
- The POM inspector probes registered members against the current DOM and refreshes when the demo changes. It does not use framework bindings or element identity.
- The browser runtime is DOM-backed. It supports the locator operations used by the POM, including role/name lookup, filling, clicking, and visible/hidden waits, without requiring Playwright at runtime.

## Try with your agent

Open the playground and choose **Try with your own coding agent**. The wizard explains the relay, shows the prompt to paste into the agent, and connects the page with **Relay installed — connect**. It closes itself once the relay answers, because an open dialog blocks the page for the agent. The prompts are plain copy in `src/agentPrompts.ts`. The [WebMCP local relay](https://github.com/WebMCP-org/npm-packages/tree/main/packages/webmcp-local-relay) MCP server is the only thing a visitor installs, and the page contacts it only after that click. The [Ayme setup skill](../../skills/ayme/SKILL.md) is for integrating Ayme into your own project, not for trying the playground.

The hosted bundle initializes the pinned WebMCP polyfill before the Vue app starts.

## User interface

The demo UI is built entirely from [shadcn-vue](https://www.shadcn-vue.com/) components copied into `src/components/ui`, on Tailwind CSS v4 with the default Neutral theme in light mode. The app carries no custom CSS: `src/style.css` holds only the Tailwind import and the theme tokens, and layout is expressed with Tailwind utilities in the templates. Add components with the shadcn-vue CLI or by copying the upstream source; do not hand-write new ones.

## Application setup

Call the lifecycle API once in the application root, before registering Page Objects:

```ts
import { useAymeWebMcp, usePageObject } from "@ayme-dev/webmcp-vue";
import { ListPage } from "./playwright/pom/ListPage";

useAymeWebMcp();
usePageObject(ListPage);
```

Enable publication with `aymeWebMcp({ publish: true })` in Vite configuration. No page argument or application watcher is required. Components can call `usePageObject` for their own scope, and disposal is automatic.

This example passes a custom page from `useDemoTrace` to add slow typing, click cues, and trace recording. `AgentPanel.vue` holds the agent wizard: it loads the local relay embed when the visitor connects, and reports what the embed says about the relay. `useDemoInspector` manages the debug panel and DOM highlights. These helpers support the demo and are optional for applications.

Disabling publication does not remove Ayme or Page Object code from the bundle. Production code removal is tracked separately in issue #39.

Run from this directory inside the repository's Devbox shell:

```sh
pnpm install
pnpm run typecheck
pnpm run test:e2e
```

The browser test injects a minimal `document.modelContext`, verifies the two published tools and their compiler-derived schemas, exercises direct list interaction, then invokes the published collection WebMCP tool and the same tool through the debug console against the real DOM-backed runtime.

## Live goal lane

The app turns the Goal Loop on only in development, because only the dev server mounts a Decision Endpoint; the deployed build publishes no `pursue_goal`.

`pnpm run test:goals` is a separate Playwright lane that runs real goals through `pursue_goal` against the model. It is a check that the architecture still works, not an evaluation. `pnpm run test:e2e` does not run it. Retries are on, so a test passes when one of three attempts passes.

Anyone running it brings their own key: put an OpenRouter key in `AYME_OPENROUTER_API_KEY` as `.env.example` describes. Without a key the lane skips itself with a message, which is also what happens for a pull request from a fork, where no repository secret is available.

## Goal run harness

`pnpm run goals:runs --runs <N>` measures the Goal Loop instead of checking it: it runs every goal of a goal set N times against the real Decision Endpoint, with no retries, and writes one JSON file per invocation to `goal-runs/`, which Git ignores. It is run by hand only; CI and `pnpm check` never run it. It needs the same `AYME_OPENROUTER_API_KEY` as the live lane and stops without one. Run from this directory inside the repository's Devbox shell:

```sh
pnpm run goals:runs --runs 3
pnpm run goals:runs --runs 3 --live-lane
pnpm run goals:runs compare goal-runs/<runA>.json goal-runs/<runB>.json
```

By default it runs the harness's own goal set, `tests/goalHarness.spec.ts` under `playwright.harness.config.ts`: goals that are allowed to fail, so neither CI nor `pnpm run test:goals` runs them. `--live-lane` runs the live lane's goals (`playwright.goals.config.ts`) instead. Both specs share their page helpers and `pursueGoal` through `tests/goalLane.ts`.

| Goal set  | Goal                                  | Expected end                                       |
| --------- | ------------------------------------- | -------------------------------------------------- |
| harness   | `archive Review onboarding flow`      | The item in Archived, reason `done`, after 2 steps |
| live-lane | `Add an item called Milk`             | Reason `needs_value`, the list unchanged           |
| live-lane | `Archive the second item in the list` | The second item in Archived, reason `done`         |

The script sets `AYME_GOAL_RUNS=1` for the Playwright run it starts. Only then does a goal spec record a run; without it, as in CI and `pnpm run test:goals`, the recorder passes the goal straight through.

Spend is bounded by N: an invocation makes N runs of each goal, each run at most one to three model calls per step, up to the goal's step budget in its spec. `--runs` is required, so no invocation spends by default. Nothing is committed as a baseline; keep the files you want to compare.

A goal spec records each `pursue_goal` call as a `goal-run` test attachment (`tests/goalRunRecord.ts`): the Decision Endpoint calls the page makes, and the run's per-step scores from the store behind the package-internal `getLastGoalLoopRunResult`. A recording failure never fails the test; it is recorded as `recorderError`. A `pursue_goal` call that throws is still recorded, with a `null` reason, and its test then fails. The script reads those attachments from Playwright's JSON report. A file holds:

| Field                          | Meaning                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commit`                       | `sha` of `HEAD`, and `dirty` when the working tree had changes                                                                                                                                                                                                                                                              |
| `goalSet`                      | `harness`, or `live-lane` with `--live-lane`; absent in files written before goal sets were recorded, which ran the live lane                                                                                                                                                                                               |
| `model`                        | The model identifier the decisions asked for                                                                                                                                                                                                                                                                                |
| `runsPerGoal`                  | N                                                                                                                                                                                                                                                                                                                           |
| `timestamp`                    | When the invocation finished, ISO 8601                                                                                                                                                                                                                                                                                      |
| `goals.<test title>.goal`      | The goal text given to `pursue_goal`                                                                                                                                                                                                                                                                                        |
| `goals.<test title>.runs[]`    | One record per run, below                                                                                                                                                                                                                                                                                                   |
| `goals.<test title>.aggregate` | `runs`, `passRate`, `doneAtExpectedStepRate` (`null` when the spec states no expected step count), `noFittingOptionRate`, `meanSteps`, `maxSteps`, `meanModelCallsPerStep`, `meanPageBytesPerStep`, `meanHistoryBytesPerStep`, `meanWallTimeMs`, `reasons` (Handover reason counts), `chunkConflicts`, `noneOfTheseAnswers` |

A run record holds `passed` (the test's expectations held, so the goal's expected outcome was reached), `reason` (the Handover reason, or `null` when the run failed before `pursue_goal` returned), `stepCount`, `doneAtExpectedStep` (the run ended `done` after exactly the step count its spec expects, the step judging the goal met included; absent when the spec states none), `wallTimeMs` (the `pursue_goal` call), `chunkConflicts`, `noneOfTheseAnswers`, `error` (the first line of a failed test's error), `recorderError` when recording failed, and `steps[]`. A step holds `operation` (the operation option stage one chose, `none` when nothing fits), `goalMetScore`, `modelCalls` (stage one, stage two and any run-off), `runOff` (the step requested a run-off), `pageBytes` and `historyBytes` (the UTF-8 bytes of the `page` and `history` state fields stage one sent, as JSON; stage two sends the same state) and, for a step with stage two, `argumentChoices` (the chosen option key per argument question id: the loop's record where it has one, else each answer the Decision Endpoint returned for an offered option, so chunk answers survive a failed run-off).

A chunk conflict is a step where several chunks of an over-cap ref question each named an element, so the loop requested a run-off among them; it counts even when the run-off then fails. A "none of these" answer is a chunk question answered with its `none_of_these` option. The rates count over all runs of the goal; the per-step means over all steps of all its runs.

`compare` takes paths relative to this directory. It prints each file's goal set, then, per goal, each aggregate of A and B with its delta, then lists the goals whose pass rate changed.
