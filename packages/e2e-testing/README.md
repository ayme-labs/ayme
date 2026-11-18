# e2e testing

Test helpers for the suites that run through [e2e](https://e2e.com) (e2e.com) instead of Playwright's test runner. Private: only this repository's tests use it.

The Playwright suites get the same helpers from the packages' testing entries, such as `@ayme-dev/webmcp/testing` ([ADR-0026](../../docs/adr/0026-test-seams-behind-a-testing-entry.md)). Those entries are published and take Playwright's `Page`; e2e hands a test no `Page`, so the helpers that act in the page are here, written on e2e's `browser` fixture. The helpers that run in Node, such as `startAgent` from `@ayme-dev/mcp/testing`, work from e2e as they are.

- `recordPublishedTools(browser)`: installs the recording WebMCP driver in every document the test opens, as `recordPublishedTools` from `@ayme-dev/webmcp/testing` does.
- `publishedToolNames(browser)`, `publishedToolSchema(browser, name)`, `executePublishedTool(browser, name, args?)`: read and call what the page published to it.
