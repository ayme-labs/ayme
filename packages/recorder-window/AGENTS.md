# Recorder window source layout

[`eslint.config.js`](eslint.config.js) says what each slice of `src/` holds, which slices each may use, and that the window reads the engine only through `@ayme-dev/recorder/contract`. `pnpm lint` refuses a misplaced import, and [`src/layout.test.ts`](src/layout.test.ts) checks that it does. The layers and what each may use are in [`horizontal-boundaries.js`](../eslint-config/horizontal-boundaries.js). [`tsdown.config.ts`](tsdown.config.ts) builds the window and the toolbar, and [`src/build.test.ts`](src/build.test.ts) checks what each built script carries.

Lint cannot see the rules below:

- Offer a control, a Discard or a highlight only while the state's `commands` lists it, since the engine owns those rules and a copy in the window would drift.
- Keep [`main.tsx`](src/app/main.tsx) and [`toolbar.tsx`](src/app/toolbar.tsx) to mounting, and put what they decide in [`mountWindow.tsx`](src/app/mountWindow.tsx) and [`toolbarMount.tsx`](src/app/toolbarMount.tsx), so the component tests can call it.

## Testing

[`vitest.config.ts`](vitest.config.ts) splits the tests into a Node project and a Chromium one. Run `pnpm build` before `pnpm test`, since [`src/build.test.ts`](src/build.test.ts) reads `dist/` and Turbo's `test` task builds only this package's dependencies.

- Design the page objects in [`testing/`](testing/index.ts) by [the page-object guidance](../../skills/shared/page-object-design.md), so ayme's own page objects follow what it asks of consumers.
- Put end-to-end tests in [`apps/recorder-fixture`](../../apps/recorder-fixture/README.md), since they drive a real recorder on the engine's scripted browser.
