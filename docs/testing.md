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
  - `packages/inspector` renders one part of the panel with fixture props and drives it through the Inspector's page objects on playwright-lite, in its `component` project ([`vitest.config.ts`](../packages/inspector/vitest.config.ts)).
- **Native WebMCP** is the only lane that tests the real WebMCP transport: Chromium with `--enable-features=WebMCP,WebMCPTesting`. Every other lane that needs WebMCP uses the recording driver below.
- **E2E** runs the built packages on fixture pages or example apps, through page objects. Tools are called through the recording WebMCP driver from `@ayme-dev/ayme/testing`. Next and Nuxt run against both their dev server and a production build.
- **Package verification** checks what consumers install: packed manifests, exports and type-checking in a clean consumer.
- **Live goals** run real goals through `pursue_goal` against the model. It needs `AYME_OPENROUTER_API_KEY` and skips itself without one. It is a separate CI job, and `pnpm check` does not run it. See the [example-vue README](../apps/example-vue/README.md#live-goal-lane), which also covers the hand-run goal harness.

Each package keeps its own Vitest config ([ADR-0003](adr/0003-keep-vitest-configuration-package-local.md)). Run `pnpm check` from the root for everything CI's Check job runs. On a pull request, CI runs the affected packages' `build lint typecheck test test:e2e`, plus commit lint, `turbo boundaries` and the format check ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).

## Test-only code

Fakes, test doubles and page objects for tests ship from the package's `testing` entry, `@ayme-dev/<package>/testing`, built from its `src/testing.ts`. Only test files may import one; lint enforces it ([`testing-entries.js`](../packages/eslint-config/testing-entries.js)). Why, and the options we rejected: [ADR-0026](adr/0026-test-seams-behind-a-testing-entry.md).

| Entry                                           | Holds                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@ayme-dev/ayme/testing`                        | The recording WebMCP driver: `recordPublishedTools`, `waitForPublishedTool`, `executePublishedTool` and its queries |
| `@ayme-dev/inspector/testing`                   | The Inspector's page objects, for its own tests and example-vue's smoke test                                        |
| `@ayme-dev/core/structural-observation/testing` | `StructuralTreeMockFactory` and `MockLiveAriaSnapshotSource`, for structural trees without a browser                |

Consumers may use these entries to test their own integration.
