---
status: superseded by ADR-0029
---

# Use core and Unplugin packages

The initial layout created a Vite-specific integration package. The migration now needs a client-facing core package and one build integration that supports Vite first without making Vite the permanent package boundary.

## Considered options

- OC1: Keep `@ayme-dev/webmcp-vite` as a Vite-only package.
- OC2: Publish `@ayme-dev/unplugin-webmcp` with Unplugin entry points for supported bundlers.
- OC3: Publish the build integration as exports from `@ayme-dev/webmcp`.

## Decision

Use `@ayme-dev/webmcp` for the client-facing WebMCP runtime and public POM APIs.

Replace `@ayme-dev/webmcp-vite` with `@ayme-dev/unplugin-webmcp`. Build it with Unplugin and support Vite first. Add other bundler entry points only when needed.

Keep the example application private. Keep framework lifecycle bindings inside the example until their public packaging becomes clear.

This ADR supersedes ADR-0001.

## Consequences

Runtime consumers do not depend on bundler tooling.

Bundler integrations share one package and implementation. npm download counts will not distinguish usage by bundler.

The repository does not create speculative framework or bundler packages.
