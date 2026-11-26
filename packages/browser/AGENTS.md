# Browser package

Gets ayme a browser: finds the project's installed Playwright, holds the supported Playwright range, starts Chromium or joins a running one over the DevTools protocol without Playwright's defaults, and releases it. A headless join still sets Playwright's font families on its pages; ayme cannot stop that. Private: the recorder bundles it, so `@ayme-dev/cli` carries it. Why it has no Playwright of its own: [ADR-0052](../../docs/adr/0052-the-recorder-runs-on-stock-playwright-and-uses-its-private-parts-only-under-test.md).

`src/index.ts` is the front door. Getting and releasing a browser drives a real one, so it sits in [`infrastructure/live/`](src/infrastructure/live/browser.ts), which the [compatibility suite measures](../../docs/testing.md#code-a-real-browser-runs); unit tests measure the plain logic.

The checks:

- [`eslint.config.js`](eslint.config.js), which [`src/layout.test.ts`](src/layout.test.ts) checks: production code imports only Playwright's types and the stable `effect` package; only the front door reaches `infrastructure/live/`.
- [`tsdown.config.ts`](tsdown.config.ts) keeps `playwright-core` external, so the Playwright types in its declarations are the caller's own.

Nothing checks these:

- Give `import()` a plain string: lint cannot check a computed one.
- `leaveDialogsOpen` listens as soon as Playwright hands the browser over, the earliest its public API allows; a dialog opened during the join is still dismissed.
- Write a `BrowserError` message as what was found; leave the advice to the caller, since the recorder's and a Session's differ.
- Let starting and joining differ only in how the browser is got and let go, so one compatibility suite tests both.
- A caller, like the recorder, lists this package under `devDependencies`, so its build bundles it and `@ayme-dev/cli` installs no package of ayme's.
- Flows are written with Effect 4; [the recorder's notes](../recorder/AGENTS.md#effect) say which documentation to use.

## The supported Playwright range

[`playwright-range.json`](playwright-range.json) here states the range: the oldest Playwright ayme gets a browser with, and the newest verified. This package, CI's per-version job, the packed-consumer test and the recorder's sentences read it; the root one is the published packages' `@playwright/test` range. Below it, finding the project's Playwright fails; above it, it succeeds and a caller may warn.

To verify a new Playwright minor, run this package's compatibility suite, the recorder's and the recorder's main end-to-end test on it, then move `lastVerified`.

## Testing

How to run tests here, and what each lane measures: [docs/testing.md](../../docs/testing.md#local-runs-and-ci).

- Unit tests drive the front door on a stand-in for the project's Playwright: a folder with its own `node_modules`, as in the recorder's start tests.
- [The compatibility suite](src/infrastructure/live/browser.compat.test.ts) runs real Chromium, with `pnpm test:compat` ([`vitest.compat.config.ts`](vitest.compat.config.ts)), not `pnpm test`, on the Playwright in the folder `AYME_PLAYWRIGHT_PROJECT` names, else this package's own. A run counts only with the verdict line [`compatRunCheck.js`](../test-config/compatRunCheck.js) prints: a reporter cannot fail a run whose tests were skipped.
