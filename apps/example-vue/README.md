# Ayme WebMCP playground

This browser playground combines a functional list app with an Ayme inspector so the same Page Object behavior can be exercised by a person or an agent. It is published at [ayme-labs.github.io/ayme](https://ayme-labs.github.io/ayme/) so developers can try Ayme WebMCP before adding it to their own project. This README is for people reading the repository; visitors follow the instructions on the page itself.

- The demo app lets you add items and archive them through a confirmation dialog.
- A switch above the app shows its Page Object code instead: the files in `playwright/pom` as they are, highlighted, and the `useAyme` call that wires them into `App.vue`, as the Vue guide sets them up. The app and the code sit side by side in a strip that scrolls sideways, so the app stays on the page, a scroll away, and a tool that acts on it scrolls it back into view. `ignore` keeps the switch and the code out of Structural Page State, and `scripts/verify-browser-output.mjs` allows the Page Object source in the output only verbatim, as the text the code view shows. `pnpm run build` builds the app twice, into `dist` with Ayme and, with `--mode without-ayme`, into `dist-without-ayme` as a build without Ayme, and the same script then checks the second output for any trace of Ayme: the runtime, the compiled Page Object Models, their action descriptions and locator calls, Playwright and the Inspector.
- `ListPage` is a normal TypeScript class using `Page` and `Locator` types from Playwright. Vite bundles that same class for WebMCP and constructs it with the DOM-backed browser implementation.
- `@ayme` and `@ayme.action` choose the Page Object Tools. Tool descriptions come from the decorator.
- Registered page tools use their fully qualified POM method name, such as `ListPage.addItem`. A collection component action is registered once, at its collection path, such as `ListPage.items.archive`.
- A collection component action receives a `ref` (the Structural Ref of the instance's Page Object Root, as labelled in the page state) followed by an `args` object derived from its TypeScript method parameters: `ListPage.items.archive({ ref: "e5", args: {} })`.
- The bundler-neutral POM compiler reads the nearest `tsconfig.json` and derives each decorated method's input schema and each public `Locator` member as POM metadata. The Vite plugin is a thin adapter that places this metadata in the browser bundle. It derives nested, JSON-shaped object inputs too; the decorator does not duplicate parameter types or schemas.
- POM metadata also describes components constructed from a locator root, including repeated components exposed as paths such as `items[0].archiveButton`.
- `App.vue` calls `useAyme()` to own the runtime and lists `ListPage` in its `pageObjects` option to register it at setup. `ListPage` extends `AppPage`, the page base class whose `present` checks the URL against the page's `path`, and `ListItem` and `ArchiveDialog` extend `AppComponent`, whose `root` names their container, as the Page Object Models guide recommends.
- The runtime publishes the same registered tool objects to `document.modelContext` and the in-page debug console.
- The in-page Inspector (`inspector` in `App.vue`'s `useAyme`, off with `--mode inspector-disabled`) is a panel titled "ayme" that floats, docks left, right or bottom, or collapses to the ayme logo. Its navigator has three lenses: Model (the Page Objects on the page and the Page Object Models the page knows), Structure (the Structural Page State an agent receives, each node tagged with the member it maps to) and Tools (every tool the panel can run now, published or not). Selecting anything opens its detail, where the same run card runs its tools with a typed form; a tool's page and a structure node's detail also show "What the model sees", the definitions, page state and schemas an agent gets. Runs lists the runs made from the panel with their steps.
- The Inspector keeps its view live as the demo changes without recording anything an agent would see. It does not use framework bindings or element identity.
- The browser runtime is DOM-backed. It supports the locator operations used by the POM, including role/name lookup, filling, clicking, and visible/hidden waits, without requiring Playwright at runtime.

## Try with your agent

Open the playground and choose **Try with your own coding agent**. The wizard shows the prompt to paste into the agent: it registers [Ayme's MCP server](../../packages/mcp/README.md), pinned to the version of `@ayme-dev/mcp` in this repository, and asks the agent to call `ayme_connect` with the page's URL. The visitor opens the returned link in this tab, which pairs it without a reload; the wizard closes itself when the link arrives, because an open dialog blocks the page for the agent. The prompt is plain copy in `src/agentPrompts.ts`. Ayme's MCP server is the only thing a visitor installs, and the page contacts it only through a connect link. The [Ayme setup skill](../../skills/ayme/SKILL.md) is for integrating Ayme into your own project, not for trying the playground.

`App.vue` turns the Agent Connection (`agentConnection` in `useAyme`) on under the same condition as the Inspector, so `--mode inspector-disabled` builds without it. Building with `VITE_AGENT_CONNECTION=false` leaves out both the wizard and the Agent Connection; any other value, or none, keeps them. The hosted build sets it until `@ayme-dev/mcp` is published to npm. The end-to-end tests run the shared [example certification](../example-certification/README.md)'s Agent Connection check: an MCP client pairs with the dev server's page through a connect link and calls a tool. On the dev server only, a counter below the playground adds the Peek `counter` with `usePeek`, which the client reads before and after an increment and sees go when the counter unmounts; `ignore` keeps it out of Structural Page State.

The hosted bundle initializes the pinned WebMCP polyfill before the Vue app starts.

## User interface

The demo UI is built entirely from [shadcn-vue](https://www.shadcn-vue.com/) components copied into `src/components/ui`, on Tailwind CSS v4 with the default Neutral theme in light mode. The app carries no custom CSS: `src/style.css` holds only the Tailwind import and the theme tokens, and layout is expressed with Tailwind utilities in the templates. Add components with the shadcn-vue CLI or by copying the upstream source; do not hand-write new ones.

## Application setup

Call the lifecycle API once in the application root, with the pages it registers:

```ts
import { useAyme } from "@ayme-dev/vue";
import { ListPage } from "./playwright/pom/ListPage";

useAyme({ pageObjects: [ListPage], webMCP: { enabled: true } });
```

`webMCP.enabled` turns publication on through `@ayme-dev/webmcp`, which the example depends on; it is off unless set. No page argument or application watcher is required. The counter page of the certification registers `CounterPage` in its `Counter` component instead, since the counter's presence is that component's lifetime, and disposal is automatic.

This example turns the Inspector on with `inspector: { demo: true }`, so each action pauses briefly and each click shows a cue. `AgentPanel.vue` holds the agent wizard, which shows the prompt and loads nothing itself. `App.vue` also passes `ignore` to keep the site header out of Structural Page State. These helpers support the demo and are optional for applications.

Disabling publication does not remove Ayme or Page Object code from the bundle.

Run from this directory inside the repository's Devbox shell:

```sh
pnpm install
pnpm run typecheck
pnpm run test:e2e
```

The playground is also a Vue single-page app in the shared [example certification](../example-certification/README.md): its `/counter` route renders the counter contract page, and `/other` the page without Page Objects. On the dev server only, `/bench/` holds the [bench pages](#bench-goal-set). `test:e2e` runs the certification and the playground tests below against the dev server and the production build (`test:e2e:dev`, `test:e2e:prod`); the production build publishes no `goal`. The browser test injects a minimal `document.modelContext`, verifies the two published tools and their compiler-derived schemas, exercises direct list interaction, then invokes the published collection Page Object Tool and the same tool through the debug console against the real DOM-backed runtime.

## Live goal lane

The app turns the Goal Loop on only when the dev server mounts a Decision Endpoint, which it does only with a model key; a dev server started without a key and the deployed build publish no `goal`.

`pnpm run test:goals` is a separate Playwright lane that runs real goals through `goal` against the model. It is a check that the architecture still works, not an evaluation. `pnpm run test:e2e` does not run it. Retries are on, so a test passes when one of three attempts passes.

Anyone running it brings their own key: put a TypeSafe key in `AYME_TYPESAFE_API_KEY` or an OpenRouter key in `AYME_OPENROUTER_API_KEY` as `.env.example` describes. The TypeSafe key wins when both are set. Without a key the lane skips itself with a message, which is also what happens for a pull request from a fork, where no repository secret is available.

## Goal run harness

`pnpm run goals:runs --runs <N>` measures the Goal Loop instead of checking it: it runs every goal of a goal set N times against the real Decision Endpoint, with no retries, and writes one JSON file per invocation to `goal-runs/`, which Git ignores. It is run by hand only; CI and `pnpm check` never run it. It needs the same key as the live lane and stops without one. Run from this directory inside the repository's Devbox shell:

```sh
pnpm run goals:runs --runs 3
pnpm run goals:runs --runs 3 --live-lane
pnpm run goals:runs --runs 3 --goal-set bench
pnpm run goals:runs compare goal-runs/<runA>.json goal-runs/<runB>.json
```

By default it runs the harness's own goal set, `tests/goalHarness.spec.ts` under `playwright.harness.config.ts`: goals that are allowed to fail, so neither CI nor `pnpm run test:goals` runs them. `--goal-set <name>` picks a goal set by name: `harness`, `live-lane` (the live lane's goals, `playwright.goals.config.ts`; `--live-lane` says the same) or `bench` (the [bench goal set](#bench-goal-set)). The specs share `pursueGoal` through `tests/goalLane.ts`.

| Goal set  | Goal                                                             | Expected end                                       |
| --------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| harness   | `archive Review onboarding flow`                                 | The item in Archived, reason `done`, after 2 steps |
| live-lane | `Add an item called Milk`, with the Goal Value `item name: Milk` | Milk among the active items, reason `done`         |
| live-lane | `Add an item called Milk`                                        | Reason `needs_value`, the list unchanged           |
| live-lane | `Archive the second item in the list`                            | The second item in Archived, reason `done`         |
| bench     | 14 goals on pages without Page Objects                           | See [Bench goal set](#bench-goal-set)              |

The script sets `AYME_GOAL_RUNS=1` for the Playwright run it starts. Only then does a goal spec record a run; without it, as in CI and `pnpm run test:goals`, the recorder passes the goal straight through.

Spend is bounded by N: an invocation makes N runs of each goal, each run at most one to three model calls per step, up to the goal's step budget in its spec. `--runs` is required, so no invocation spends by default. Nothing is committed as a baseline; keep the files you want to compare.

A goal spec records each `goal` call as a `goal-run` test attachment (`tests/goalRunRecord.ts`): the Decision Endpoint calls the page makes, and the run's per-step scores, which `readLastGoalLoopRunResult` from `@ayme-dev/ayme/testing` reads from the page. A recording failure never fails the test; it is recorded as `recorderError`. A `goal` call that throws is still recorded, with a `null` reason, and its test then fails. The script reads those attachments from Playwright's JSON report. A file holds:

| Field                          | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commit`                       | `sha` of `HEAD`, and `dirty` when the working tree had changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `goalSet`                      | `harness`, `live-lane` or `bench`; absent in files written before goal sets were recorded, which ran the live lane                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `model`                        | The model identifier the decisions asked for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `runsPerGoal`                  | N                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `timestamp`                    | When the invocation finished, ISO 8601                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `goals.<test title>.goal`      | The goal text given to `goal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `goals.<test title>.runs[]`    | One record per run, below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `goals.<test title>.aggregate` | `runs`, `passRate`, `doneAtExpectedStepRate` (`null` when the spec states no expected step count), `noFittingOptionRate`, `meanSteps`, `maxSteps`, `meanModelCallsPerStep`, `meanPageBytesPerStep`, `meanHistoryBytesPerStep`, `meanWallTimeMs`, `reasons` (Handover reason counts), `chunkConflicts`, `noneOfTheseAnswers`, `repeatedSteps`, `wrongTargetSteps` (`null` when the spec states no expected targets), `meanInputTokensPerStep`, `meanOutputTokensPerStep`, `meanTokensPerRun` (the three `null` when no response reported usage) |

A run record holds `passed` (the test's expectations held, so the goal's expected outcome was reached), `reason` (the Handover reason, or `null` when the run failed before `goal` returned), `stepCount`, `doneAtExpectedStep` (the run ended `done` after exactly the step count its spec expects, the step judging the goal met included; absent when the spec states none), `wallTimeMs` (the `goal` call), `chunkConflicts`, `noneOfTheseAnswers`, `repeatedSteps`, `wrongTargetSteps` (absent when the spec states no expected targets), `inputTokens` and `outputTokens` (`null` when no response reported usage), `error` (the first line of a failed test's error), `recorderError` when recording failed, and `steps[]`. A step holds `operation` (the operation option stage one chose, `none` when nothing fits), `goalMetScore`, `modelCalls` (stage one, stage two and any run-off), `runOff` (the step asked a run-off, as the loop's step record says), `pageBytes` and `historyBytes` (the UTF-8 bytes of the `page` and `history` state fields stage one sent, as JSON; stage two sends the same state) and, for a step with stage two, `argumentChoices` (the chosen option key per argument question id, from the loop's step record only, which keeps chunk answers when a run-off then fails; absent when the run result could not be read), `argumentDescriptions` (per question id in `argumentChoices`, the chosen option as the question described it, such as `textbox "Email"` or `email: ada@example.com`) `inputTokens` and `outputTokens` (summed over the step's calls whose response reported `usage`; absent when none did), and, for a step that ran its operation, `chosen` (the loop's step record: per parameter, the key and description of the option it ran with).

A repeated step ran the same operation with the same arguments as the step before it that ran; a step that ran nothing, such as one that judged the goal met or whose decision failed, is not counted. A wrong-target step is a `fill` or `type` that ran a Goal Value whose expected element the spec states (`expectedTargets` on `pursueGoal`, per Goal Value label, as the loop describes elements: `role "name"`, or the bare role of a nameless one) into another element. Both read the arguments the step ran with from the loop's step record (`chosen`). Token usage is what the provider reported: the Decision Endpoint passes the provider's response through, and both TypeSafe and OpenRouter answer with `usage.input_tokens` and `usage.output_tokens`.

A chunk conflict is a step where several chunks of an over-cap ref question each named an element, so the loop requested a run-off among them; it counts even when the run-off then fails. A "none of these" answer is a chunk question answered with its `none_of_these` option. The rates count over all runs of the goal; the per-step means over all steps of all its runs.

`compare` takes paths relative to this directory. Files written before a metric existed show `-` for it. It prints each file's goal set, then, per goal, each aggregate of A and B with its delta, then lists the goals whose pass rate changed.

## Bench goal set

The bench goal set measures the Goal Loop on generic app screens that have no Page Objects, so every step acts through the Browser Tools (`click`, `fill`, `type`, `check`, `uncheck`, `select_option`) and picks its element by ref. The pages are plain Vue in `src/bench/`, without Ayme annotations, and the dev server serves them under `/bench/` (the production build leaves them out): a sign-in form, a profile form with similar textboxes and a nameless rich-text editor for the bio, a settings page with checkboxes, a radio group and a select, a project list with a search box and a per-row Rename dialog, and a new-project flow whose Continue moves to an invite form through a client-side route change. Label words repeat across fields on purpose.

`tests/benchGoals.ts` holds the goals, worded as a coding agent words them, each with its Goal Values, step budget (two to three times the intended steps), expected Handover reason, the DOM outcome the test checks, and its intended steps. The intended steps give each goal's expected step count and, for every `fill`, the element its Goal Value should go to, so the harness reports `doneAtExpectedStepRate` and `wrongTargetSteps` for them.

| Goal                                                                                                                         | Goal Values                                                 | Steps | Budget |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----- | ------ |
| `Sign in with the given email and password`                                                                                  | email, password                                             | 4     | 10     |
| `Sign in` (ends `needs_value`)                                                                                               | none                                                        | -     | 3      |
| `Set the bio to the given text and save`                                                                                     | bio                                                         | 3     | 8      |
| `Change the display name to the given value`                                                                                 | display name                                                | 2     | 5      |
| `Fill in the profile with the given values and save`                                                                         | first name, last name, display name, email, bio             | 7     | 18     |
| `Turn on push notifications and save`                                                                                        | none                                                        | 3     | 8      |
| `Switch to the dark theme`                                                                                                   | none                                                        | 2     | 5      |
| `Set the language to the given language`                                                                                     | language                                                    | 2     | 5      |
| `Turn off email notifications, use the dark theme, set the language to the given one, and save`                              | language                                                    | 5     | 12     |
| `Show only the projects that match the given search`                                                                         | search                                                      | 2     | 5      |
| `Rename the Mobile app project to the given name`                                                                            | new name                                                    | 4     | 10     |
| `The Confirm button of the Rename project dialog for the Mobile app project is highlighted with highlight_page_state_ref. …` | none                                                        | 3     | 4      |
| `Fill in the project details with the given values and continue`                                                             | project name, description                                   | 4     | 10     |
| `Create a project with the given details and invite the given teammate with the given role`                                  | project name, description, visibility, teammate email, role | 8     | 20     |

Run it with your own model key, as for the [live goal lane](#live-goal-lane), and compare two runs, for example before and after a change to the Goal Loop:

```sh
pnpm run goals:runs --runs 3 --goal-set bench
pnpm run goals:runs compare goal-runs/<before>.json goal-runs/<after>.json
```

`goalBench.spec.ts` runs the goals under `playwright.bench.config.ts`, which gives a test five minutes and no retries. Without a key it skips.

`goalBenchScripted.spec.ts` checks the bench's plumbing without a model, under `playwright.benchScripted.config.ts`, as part of `pnpm run test:e2e:dev`. It starts its own dev server with a stand-in model key, so the pages publish `goal`, and answers every decision request in the browser with the goal's intended steps, so no request reaches the server or a provider. Every goal must then reach its outcome at its expected step count, and the run harness's record of it must show no repeated or wrong-target step. One more run repeats a `fill` of the display name into the first textbox, the failure seen without Page Objects, and checks that the harness counts the repeated and wrong-target steps and the token usage.
