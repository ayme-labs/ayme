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

Use these package names:

- `@ayme-dev/ayme`: shared engine and main consumer library.
- `@ayme-dev/cli`: Node CLI and recorder entry point.
- `@ayme-dev/vue`: Vue lifecycle and Page Object integration.
- `@ayme-dev/react`: React lifecycle and Page Object integration.
- `@ayme-dev/unplugin-ayme`: compiler and bundler integration.
- `@ayme-dev/inspector`: the Inspector.

Ship WebMCP publication inside `@ayme-dev/ayme` as a distinct internal
module. It has no entry point of its own; runtime setup enables it.

Keep the structural observation engine as an internal workspace package
bundled into `@ayme-dev/ayme`. Do not publish it separately.

Keep framework integrations as separate packages so each declares its
framework requirements. Keep bundler integrations in one Unplugin package
with bundler-specific entry points. Add further integrations when
implemented and supported.

Do not apply a blanket `ayme-` prefix within the `@ayme-dev` scope.
Keep example applications private.

## Consequences

Runtime consumers do not depend on compiler or bundler tooling.

The private CLI currently named `@ayme-dev/ayme` migrates to
`@ayme-dev/cli`. `@ayme-dev/core` is no longer published; its only
consumer, ayme-private, migrates separately.
