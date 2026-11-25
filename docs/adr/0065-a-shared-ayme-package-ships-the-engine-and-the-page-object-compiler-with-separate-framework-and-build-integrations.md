---
status: accepted
supersedes: ADR-0029, ADR-0050
---

# A shared ayme package ships the engine and the Page Object compiler, with separate framework and build integrations

## Why

Browser and Node consumers share ayme's structural observation engine, so the package names should reflect that common ownership while keeping framework requirements and build tooling separate.

The Page Object compiler has to match the runtime that reads its output, and it uses ayme's internal contracts, so a package of its own only adds a way for the two to drift. And `ayme mcp` compiles a project's Page Object Models itself, to serve them to a browser that runs no bundler; on that path a bundler plugin would be one more install with no bundler to plug into.

## Decision

Publish these packages:

- `@ayme-dev/ayme`: the shared engine, the main consumer library, and the Page Object compiler.
- `@ayme-dev/vue`: Vue lifecycle and Page Object integration.
- `@ayme-dev/react`: React lifecycle and Page Object integration.
- `@ayme-dev/svelte`: Svelte lifecycle and Page Object integration.
- `@ayme-dev/angular`: Angular lifecycle and Page Object integration.
- `@ayme-dev/unplugin-ayme`: bundler integration over the compiler.
- `@ayme-dev/webmcp`: WebMCP publication.
- `@ayme-dev/inspector`: the Inspector.
- `@ayme-dev/mcp`: the ayme MCP server and its page client.

The compiler sits behind a Node-only entry of `@ayme-dev/ayme`, so no browser entry carries it (ADR-0006). It runs on the project's own TypeScript, an optional peer of `@ayme-dev/ayme` that only the compiler entry imports, so a consumer that never compiles Page Object Models installs nothing for it.

Keep WebMCP publication, the Inspector and the MCP server in their own packages, as optional peers of `@ayme-dev/ayme`. Each carries dependencies the main package must not impose on every consumer.

Keep the structural observation engine as an internal workspace package, `@ayme-dev/core`, bundled into the published packages that use it, and do not publish it separately. Treat `@ayme-dev/design-system` the same way. Keep `@ayme-dev/eslint-config`, `@ayme-dev/test-config` and `@ayme-dev/typescript-config` private: they are repository tooling and ship in no package.

Keep framework integrations as separate packages, so each declares its framework requirements. Keep bundler integrations in one Unplugin package, with bundler-specific entry points. Add further integrations when they are implemented and supported.

Do not apply a blanket `ayme-` prefix within the `@ayme-dev` scope. Keep example applications private.

## Considered and rejected

- The compiler in its own package, or in the bundler integrations' package. It can drift from the runtime that reads its output, and a path without a bundler would install a bundler plugin to get it.
- TypeScript as a regular dependency of `@ayme-dev/ayme`. Every install would download it, browser-only ones included.

## Cost

A project that builds Page Object Models installs TypeScript itself, within the range the peer states. Runtime consumers depend on no bundler tooling, and on the compiler only through an entry they do not import.
