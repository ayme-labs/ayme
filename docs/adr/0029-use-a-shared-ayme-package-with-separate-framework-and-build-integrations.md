---
status: accepted
supersedes: ADR-0005
---

# Use a shared Ayme package with separate framework and build integrations

Browser and Node consumers already share Ayme's structural observation
engine. Package names should reflect this common ownership while keeping
framework requirements and build tooling separate.

This decision supersedes ADR-0005.

## Decision

Publish these packages:

- `@ayme-dev/ayme`: shared engine and main consumer library.
- `@ayme-dev/vue`: Vue lifecycle and Page Object integration.
- `@ayme-dev/react`: React lifecycle and Page Object integration.
- `@ayme-dev/svelte`: Svelte lifecycle and Page Object integration.
- `@ayme-dev/angular`: Angular lifecycle and Page Object integration.
- `@ayme-dev/unplugin-ayme`: compiler and bundler integration.
- `@ayme-dev/webmcp`: WebMCP publication.
- `@ayme-dev/inspector`: the Inspector.
- `@ayme-dev/mcp`: the Ayme MCP server and its page client.

Keep WebMCP publication, the Inspector and the MCP server in their own
packages, as optional peers of `@ayme-dev/ayme`. Each carries dependencies
the main package must not impose on every consumer.

Keep the structural observation engine as an internal workspace package,
`@ayme-dev/core`, bundled into the published packages that use it. Do not
publish it separately. Treat `@ayme-dev/design-system` the same way. Keep
`@ayme-dev/eslint-config`, `@ayme-dev/test-config` and
`@ayme-dev/typescript-config` private; they are repository tooling and
ship in no package.

Keep framework integrations as separate packages so each declares its
framework requirements. Keep bundler integrations in one Unplugin package
with bundler-specific entry points. Add further integrations when
implemented and supported.

Do not apply a blanket `ayme-` prefix within the `@ayme-dev` scope.
Keep example applications private.

## Consequences

Runtime consumers do not depend on compiler or bundler tooling.
