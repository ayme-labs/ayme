# Node-side liveness pilot, cloud variant (research probe, not a product test)

Companion to `../../research-node-liveness-cloud.md`. It runs the browser runtime's in-page availability callback
(`packages/ayme/src/pomReachability.ts`) from Node against a real Playwright `Page`, through playwright-lite, and
directly, and compares the three. Run with Node's native type stripping, not tsx or vitest: esbuild `keepNames`
injects a `__name` helper into the in-page callback and the probe then reports every root absent.

- `inPage.ts`: the self-contained in-page callback and `observeRootsInPage`.
- `probe.ts`: `livePageObjectTools` (manifest fold plus root probing) and its sequential variant.
- `poms.ts`, `fixture.html`, `serve.ts`: five page object classes and the static fixture they run against.
- `run-fixture.ts`, `run-app.ts`, `run-lite.ts`: the three runs (fixture, example app, playwright-lite).

The Mac pilot (page-driver port, Node `MutationObserver` wake-up) sits beside this one under `probe/`.
