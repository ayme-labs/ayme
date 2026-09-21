# ayme

## Framework integrations

- [Vue](packages/webmcp-vue/README.md): provider setup and compatible standalone composable setup.
- [React](packages/webmcp-react/README.md): provider setup for React 19 and client-rendered Vite applications.

Both packages return Page Object instances through `usePageObject` and share
publication, retry, and runtime ownership behavior. The
[React smoke app](apps/example-react/README.md) checks the integration with one
counter; the Vue example retains its full inspector demo.

## Browser page creation

WebMCP bundles its browser controller from the exact-commit-pinned
`@ayme-dev/playwright-lite` fork. Consumers do not install the Git dependency
or build the runtime. It controls the current document, without opening a
tab or creating an isolated browser context.

Existing Vite plugin settings are passed to `createPage(options)` inside
WebMCP. Browser Page construction remains lazy for server rendering.
Page Object Models still use the standard Playwright Page and Locator types.

The Vue example owns its trace collection, action pauses, and click cues in
`apps/example-vue/src/ayme/withDemoFeedback.ts`. The wrapper preserves the
underlying locators for Ayme observation. Its pauses and advisory cues run
before the delegated action and outside that action's timeout budget.

The demo's text-entry actions explicitly use `pressSequentially(text, { delay })`.
`fill()` keeps its normal text-replacement behavior. The former `createPage`
options `pacing` and `onTrace`, and the browser package's demo-specific types,
are no longer supported.
Start with the [core package README](packages/webmcp/README.md) for consumer setup.

## Coding agent skill

> Install the `ayme` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme into this project's skill directory, including its references. Then use it to set up Ayme WebMCP here.

## Playwright compatibility

For Page Object Models, install `@playwright/test` as a development dependency.
A separate direct installation of `playwright` is unnecessary. Import `Page`
and `Locator` with `import type`.

`@ayme-dev/webmcp` and `@ayme-dev/webmcp-vue` declare an optional
`@playwright/test` peer of `>=1.29 <1.63`. Playwright is unnecessary for the
core public API and plugin defaults or direct settings. POM registration types
require it. Packed consumer checks exercise 1.29.1 with TypeScript 5.9.3 and
1.62.1 with TypeScript 6.0.3, with strict declaration checking and no
`skipLibCheck`. Playwright 1.29's own declarations use syntax rejected by
TypeScript 6, so that combination is not supported. Versions 1.63 and later
require compatibility review.

Compatibility covers the methods and options marked implemented in the
[existing compatibility ledger](https://github.com/ayme-labs/playwright-lite/blob/8adaf9aac567570423379f87d2d412171baecd98/compatibility/api.ts),
subject to its limitations. The full Playwright `Page` and `Locator` declarations
also expose unsupported operations; successful TypeScript compilation does not
establish runtime support. Browser-executed POMs must not import Playwright runtime
values such as `expect`; unused imports behind local barrels may be removed by
the plugin, but this does not provide a browser version of Playwright Test.

An older consumer's declarations need not expose newer supported capabilities:

| Capability                                       | First Playwright declaration |
| ------------------------------------------------ | ---------------------------- |
| `Locator.all`                                    | 1.29                         |
| `Locator.or`, negative locator filters           | 1.33                         |
| `Locator.and`                                    | 1.34                         |
| `Locator.pressSequentially`                      | 1.38                         |
| `Locator.ariaSnapshot`                           | 1.49                         |
| `Locator.filter({ visible })`                    | 1.51                         |
| `Locator.describe`                               | 1.53                         |
| `Locator.description`                            | 1.57                         |
| `Page.ariaSnapshot`, snapshot `mode` and `depth` | 1.59                         |
| Snapshot `boxes`, role `description`             | 1.60                         |
| Query and snapshot `signal`                      | 1.62                         |

These dates follow [Playwright's release history](https://playwright.dev/docs/release-notes).
The 1.29 minimum includes `Locator.all` and the `selectOption(string)` behavior
that matches either an option value or label. Ayme always executes its bundled
adapter from the fixed runtime source pin, regardless of the consumer's installed
Playwright version. It does not emulate historical releases. The current-document
boundary excludes iframe traversal, multiple pages, and browser-process operations.
The runtime's reviewed tests remain separate from the consumer declaration checks.

The optional config loader has a narrower requirement described below. The plugin
does not declare that requirement as a package-wide peer because it applies only
when `playwright.config` is supplied; it validates the consumer's resolved
Playwright version at that point.

## Playwright settings

The Vite plugin accepts the small part of Playwright configuration that the
Ayme browser adapter uses:

```ts
aymeWebMcp({
  playwright: {
    config: "./playwright.config.ts",
    project: "chromium",
    use: {
      testIdAttribute: "data-testid",
      actionTimeout: 10_000,
      navigationTimeout: 30_000,
    },
  },
});
```

`config` is optional. When it is omitted, Ayme does not search for a
Playwright config and does not import Playwright's config loader. The supported
values come from the explicit `use` overrides and the adapter defaults.
Relative config paths resolve against Vite's root. Absolute paths work too.
Consumers that relied on the old automatic discovery must now pass their
config path explicitly.

If a config is supplied, Ayme loads the consumer's Playwright 1.62.x config
loader through the matching `playwright` dependency of `@playwright/test`.
That loader is a private Playwright module, so other versions and
loader shapes fail with an explicit compatibility error. Ayme reads only
`testIdAttribute`, `actionTimeout`, and `navigationTimeout`; no other config
field enters the browser bundle.

Without `project`, a config with no projects uses its top-level `use` values, a
single project is selected automatically, and multiple projects must agree on
all three supported values. If they do not, set `project` to a project name.
That name must identify exactly one project.

Each supported field resolves independently. Explicit `use` overrides win over
the selected project, then the top-level config, then the adapter runtime
default. The adapter defaults are 1,000 ms for actions and 30,000 ms for
navigation. An `undefined` value does not erase an inherited value. Action and
navigation defaults are applied to the page returned by `createPage`, which is
the page used by POM and ref actions. Per-call timeout options and later
`setDefaultTimeout` or `setDefaultNavigationTimeout` calls still win, and `0`
means no timeout. If navigation has no separate value, it inherits the general
action timeout.

The adapter supports same-document navigation and full-document navigation via
`page.goto`. A full-document navigation replaces the controlled document and
ends the current browser execution; it does not return a destination page to
the old execution.

## License

Ayme is [Fair Source](https://fair.io), licensed under the
[Functional Source License, Version 1.1, ALv2 Future License](LICENSE)
(FSL-1.1-ALv2). You may use, modify, and redistribute it for any purpose other
than a Competing Use, including in your own applications and products. Each
version becomes available under the Apache License 2.0 two years after its
release.

Bundled third-party code keeps its original license; see each package's
`THIRD_PARTY_NOTICES.txt`.
