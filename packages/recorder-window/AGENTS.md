# Recorder window source layout

The checks:

- [`eslint.config.js`](eslint.config.js): what each slice of `src/` holds, which slices each may use, and the imports of any kind `pnpm lint` refuses, among them the engine other than through `@ayme-dev/recorder/contract`, and stock Playwright outside [`testing/`](testing/index.ts), by package name or relative path; [`src/layout.test.ts`](src/layout.test.ts) checks it does.
- [`horizontal-boundaries.js`](../eslint-config/horizontal-boundaries.js): the layers and what each may use.
- [`src/build.test.ts`](src/build.test.ts): what each script [`tsdown.config.ts`](tsdown.config.ts) builds carries.

Lint cannot see the rules below:

- Enable a control, and allow Discard, Restore and highlighting, only while the state's `commands` lists them, since the engine owns those rules and a copy in the window would drift.
- Keep [`main.tsx`](src/app/main.tsx) and [`toolbar.tsx`](src/app/toolbar.tsx) to mounting, and put what they decide in [`mountWindow.tsx`](src/app/mountWindow.tsx) and [`toolbarMount.tsx`](src/app/toolbarMount.tsx), so the component tests can call it.

## Testing

[`vitest.config.ts`](vitest.config.ts) splits the tests into a Node project and a Chromium one. Run `pnpm turbo run build --filter=@ayme-dev/recorder-window` from the repository root before `pnpm test`, which runs Vitest alone, since [`src/build.test.ts`](src/build.test.ts) reads this package's `dist/` and the browser tests need the built ayme runtime.

- In [`testing/`](testing/index.ts), make the window a page, each of its parts a component rooted at its element, and get repeated items from methods, so each component scopes its locators to the UI it owns.
- Put end-to-end tests in [`apps/recorder-fixture`](../../apps/recorder-fixture/README.md), since they drive a real recorder on the engine's scripted browser.
