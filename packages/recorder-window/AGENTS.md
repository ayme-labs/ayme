# Recorder window source layout

The Recorder's window: React with the design system, served by the engine (`packages/recorder`) from the folder of this package's built files, which the CLI hands it. It knows the engine only through `@ayme-dev/recorder/contract`, the engine's plain data, and never imports engine code. The in-page toolbar is a second build here: React with the design system in a closed shadow root, whose script the engine runs in every recorded document.

`src/` is cut into slices named for what they do, with layers inside a slice only where it needs them, as in `packages/inspector`. [`eslint.config.js`](eslint.config.js) is the source of truth for which slices each may use and what may be imported; `src/layout.test.ts` checks that lint flags a misplaced import.

Slices:

- `channel`: the window's channel to the recorder. `infrastructure` opens it over tRPC on a WebSocket at `/channel` beside the page (the mutation `send`, the subscription `updates`); `infrastructure` also holds the toolbar's channel, through the one page function the engine puts in every recorded page: it pulls the first update above the newest it heard, again and again. `domain` keeps the newest state heard and ignores an older one; `presentation` is the hook the window and the toolbar read it through.
- `timeline`: the recording as the window lists it. `domain` reads an entry's Change Tree, text in the Recording Package's compact notation, down to the roots of what changed (only the topmost marked nodes: the engine's Change Tree stays complete), and names an Interaction and its target. `view` shows each Visit with its entries; an entry's header leaves room for the controls that review it.
- `controls`: the controls and the line that says what the recorder does. Which can be pressed comes from the state's `commands`: the window repeats none of the engine's rules. `ToolbarView` is the same controls, small, for the toolbar; its buttons take no focus from the page.
- `app`: the composition root: `main.tsx` mounts the window, `window.css` is its stylesheet, `index.html` its page. `toolbar.tsx` mounts the toolbar in the top document on a host that hides from the page's structure, with a closed shadow root, and stops every input given to it at the window; `toolbar.css` is its stylesheet, adopted in the shadow root only.
- `testing`: the window's and the toolbar's page objects, the `./testing` entry (ADR-0026). Only they may name Playwright's types. The toolbar's page object reaches into its closed shadow root through a selector engine it registers itself, once its page is open: Playwright gives an engine registered earlier to no context it reaches over the DevTools protocol.

Layers: `domain` (pure rules), `application` (the ports), `infrastructure` (the network), `presentation` (hooks), `view` (components that take props).

The build (`tsdown.config.ts`) writes `dist/window/`: `index.html` and one script with React, the channel's client and the stylesheet inside, which leaves nothing to resolve where it is served. `src/build.test.ts` checks the built script carries no Node built-in, no package import and no engine code. `./window/index.html` is the export through which the CLI finds that folder. It also writes `dist/toolbar/toolbar.js`, one classic script with React, the design system and its stylesheet inside and no socket client; `./toolbar.js` is the export through which the CLI finds it. `src/build.test.ts` checks both.

## Testing

Run from this directory inside the repository's Devbox shell. `pnpm test` runs the unit tests, and reads the build: Turbo's `test` task builds first.

The window itself is tested in [`apps/recorder-fixture`](../../apps/recorder-fixture/README.md) (`tests/window.spec.ts`): the real server of a recorder on the engine's scripted browser, driven through these page objects. The toolbar is tested there too (`tests/toolbar.spec.ts`), in pages a real recorder records.
