# Next.js / Turbopack certification fixture

This certification fixture runs ayme's POM compiler and React integration in a
Next.js App Router app. Both development and production use Turbopack.
The ayme React subtree is server-rendered, then the browser runtime activates
after hydration. It exercises the integration; it is not a consumer setup guide
or general Next.js support.

CI runs it on the locked Next.js 16.3 and on Next.js 16.0.0 with Node.js 20.19,
so the integration supports Next.js 16.0 and later on Node.js 20.19 or later.
Next.js 15 is not supported: it builds with webpack by default and does not
accept the Turbopack rule conditions this configuration uses.

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

`pnpm build` runs `next build` twice: the production build the Playwright suite
uses, with ayme, and `AYME_INCLUDE=false next build`, the one Build without
ayme, written to `.next-without-ayme` with browser source maps. The build
script then runs `scripts/verify-browser-output.mjs`, which checks that the
browser chunks of the build without ayme carry none of ayme's markers, that
its source maps carry no Page Object Model body, and that the build with ayme
carries the markers, so the list proves something.

## How it works

`@ayme-dev/unplugin-ayme/turbopack-loader` is an ESM loader using the webpack
loader calling convention supported by Turbopack. It calls the same source
transform as Vite, then transpiles the result with the package's existing
TypeScript dependency. Its only configuration option is `tsconfigPath`, which
here names `ayme/tsconfig.json`: the POMs are in `ayme/pom`, imported through
`#pom/*`, the alias in the `imports` of `package.json`.

The loader reports the TypeScript configuration files and non-default-library
source files used by the POM compiler through the loader dependency API. This
lets Turbopack invalidate compiled POM metadata when cross-file types or project
configuration change. If the bundler does not provide dependency tracking, the
loader fails instead of silently serving stale metadata.

The Next config applies the loader to `.ts` files on the browser graph whose text
contains `@ayme` or `extends`, so an undecorated subclass of a decorated Page
Object Model reaches the compiler.
Turbopack loads the built package entry, not a source-file alias. The workspace
root is explicit so linked ayme packages resolve. Dev and production outputs
use separate directories.

The fixture imports only the public React integration. The E2E tests observe
the compiler result and the registration lifetime through the tool schemas a
WebMCP driver fixture receives, not through ayme's internal registry.

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
pnpm --filter @ayme-dev/ayme test
pnpm --filter @ayme-dev/react test
pnpm --filter @ayme-dev/unplugin-ayme test
pnpm --filter @ayme-dev/example-next test:e2e
```

The tests are the shared [example certification](../example-certification/README.md),
run against `next dev` and against `next start` after `next build`. The app
turns the Inspector on in development; against `next dev` a smoke test opens
it and runs a tool from it, and against `next start` a test checks that the
page loads no Inspector code. An agent reaches the app through WebMCP
publication only: against both servers the certification checks that it reads
the Page Object Tree with `page_objects` and runs a Page Object Tool.

Main CI uses Turbo's affected graph to run relevant build, lint, typecheck,
test, and development and production E2E tasks. It then runs repository format
and boundary checks.

## Deliberate limits

Server rendering is presentation-only for ayme. Page Object constructors,
locators, actions, DOM observation and WebMCP publication remain browser-only.
Rendering code must not read Page Object locator fields or execute Page Object
actions on the server. Prototype methods exist on the server placeholder so
normal event closures can reference them without running the constructor.

WebMCP publication is enabled by `AymeProvider`'s `webMCP` option; the loader
sets no build constants. The initial status is `waiting` on the server and in
the browser, so the server snapshot is stable. Default test-id and timeout settings
are unchanged.

Server Component POM execution, Edge deployments, Pages Router and source-map
fidelity are not covered. The packed-consumer check in `@ayme-dev/ayme` builds
a separate Next.js app from the packed packages, with the build plugin
reference's configuration. POMs must use `.ts` and the explicit `@ayme`
convention.

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
- [React](../../docs/guide/frameworks/react.md) and [Server rendering](../../docs/guide/guides/server-rendering.md)
- [Framework API parity decision](../../docs/adr/0017-keep-framework-integration-apis-closely-aligned.md)
