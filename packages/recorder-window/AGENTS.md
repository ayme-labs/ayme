# Recorder window source layout

The checks:

- [`eslint.config.js`](eslint.config.js): what each slice of `src/` holds, which slices each may use, and the static and dynamic imports `pnpm lint` refuses; [`src/layout.test.ts`](src/layout.test.ts) checks it does.
- [`horizontal-boundaries.js`](../eslint-config/horizontal-boundaries.js): the layers and what each may use.
- [`src/build.test.ts`](src/build.test.ts): what each script [`tsdown.config.ts`](tsdown.config.ts) builds carries.

Lint cannot see the rules below:

- Reach the engine only through `@ayme-dev/recorder/contract`, and stock Playwright only from `testing/`, in a type written as `import("…")` and by a relative path too, since the window knows the engine only as its plain data; lint checks only package names in static and dynamic imports.
- Enable a control, and allow Discard, Restore and highlighting, only while the state's `commands` lists them, since the engine owns those rules and a copy in the window would drift.
- Keep [`main.tsx`](src/app/main.tsx) and [`toolbar.tsx`](src/app/toolbar.tsx) to mounting, and put what they decide in [`mountWindow.tsx`](src/app/mountWindow.tsx) and [`toolbarMount.tsx`](src/app/toolbarMount.tsx), so the component tests can call it.

## Testing

[`vitest.config.ts`](vitest.config.ts) splits the tests into a Node project and a Chromium one. Run `pnpm turbo run build --filter=@ayme-dev/recorder-window` from the repository root before `pnpm test`, which runs Vitest alone, since [`src/build.test.ts`](src/build.test.ts) reads this package's `dist/` and the browser tests need the built ayme runtime.

- In [`testing/`](testing/index.ts), follow [the page-object guide](../../skills/shared/page-object-design.md): the window a page, its parts components rooted at their element, locators and children as getters, repeated items from methods.
- Put end-to-end tests in [`apps/recorder-fixture`](../../apps/recorder-fixture/README.md), since they drive a real recorder on the engine's scripted browser.
