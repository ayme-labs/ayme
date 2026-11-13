# Recorder window source layout

The Recorder's window: React with the design system, served by the engine (`packages/recorder`) from the folder of this package's built files, which the CLI hands it. It knows the engine only through `@ayme-dev/recorder/contract`, the engine's plain data, and never imports engine code. The in-page toolbar will be a second build here.

`src/` is cut into slices named for what they do, with layers inside a slice only where it needs them, as in `packages/inspector`. [`eslint.config.js`](eslint.config.js) is the source of truth for which slices each may use and what may be imported; `src/layout.test.ts` checks that lint flags a misplaced import.

Slices:

- `channel`: the window's channel to the recorder. `infrastructure` opens it over tRPC on a WebSocket at `/channel` beside the page (the mutation `send`, the subscription `updates`); `domain` keeps the newest state heard and ignores an older one; `presentation` is the hook the window reads it through.
- `timeline`: the recording as the window lists it. `domain` reads an entry's Change Tree, text in the Recording Package's compact notation, down to the roots of what changed (only the topmost marked nodes: the engine's Change Tree stays complete), and names an Interaction and its target. `view` shows each Visit with its entries. An entry's header has the control that discards it, or restores it when it is discarded: dimmed, with its changes hidden. Each shows only while the state's `commands` lists it, and names the entry by its `id`.
- `controls`: the controls and the line that says what the recorder does. Which can be pressed comes from the state's `commands`: the window repeats none of the engine's rules.
- `app`: the composition root: `main.tsx` mounts the window, `window.css` is its stylesheet, `index.html` its page.
- `testing`: the window's page objects, the `./testing` entry (ADR-0026). Only they may name Playwright's types.

Layers: `domain` (pure rules), `application` (the ports), `infrastructure` (the network), `presentation` (hooks), `view` (components that take props).

The build (`tsdown.config.ts`) writes `dist/window/`: `index.html` and one script with React, the channel's client and the stylesheet inside, which leaves nothing to resolve where it is served. `src/build.test.ts` checks the built script carries no Node built-in, no package import and no engine code. `./window/index.html` is the export through which the CLI finds that folder.

## Testing

Run from this directory inside the repository's Devbox shell. `pnpm test` runs the unit tests, and reads the build: Turbo's `test` task builds first.

The window itself is tested in [`apps/recorder-fixture`](../../apps/recorder-fixture/README.md) (`tests/window.spec.ts`): the real server of a recorder on the engine's scripted browser, driven through these page objects.
