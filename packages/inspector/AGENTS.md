# Inspector source layout

`src/` is cut into slices named for what they do, with layers inside each slice. [`eslint.config.js`](eslint.config.js) is the source of truth for which slices and layers each may use, and for what may read the runtime; `pnpm lint` flags a misplaced import.

Slices, from the bottom up:

- `shared`: the look at the page, rendering into the shadow root, shared UI bits.
- `panel`: the dockable panel, its preferences and its body layout.
- `navigation`: the selection, the lens contract, the run slot, the navigator and the page highlights.
- `page-model`: the Page Object tree and the Model lens.
- `structure`: the page state tree, member selection and the Structure lens.
- `runs`: running a tool, its steps and the trace, and Runs.
- `tools`: the tool list, the run card and its fields, and ref picking.
- `demo`: demo feedback on the host page; its `index.ts` is the `./demo` entry.
- `app`: the composition root: mounting, the stylesheet and the wiring of every slice.
- `testing`: the Inspector POM; its `index.ts` is the `./testing` entry.

Layers, only where a slice has that kind of code: `domain` (pure rules and types), `application` (interaction policy), `infrastructure` (the runtime, the host document, storage, the trace), `presentation` (UI-logic hooks and containers), `view` (components that take props and callbacks), `test-utils` (test-only data).

- Reach another slice through its `index.ts`.
- A component with state is three files: `useX` in `presentation/` holds the logic, `XView` in `view/` the markup, and the `X` container wires them.
- When an import runs against the slice order, move the shared part down into the lower slice.
