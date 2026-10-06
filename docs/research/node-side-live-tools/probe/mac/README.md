# Node-side liveness pilot, Mac variant (research probe, not a product test)

Companion to `../../research-node-liveness-mac.md`. It extracts the live-tools module behind a page-driver port (`isLocator`, `observeRoot`, `watch`) and adds a real-Playwright adapter, then checks liveness as a counter's root mounts, unmounts, and is covered by a modal, including the wake-up through an in-page `MutationObserver`.

- `liveTools.ts`: the module and the Playwright adapter.
- `AppPage.ts`, `AppPage.decorated.ts`: a rootless page object with a rooted counter child, undecorated for Node's type stripping and decorated for the compiler.
- `derive-manifest.ts`, `pilot.ts`, `fallback.html`: manifest derivation, the run, and the static page it ran against.

Run from `packages/ayme` with Node's native type stripping (`node pilot.ts`), not tsx or vitest (see the `__name` note in the research). The run against the live example app is still to do.
