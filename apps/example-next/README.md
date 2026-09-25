# Next.js / Turbopack certification fixture

This certification fixture runs Ayme's POM compiler and React integration in a
Next.js 16.3.4 App Router app. Both development and production use Turbopack.
The Ayme React subtree is server-rendered, then the browser runtime activates
after hydration. It exercises the integration; it is not a consumer setup guide
or general Next.js support.

There is no `webmcp-next` package, Vite process, webpack fallback or server-side
Page Object runtime.

## Run

Start a Devbox shell at the repository root, then run:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@ayme-dev/example-next...
pnpm --filter @ayme-dev/example-next dev
```

Open http://127.0.0.1:4192. The counter supports a normal button click and a call
through `usePageObject(CounterPage)`. It can be removed and remounted.

## What changed

`@ayme-dev/unplugin-webmcp/turbopack-loader` is an experimental ESM loader using
the webpack loader calling convention supported by Turbopack. It calls the same
source transform as Vite, then transpiles the result with the package's existing
TypeScript dependency. Its only configuration option is `tsconfigPath`.

The loader reports the TypeScript configuration files and non-default-library
source files used by the POM compiler through the loader dependency API. This
lets Turbopack invalidate compiled POM metadata when cross-file types or project
configuration change. If the bundler does not provide dependency tracking, the
loader fails instead of silently serving stale metadata.

The Next config applies the loader to `.ts` files on the browser graph whose text
contains `@WebMCP` or `extends`, so an undecorated subclass of a decorated Page
Object Model reaches the compiler.
Turbopack loads the built package entry, not a source-file alias. The workspace
root is explicit so linked Ayme packages resolve. Dev and production outputs
use separate directories.

`CompiledMetadata` reads the internal registry only so E2E tests can assert the
compiler result. Consumer applications should use the public React integration,
not this fixture-only instrumentation.

The React runtime session creates its default browser page lazily. During a
server render, `usePageObject` returns an unconstructed object with the POM
prototype and does not register it. The provider can therefore render the same
UI on the server without a fake DOM or fake Playwright implementation. The
browser constructs and registers the real POM during hydration, and runtime
activation still happens in the existing effect.

## Verify

After building, with no manually started server running:

```sh
pnpm --filter @ayme-dev/example-next exec playwright install chromium
pnpm --filter @ayme-dev/webmcp test
pnpm --filter @ayme-dev/webmcp-react test
pnpm --filter @ayme-dev/unplugin-webmcp test
pnpm --filter @ayme-dev/example-next test:e2e
```

The development suite verifies server rendering, hydration, real Playwright and
POM execution, removal/remounting, and dependency invalidation of compiled
metadata. The invalidation check edits an imported POM type while `next dev`
remains running, reloads the browser, and requires the browser-visible manifest
to contain the new type metadata without restarting Next. The production suite
repeats the stable rendering and execution checks against `next start`; the
source-mutation check is development-only.

Main CI uses Turbo's affected graph to run relevant build, lint, typecheck,
test, and development and production E2E tasks. It then runs repository format
and boundary checks.

## Deliberate limits

Server rendering is presentation-only for Ayme. Page Object constructors,
locators, actions, DOM observation and WebMCP publication remain browser-only.
Rendering code must not read Page Object locator fields or execute Page Object
actions on the server. Prototype methods exist on the server placeholder so
normal event closures can reference them without running the constructor.

WebMCP publication remains disabled in the Next example. The loader does not
replace the existing `__AYME_WEBMCP_PUBLISH__` build constant. Default test-id
and timeout settings are unchanged. The next experiment is publication
configuration without Vite's `define` hook, including a stable server snapshot
when publication is enabled.

Server Component POM execution, Edge deployments, Pages Router, source-map
fidelity and packaged-consumer certification are not covered. POMs must use
`.ts` and the existing explicit `@WebMCP` convention.

React Fast Refresh is not part of the POM lifetime contract. Recompiling a POM
module replaces its class identity, while `usePageObject` deliberately requires
a fixed model for a mounted component. Reload the browser after editing POM code
or compiler-only dependencies; the development invalidation test verifies that
no Next server restart is required.

Dependency tracking follows the TypeScript program used for metadata derivation.
Because that program honors the project's configured root files, broad
`tsconfig` include patterns can make a POM depend on more files than its direct
imports. This favors correct invalidation over the smallest possible watch set.

## References

- [Turbopack rules and loader limitations](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack)
- [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Existing React integration](../../packages/webmcp-react/README.md)
- [Framework API parity decision](../../docs/adr/0017-keep-framework-integration-apis-closely-aligned.md)
