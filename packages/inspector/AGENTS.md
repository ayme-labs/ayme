# Inspector source layout and testing

[`eslint.config.js`](eslint.config.js) says what each slice of `src/` holds and which slices each may use. `pnpm lint` refuses an import of any kind, a type written as `import("…")` included, that skips another slice's [front door](eslint.config.js), its `index.ts`, or that takes ayme other than through `@ayme-dev/ayme/inspector` outside tests and [`testing/`](testing/index.ts). [`src/layout.test.ts`](src/layout.test.ts) checks that it does, and that every file of a layered slice but its front door sits in a layer folder. The layers and what each may use are in [`horizontal-boundaries.js`](../eslint-config/horizontal-boundaries.js).

Lint cannot see the rules below:

- In tests and [`testing/`](testing/index.ts), use ayme only through `@ayme-dev/ayme/inspector`, its public API and `@ayme-dev/ayme/internal`; lint checks ayme's entries only in production code.
- Take from another slice's front door only what your layer may use, since lint cannot see past the door to the layer it re-exports from.
- When a slice needs code from a later one, move that code down into the lower slice, since the slice order runs one way.
- Split a component with state into three files: `useX` in `presentation/` holds the logic, `XView` in `view/` the markup, and the `X` container wires them, so a component test can render the view with fixture props.
- Read the page only through the contract client in `shared`, as plain data with refs and member paths, since the same lens runs in an external window that cannot reach the page.

## Testing

The Inspector's tests drive it through its page objects in [`testing/`](testing/index.ts), which say how to register their selector engine on Playwright. Only tests may import them, which [`testing-entries.js`](../eslint-config/testing-entries.js) checks.

- Test one part of the panel as a component test: render it with [`renderPart.tsx`](testing/renderPart.tsx) and drive it through the page objects on playwright-lite.
- Write each page object to run on Playwright and on playwright-lite alike, since component tests run it on one and the end-to-end tests on the other. Drag with [`pointerDrag.ts`](testing/pom/pointerDrag.ts), which says why.
- Put end-to-end tests in [`apps/inspector-fixture`](../../apps/inspector-fixture/README.md), since its Page Objects are built by the ayme plugin, which depends on this package.
