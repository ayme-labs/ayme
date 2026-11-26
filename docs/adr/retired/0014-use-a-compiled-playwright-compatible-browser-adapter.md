---
status: superseded by ADR-0015
supersedes: ADR-0013
---

# Use a compiled Playwright-compatible browser adapter

Page Object Models use Playwright Test's public `Page` and `Locator` interfaces. The private `@ayme-dev/playwright-browser` package provides the in-browser Page implementation without defining parallel interfaces or a separate compatibility model.

The runtime follows Playwright's architectural division: Locators compose selector representations, Page coordinates operations, and the pinned Playwright InjectedScript owns browser-side selector, accessibility, actionability, and expectation semantics.

The package ships as a self-contained compiled module. Consumers do not configure or import InjectedScript build integration themselves.
