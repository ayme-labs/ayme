---
status: superseded by ADR-0014
---

# Use upstream Playwright tests as the browser compatibility contract

Page Object Models use the public `Page` and `Locator` types from `@playwright/test`. The private `@ayme-dev/playwright-browser` package provides a best-effort in-page implementation through a Page factory, without ayme-owned copies of those interfaces or compatibility exports from `@ayme-dev/webmcp`.

Selected Playwright Page and Locator test files are copied unchanged from the pinned upstream source and executed through a package-local fixture. A manifest records the upstream source and copied paths, while a generated passing-test baseline makes currently compatible behavior enforceable in CI. Unsupported or incompatible behavior remains visible as ordinary upstream test failures.

The package keeps browser-runtime construction, the existing Just-in-Time InjectedScript bridge, upstream-test synchronization, the fixture harness, and compatibility reporting local. It does not maintain a separate API catalog or compile-time support selection.
