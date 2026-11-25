---
status: accepted
supersedes: ADR-0018
---

# Pin Playwright Lite to immutable fork tags

ADR-0018 bundled Playwright Lite into ayme and required the pinned commit
to remain in Playwright Lite's main ancestry. The fork now keeps `main` as a
mirror of upstream and publishes each upstream sync as an `ayme-<date>` tag:
upstream plus the fork's patch queue. Syncs rebase the queue, so fork commits
leave `main` ancestry by design.

ayme consumes Playwright Lite at the exact commit of an `ayme-<date>` tag,
approves the build only for that exact archive, and bundles the result.
Packed ayme consumers do not install or build Playwright Lite.

A repository ruleset makes `ayme-*` and `archive/*` tags immutable. Before a
sync rewrites fork history, an `archive/*` tag keeps previously pinned
commits reachable, so older ayme commits still install.

Playwright Lite's locator brands and implementation classes remain private.

Playwright Lite drives the current document only. Browser launch, browser
contexts, other document realms and browser-process operations remain
unsupported.

Adapter changes require coordinated fork and ayme updates: the fork tags
first, then ayme repins.
