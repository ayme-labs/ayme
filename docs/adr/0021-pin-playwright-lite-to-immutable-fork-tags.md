---
status: accepted
supersedes: ADR-0018
---

# Pin Playwright Lite to immutable fork tags

ADR-0018 bundled Playwright Lite into WebMCP and required the pinned commit
to remain in Playwright Lite's main ancestry. The fork now keeps `main` as a
mirror of upstream and publishes each upstream sync as an `ayme-<date>` tag:
upstream plus the fork's patch queue. Syncs rebase the queue, so fork commits
leave `main` ancestry by design.

WebMCP consumes Playwright Lite at the exact commit of an `ayme-<date>` tag,
approves the build only for that exact archive, and bundles the result.
Packed WebMCP consumers do not install or build Playwright Lite.

A repository ruleset makes `ayme-*` and `archive/*` tags immutable. Before a
sync rewrites fork history, an `archive/*` tag keeps previously pinned
commits reachable, so older WebMCP commits still install.

Playwright Lite keeps `createPage(options)` as its root interface. Its
`./internal` entry exposes dual ARIA capture, locator recognition, and
locator-to-DOM resolution for WebMCP. Locator brands and implementation
classes remain private.

The current-document scope from ADR-0015 remains unchanged. Browser launch,
browser contexts, other document realms, and browser-process operations
remain unsupported.

Adapter changes require coordinated fork and WebMCP updates: the fork tags
first, then WebMCP repins and regenerates its lockfile and build approval.
