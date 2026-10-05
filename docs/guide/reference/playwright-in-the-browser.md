# Playwright in the browser

Which Playwright calls a Page Object Model can make when Ayme runs it inside your app.

## What runs your Page Object Model

Your Page Object Models use Playwright's own `Page` and `Locator` types, and in your app they run on [playwright-lite](https://github.com/ayme-labs/playwright-lite), an implementation of Playwright's `Page` and `Locator` that drives the current document from inside the page. `@ayme-dev/ayme` bundles it at a fixed commit, so you do not install it, and it runs the same way whichever `@playwright/test` version your project has. It does not emulate older Playwright releases.

It controls the current document only. It does not open tabs, create browser contexts, enter iframes, work across several pages, or run browser-process operations. `page.goto` and same-document navigation work; a full-document navigation replaces the document and ends the current run, so it does not return a page for the new document.

## Which calls are supported

The supported `Page` and `Locator` methods and options are the ones marked implemented in playwright-lite's [compatibility ledger](https://github.com/ayme-labs/playwright-lite/blob/cd4217e91307bb16133cd3194032686631f62af7/compatibility/api.ts), subject to the limitations it lists. Playwright's type declarations also expose operations the browser runtime does not support, so a Page Object Model that compiles may still call one that fails at run time.

## Types only

Install `@playwright/test` as a development dependency for the types; a separate `playwright` installation is not needed. Import `Page` and `Locator` with `import type`. A Page Object Model that runs in the browser must not import Playwright runtime values such as `expect` or `test`, including decorators that call `test.step`. The build plugin may remove unused imports behind local barrels, but that does not give you a browser version of Playwright Test.

Without `@playwright/test`, Ayme's public API, the build plugin's defaults and its direct settings still work; registering a Page Object Model needs its types. The supported `@playwright/test` range is on [Install](../start/install.md).

## Synthetic input

Actions run inside the page, not through a browser driven from outside:

- Input is synthetic. Its events are not trusted, so they grant no user activation.
- Hovering does not apply CSS `:hover`.
- Key presses do not move focus natively; `Tab` does not move to the next field.
