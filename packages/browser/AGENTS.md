# Browser package

Gets ayme a browser: it finds the Playwright the project has installed, holds the one list of supported Playwright versions, starts Chromium, joins a running browser over the DevTools protocol without Playwright's defaults, and releases the browser. It is private: the recorder bundles it, and so `@ayme-dev/cli` carries it. Why it uses the project's Playwright and none of its own: [ADR-0052](../../docs/adr/0052-the-recorder-runs-on-stock-playwright-and-uses-its-private-parts-only-under-test.md).

`src/index.ts` is the front door. Getting and releasing the browser drives a real one, so it sits in [`infrastructure/live/`](src/infrastructure/live/browser.ts), which the [compatibility suite measures](../../docs/testing.md#code-a-real-browser-runs); the rest is plain logic the unit tests measure.

The checks:

- [`eslint.config.js`](eslint.config.js), which [`src/layout.test.ts`](src/layout.test.ts) checks: production code imports Playwright's types only, and only the stable `effect` package; only the front door reaches `infrastructure/live/`.
- [`tsdown.config.ts`](tsdown.config.ts) leaves `playwright-core` external: its declarations import Playwright's types, so a caller's Playwright objects and this package's are one type.

Nothing checks these:

- `leaveDialogsOpen` listens for dialogs as soon as Playwright hands the browser over, since its public API has nothing to listen on sooner: a dialog a page opens while the join is under way is dismissed by Playwright, as the compatibility suite records.
- Write a `BrowserError` message as what was found, and leave what to do about it to the caller, since the recorder's advice and a Session's differ.
- Keep starting and joining different only in how the browser is got and let go of, so one compatibility suite tests both.
- A caller lists this package under `devDependencies`, as the recorder does, so its build bundles it and the built caller imports no package of ayme's that `@ayme-dev/cli` would have to install.
- Flows are written with Effect 4; [the recorder's notes](../recorder/AGENTS.md#effect) say which documentation to use.

## The supported Playwright range

[`playwright-range.json`](playwright-range.json) beside this file states the range: the oldest Playwright ayme gets a browser with and the newest it is verified on. This package, CI's per-version job, the packed-consumer test and the recorder's sentences read it. It is not the root `playwright-range.json`, which is the published packages' `@playwright/test` range. Below the range, finding the project's Playwright fails; above it, it succeeds, and a caller may warn.

To verify a new Playwright minor, run this package's compatibility suite, the recorder's and the recorder's main end-to-end test on it, then move `lastVerified`.

## Testing

How to run tests here, and what each lane measures: [docs/testing.md](../../docs/testing.md#local-runs-and-ci).

- The unit tests drive the front door on a stand-in for the project's Playwright, a folder with a `node_modules` of its own, as the recorder's start tests do.
- [The compatibility suite](src/infrastructure/live/browser.compat.test.ts) runs real Chromium, so it runs with `pnpm test:compat` ([`vitest.compat.config.ts`](vitest.compat.config.ts)), not in `pnpm test`. It tests on the Playwright installed in the folder `AYME_PLAYWRIGHT_PROJECT` names, or else this package's own. A run counts only with its verdict line, which [`compatRunCheck.js`](../test-config/compatRunCheck.js) prints, since a reporter cannot fail a run whose tests were skipped.
