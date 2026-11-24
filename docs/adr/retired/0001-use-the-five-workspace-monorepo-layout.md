---
status: superseded by ADR-0005
---

# Use the five-workspace monorepo layout

## Context

The open-source WebMCP library needs independently publishable core and Vite packages, a private example application, and shared tooling configuration.

## Considered options

- OC1: Create the agreed five workspaces now and add others when migration requires them.
- OC2: Start with one package and split it later.
- OC3: Create all anticipated loaders and marketplace packages now.

## Decision

Use pnpm and Turbo with apps/example-vue, packages/webmcp, packages/webmcp-vite, packages/typescript-config, and packages/eslint-config.

Only packages/webmcp and packages/webmcp-vite are public-ready; the remaining workspaces are private.

## Consequences

The two library packages can be published independently later.

The repository carries only the package boundaries needed for the first slice.

## Validation

pnpm lists exactly the five agreed workspaces, and every root check passes.
