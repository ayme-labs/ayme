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
- **E2E** runs the built packages on fixture pages or example apps, through page objects. The Inspector's run in [`apps/inspector-fixture`](../apps/inspector-fixture/README.md), whose Page Objects the Ayme plugin compiles. Tools are called through the recording WebMCP driver from `@ayme-dev/ayme/testing`. Next, Nuxt and SvelteKit run against both their dev server and a production build. Angular runs four times: its default SSR build and its `spa` configuration, each against `ng serve` and a production build.
- **Package verification** checks what consumers install: packed manifests, exports and type-checking in a clean consumer. `pnpm test:package` in `ayme` runs it alone; the release workflow runs it on the tarballs it publishes ([releasing.md](releasing.md)).
- `packages/angular`'s `ng add` tests run Angular's `SchematicTestRunner` on the built `schematics/collection.json`, so the package's `test` task depends on its own `build`.
- **Live goals** run real goals through `goal` against the model. It needs `AYME_OPENROUTER_API_KEY` and skips itself without one. It is a separate CI job, and `pnpm check` does not run it. See the [example-vue README](../apps/example-vue/README.md#live-goal-lane), which also covers the hand-run goal harness.

Each package keeps its own Vitest config ([ADR-0003](adr/0003-keep-vitest-configuration-package-local.md)). Run `pnpm check` from the root for everything CI's Check job runs. On a pull request, CI runs the affected packages' `build lint typecheck test test:e2e`, plus commit lint, `turbo boundaries`, the docs check ([`scripts/check-docs.mjs`](../scripts/check-docs.mjs)) and the format check ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).

## Test-only code

Fakes, test doubles and page objects for tests ship from the package's `testing` entry, `@ayme-dev/<package>/testing`, built from its `src/testing.ts` or `src/testing/index.ts`. Only test files may import one; lint enforces it ([`testing-entries.js`](../packages/eslint-config/testing-entries.js)). Why, and the options we rejected: [ADR-0026](adr/0026-test-seams-behind-a-testing-entry.md).

| Entry                                           | Holds                                                                                                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ayme-dev/ayme/testing`                        | The recording WebMCP driver: `recordPublishedTools`, `recordPublishedToolsLate`, `waitForPublishedTool`, `executePublishedTool` and its queries |
| `@ayme-dev/inspector/testing`                   | The Inspector's page objects, for its own tests, its e2e tests and example-vue's smoke test                                                     |
| `@ayme-dev/core/structural-observation/testing` | `StructuralTreeMockFactory` and `MockLiveAriaSnapshotSource`, for structural trees without a browser                                            |

Consumers may use these entries to test their own integration.

Test data a package keeps to itself, such as builders, stays out of the `testing` entry. In the Inspector it lives in the `test-utils/` folder of the slice that owns the type, which only tests may import ([`packages/inspector/AGENTS.md`](../packages/inspector/AGENTS.md)).
