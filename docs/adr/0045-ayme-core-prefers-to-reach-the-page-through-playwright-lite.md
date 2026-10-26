---
status: accepted
---

# Ayme core prefers to reach the page through Playwright Lite, so it can run outside the browser

Ayme core runs in the page today. It reaches the page and its document partly through Playwright Lite and partly directly, through the document and other browser globals. Ayme is starting to need the same behaviour in Node, against a real Playwright page: a prototype offered live Page Object Tools from Node through a page-driver port (ayme-labs/ayme#532), and the locator generator needs to run under Node Playwright as well (ayme-labs/ayme#1004). Playwright Lite matches Playwright's Page and Locator (ADR-0021), so code that reaches the page only through them runs on either: Playwright Lite in the browser, Playwright in Node. Code that holds a DOM element it found itself, or reads a browser global, runs only where Ayme shares the page's JavaScript world.

We therefore set a direction for core, which for now means `@ayme-dev/ayme`: it should be runtime-agnostic, and it should reach the page and its document only through the Page and Locator that Playwright Lite shares with Playwright. This is a preference, not a rule. A new design follows it, and a design that reaches the document or a browser global directly says why in its issue or pull request. Existing direct access stays as it is: much depends on it, and this decision sets no deadline or migration for it. Nothing enforces the preference.

We rejected enforcing it now, through lint or an allowlist of the modules still allowed direct access, because that would hold back unrelated work until the existing access is moved, a migration nobody has planned. We also rejected leaving core browser-only, because the Node uses above would then need a second implementation of the same behaviour.

The preference has costs. Reaching the page through Locators is asynchronous and indirect where reading an element is synchronous and direct. Under Node Playwright, a function evaluated in the page is serialized, so it cannot close over anything on the Node side. And Playwright Lite's package-internal entry points, such as its hit test (ADR-0041), exist only in the browser, so a design that uses them is browser-bound in the same way as one that reads the document.
