# Inspector source layout and testing

[`eslint.config.js`](eslint.config.js) says what each slice of `src/` holds, which slices each may use, and that the Inspector reads ayme only through `@ayme-dev/ayme/inspector`. `pnpm lint` refuses a misplaced import. The layers and what each may use are in [`horizontal-boundaries.js`](../eslint-config/horizontal-boundaries.js).

Lint cannot see the rules below:

- Put every file of a layered slice in a layer folder, except its `index.ts`, since lint lets a file outside one use any layer.
- Take from another slice's `index.ts` only what your layer may use, since lint cannot see past the `index.ts` to the layer it re-exports from.
- When a slice needs code from a later one, move that code down into the lower slice, since the slice order runs one way.
- Split a component with state into three files: a hook named `use<Name>` in `presentation/`, a `<Name>View` in `view/` that takes props, and a `<Name>` container in `presentation/` that wires them, so a component test can render the view with fixture props.
- Read the page only through the contract client in `shared`, as plain data with refs and member paths, since the same lens runs in an external window that cannot reach the page.

## Testing

The Inspector's tests drive it through its page objects in [`testing/`](testing/index.ts), which say how to register their selector engine on Playwright.

- Test one part of the panel as a component test: render it with [`renderPart.tsx`](testing/renderPart.tsx) and drive it through the page objects on playwright-lite.
- Write each page object to run on Playwright and on playwright-lite alike, since component tests run it on one and the end-to-end tests on the other. Drag with [`pointerDrag.ts`](testing/pom/pointerDrag.ts), which says why.
- Put end-to-end tests in [`apps/inspector-fixture`](../../apps/inspector-fixture/README.md), since its Page Objects are built by the ayme plugin, which depends on this package.
