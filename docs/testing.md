# Testing

Where each kind of test runs, what it is for, and where test-only code lives. The configs, scripts and ADRs linked here are the source of truth; this page only points at them.

## Test lanes

| Lane                 | Runs with                                         | Files                                     | Command                                    |
| -------------------- | ------------------------------------------------- | ----------------------------------------- | ------------------------------------------ |
| Unit                 | Vitest in Node, or jsdom for hooks and components | `*.test.ts`, `*.test.tsx`                 | `pnpm test`                                |
| Browser              | Vitest browser mode on Chromium                   | `*.browser.test.ts`, `*.browser.test.tsx` | `pnpm test` or `pnpm test:e2e` (see below) |
| Native WebMCP        | Vitest browser mode on Chromium's own WebMCP      | `*.native.browser.test.ts` in `ayme`      | `pnpm test:e2e` in `packages/ayme`         |
| E2E                  | Playwright on built packages and example apps     | `tests/**/*.spec.ts`                      | `pnpm test:e2e`                            |
| Package verification | A clean consumer installs the packed packages     | `packedConsumer.test.ts`                  | `pnpm test` in `ayme`                      |
| Live goals           | Playwright with the real model                    | `apps/example-vue/tests/goals.spec.ts`    | `pnpm test:goals` in `apps/example-vue`    |

- **Unit** covers pure modules and framework hooks. Expected values come from fixtures and examples, never from the code under test.
- **Browser** covers code that needs a real DOM.
  - `packages/ayme` runs the runtime against real pages in `test:e2e` ([`vitest.browser.config.ts`](../packages/ayme/vitest.browser.config.ts)).
  - `packages/inspector` renders one part of the panel with fixture props and drives it through the Inspector's page objects on playwright-lite, in its `component` project ([`vitest.config.ts`](../packages/inspector/vitest.config.ts)). Its [agent notes](../packages/inspector/AGENTS.md#testing) say how those page objects work.
- **Native WebMCP** is the only lane that tests the real WebMCP transport: Chromium with `--enable-features=WebMCP,WebMCPTesting`. Every other lane that needs WebMCP uses the recording driver below.
- **E2E** runs the built packages on fixture pages or example apps, through page objects. The Inspector's run in [`apps/inspector-fixture`](../apps/inspector-fixture/README.md), whose Page Objects the Ayme plugin compiles. `@ayme-dev/mcp`'s run in [`apps/mcp-fixture`](../apps/mcp-fixture/README.md): an MCP SDK client starts its server over stdio while Playwright opens the fixture page, and the tests assert through the MCP client. Tools are called through the recording WebMCP driver from `@ayme-dev/ayme/testing`. Every example runs the shared [example certification](../apps/example-certification/README.md)'s Agent Connection check; Next and SvelteKit run all of it, and it also builds their Playwright config. Next, Nuxt and SvelteKit run against both their dev server and a production build. Angular runs four times: its default SSR build and its `spa` configuration, each against `ng serve` and a production build.
- **Package verification** checks what consumers install: packed manifests, exports and type-checking in a clean consumer. `pnpm test:package` in `ayme` runs it alone; the release workflow runs it on the tarballs it publishes ([releasing.md](releasing.md)).
- `packages/angular`'s `ng add` tests run Angular's `SchematicTestRunner` on the built `schematics/collection.json`, so the package's `test` task depends on its own `build`.
- **Live goals** run real goals through `goal` against the model. It needs `AYME_TYPESAFE_API_KEY` or `AYME_OPENROUTER_API_KEY` and skips itself without one. It is a separate CI job, and `pnpm check` does not run it. See the [example-vue README](../apps/example-vue/README.md#live-goal-lane), which also covers the hand-run goal harness.

Each package keeps its own Vitest config; the change-analysis lane below builds its configs from shared helpers in `@ayme-dev/test-config`. Run `pnpm check` from the root for everything CI's Check job runs. On a pull request, CI runs the affected packages' `build lint typecheck test test:e2e`, plus commit lint, `turbo boundaries`, the docs check ([`scripts/check-docs.mjs`](../scripts/check-docs.mjs)) and the format check ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).

## Change analysis

Every pull request runs `pnpm analyze:changed` before it goes ready. It compares the working tree with `main`, finds the packages whose `src/` changed, and runs their fast lane: CRAP for each function the change touched, and Stryker mutants on the changed lines only. The report prints and is written to `reports/analyze-changed.md` ([`scripts/analyze-changed.mjs`](../scripts/analyze-changed.mjs)).

The fast lane is each package's `vitest.fast.config.ts`: its unit tests and its Vitest browser-mode tests, without `packedConsumer.test.ts`. Playwright e2e tests are not in it, so code that only they exercise reads as uncovered. Stryker skips static mutants here, code that runs when a module loads such as tool descriptions, because no test owns them and each one would rerun every test. The shared settings live in [`packages/test-config`](../packages/test-config).

Code serialized into the page, such as a `locator.evaluate` callback, reads as uncovered, and Stryker's instrumentation breaks it there. Wrap such a callback in `// Stryker disable all` and `// Stryker restore all`; without them, analysis of its file fails on its first test run.

Act on the report like this:

- A function the change added, or whose complexity it raised, with CRAP above 15: add tests or simplify it in this pull request.
- A surviving mutant on a changed line: add a test that kills it, or give a one-line reason in the pull request, for example that the mutant is equivalent.
- A touched function that was already above 15 is not yours to refactor: test the lines you changed, note its score in the pull request, and leave the refactor to its own issue.

The `new`, `raised` and `existing` labels come from matching functions to `main` by name and order, so check a surprising one. Run analysis locally only through `analyze:changed`; runs over every file belong to CI.

## Test-only code

Fakes, test doubles and page objects for tests ship from the package's `testing` entry, `@ayme-dev/<package>/testing`, built from its `src/testing.ts` or `src/testing/index.ts`. Only test files may import one; lint enforces it ([`testing-entries.js`](../packages/eslint-config/testing-entries.js)). Why, and the options we rejected: [ADR-0026](adr/0026-test-seams-behind-a-testing-entry.md).

| Entry                                           | Holds                                                                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ayme-dev/ayme/testing`                        | The recording WebMCP driver: `recordPublishedTools`, `recordPublishedToolsLate`, `waitForPublishedTool`, `executePublishedTool` and its queries                                          |
| `@ayme-dev/inspector/testing`                   | The Inspector's page objects, for its own tests, its e2e tests and the example apps' smoke tests                                                                                         |
| `@ayme-dev/core/structural-observation/testing` | `StructuralTreeMockFactory` and `MockLiveAriaSnapshotSource`, for structural trees without a browser                                                                                     |
| `@ayme-dev/mcp/testing`                         | A coding agent for e2e tests: `startAgent` runs `ayme mcp` over stdio, `connectPage` pairs a Playwright page by link, and `ignoreAutoPairScan` keeps a context's pages from auto-pairing |

Consumers may use these entries to test their own integration.

Test data a package keeps to itself, such as builders, stays out of the `testing` entry. In the Inspector it lives in the `test-utils/` folder of the slice that owns the type, which only tests may import ([`packages/inspector/AGENTS.md`](../packages/inspector/AGENTS.md)).
