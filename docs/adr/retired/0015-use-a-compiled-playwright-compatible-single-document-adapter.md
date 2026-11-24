---
status: superseded by ADR-0018
supersedes: ADR-0014
---

# Use a compiled Playwright-compatible single-document adapter

Page Object Models use Playwright Test's public `Page` and `Locator`
interfaces. The private `@ayme-dev/playwright-browser` package provides
the in-browser implementation without defining parallel interfaces or
a separate compatibility model.

The runtime controls the current browser Window and its document.
Locators compose Playwright selector representations, while Page and
Locator coordinate browser-side operations.

The pinned Playwright InjectedScript owns selector parsing and querying,
accessibility computation, element-state and actionability checks, and
locator-expect primitives. Page and Locator own operation orchestration
and browser-side input and event behavior. Capabilities requiring a
browser process, another Page, or another document realm remain
unsupported until deliberately added.

The package ships as a self-contained compiled module. Consumers do not
configure or import InjectedScript build integration themselves.
