---
status: accepted
supersedes: ADR-0065
---

# A shared ayme package ships the engine and the Page Object compiler, and one package ships the `ayme` command

## Why

Browser and Node consumers share ayme's structural observation engine, so the package names should reflect that common ownership while keeping framework requirements and build tooling separate.

The Page Object compiler has to match the runtime that reads its output, and it uses ayme's internal contracts, so a package of its own only adds a way for the two to drift. And a Session compiles a project's Page Object Models itself, for Node, where no bundler runs; on that path a bundler plugin would be one more install with nothing to plug into.

A developer installs one package and gets one `ayme` command, so they never have to learn which package provides which subcommand.

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
- `@ayme-dev/cli`: the `ayme` command, which holds ayme capture, the Session's commands, `ayme inspect` and `ayme mcp`. It is a command and nothing else: it exports no library.

The compiler sits behind a Node-only entry of `@ayme-dev/ayme`, so no browser entry carries it (ADR-0006). It runs on the project's own TypeScript, an optional peer of `@ayme-dev/ayme` that only the compiler entry imports, so a consumer that never compiles Page Object Models installs nothing for it. TypeScript 7's package has no JavaScript compiler API, so with TypeScript 7 the compiler runs on `@typescript/typescript6`, Microsoft's compatibility package and a second optional peer.

Keep WebMCP publication and the Inspector in their own packages, as optional peers of `@ayme-dev/ayme`. Each carries dependencies the main package must not impose on every consumer.

Keep the structural observation engine as an internal workspace package, `@ayme-dev/core`, bundled into the published packages that use it, and do not publish it separately. Treat `@ayme-dev/design-system` the same way. Keep the Session (`@ayme-dev/session`), the recorder (`@ayme-dev/recorder`), its window (`@ayme-dev/recorder-window`) and the code that finds the project's Playwright and starts or joins a browser (`@ayme-dev/browser`) private too, bundled into `@ayme-dev/cli`: a developer reaches them only through the command. Keep `@ayme-dev/eslint-config`, `@ayme-dev/test-config` and `@ayme-dev/typescript-config` private: they are repository tooling and ship in no package.

Keep framework integrations as separate packages, so each declares its framework requirements. Keep bundler integrations in one Unplugin package, with bundler-specific entry points. Add further integrations when they are implemented and supported.

Do not apply a blanket `ayme-` prefix within the `@ayme-dev` scope. Keep example applications private.

`@ayme-dev/mcp`, the ayme MCP server and its page client, is no longer published: what it served went with the Agent Connection (ADR-0074).

## Considered and rejected

- The compiler in a package of its own. That only adds a way for it to drift from the runtime that reads its output.
- The compiler in the bundler integrations' package. A Session compiles Page Object Models in Node, where no bundler runs, and on that path a bundler plugin would be one more install with nothing to plug into.
- TypeScript as a regular dependency of `@ayme-dev/ayme`. Every install would download it, browser-only ones included.
- `@ayme-dev/mcp`'s library entries moved into `@ayme-dev/cli`. What they served is gone.

## Cost

A project that builds Page Object Models installs TypeScript itself, within the range the peer states, and with TypeScript 7 also `@typescript/typescript6`. Runtime consumers do not depend on compiler or bundler tooling: the compiler is an entry of the shared package that they do not import, and TypeScript is an optional peer. `@ayme-dev/cli` carries the Session and the recorder together, so a developer who uses only one of them installs both.
