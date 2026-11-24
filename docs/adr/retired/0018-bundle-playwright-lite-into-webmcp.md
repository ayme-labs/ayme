---
status: superseded by ADR-0021
supersedes: ADR-0015
---

# Bundle Playwright Lite into WebMCP

ADR-0015 placed the single-document browser adapter in the private
`@ayme-dev/playwright-browser` workspace package. The adapter and its
compatibility evidence now live in the private, unpublished
`@ayme-dev/playwright-lite` repository.

WebMCP consumes Playwright Lite at an exact Git commit, approves the build
only for that exact archive, and bundles the result. Packed WebMCP consumers
do not install or build Playwright Lite.

Playwright Lite keeps `createPage(options)` as its root interface. Its
`./internal` entry exposes dual ARIA capture, locator recognition, and
locator-to-DOM resolution for WebMCP. Locator brands and implementation
classes remain private.

The current-document scope from ADR-0015 remains unchanged. Browser launch,
browser contexts, other document realms, and browser-process operations
remain unsupported.

The pinned commit must remain in Playwright Lite's main ancestry. Otherwise
WebMCP must repin and regenerate its lockfile and build approval.

This removes the workspace adapter and its duplicate compatibility machinery.
Adapter changes now require coordinated fork and WebMCP updates, with the
fork merged first.
