---
status: superseded by ADR-0030
supersedes: ADR-0008
---

# Own the Vue runtime explicitly at the application root

ADR-0008 introduced `@ayme-dev/webmcp-vue` for scope-bound Page Object registration, but left runtime initialization and WebMCP publication inside the example until their public ownership was resolved.

## Considered options

- Start the runtime implicitly when the first Page Object registers and manage its lifetime through reference counting.
- Let the Vite plugin inject runtime startup.
- Require one explicit setup call at the application root.

## Decision

Provide a public root setup API in `@ayme-dev/webmcp-vue`.

The root setup owns runtime initialization, WebMCP publication, and cleanup. `usePageObject` continues to own only the registration of one Page Object for one Vue scope.

Allow one active runtime owner for the current supported document and runtime. Reject a second owner while the first remains active. Allow a new owner after disposal. Do not use reference counting.

This explicit owner keeps application lifetime visible. Automatic startup would couple runtime lifetime to whichever component happens to register first. Vite-injected startup would hide ownership and cleanup inside the build system.

WebMCP publication is a build policy. Add one `publish` option to the Vite plugin, disabled by default. The root setup does not accept another publication flag, and the plugin does not inject lifecycle startup.

Runtime initialization remains independent of publication. Page Objects and local page-state access continue to work when publication is disabled or no browser driver is available. When publication is enabled, the root owner uses a bounded driver wait and supports an explicit retry rather than polling indefinitely.

Publication mirrors the active Generated WebMCP Tool set maintained by the core registry. It does not add another DOM observer or detection loop. ADR-0009 remains the authority for Page Object observation.

Tracing, highlighting, relay loading, and other diagnostics remain example concerns.

Disabling publication does not remove Ayme or Page Object code from browser output. Complete removal of that code from production builds remains a separate decision and must be resolved before production adoption is recommended.

## Consequences

Applications gain one explicit place to start and stop Ayme.

Nested components retain independent Page Object lifetimes without shared reference counting.

Build configuration decides whether publication is allowed. Vue lifecycle decides when the runtime exists.

This decision preserves ADR-0006’s separation of compilation, bundler transport, and runtime activation. It supersedes ADR-0008’s deferral of the public activation lifecycle while retaining its separate Vue package and `usePageObject` API.
