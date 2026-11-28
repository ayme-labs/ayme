---
status: accepted
supersedes: ADR-0065
---

# A shared ayme package ships the engine and the Page Object compiler, and one package ships the `ayme` command

## Why

Browser and Node consumers share ayme's structural observation engine, so the package names should reflect that common ownership while keeping framework requirements and build tooling separate.

The Page Object compiler has to match the runtime that reads its output, and it uses ayme's internal contracts, so a package of its own only adds a way for the two to drift. A Session compiles a project's Page Object Models itself, for Node, and needs no bundler integration in the developer's project.

A developer installs one package and gets one `ayme` command, so they never have to learn which package provides which subcommand.

## Decision

- `@ayme-dev/ayme` is the shared package: the engine, the main consumer library and the Page Object compiler. The compiler sits behind an entry that no browser entry carries (ADR-0006), and runs on the project's own TypeScript, an optional peer, so a consumer that never compiles Page Object Models installs nothing for it.
- Each framework integration is a package of its own, so it declares its framework's requirements. The bundler integrations are one Unplugin package, with an entry per bundler. Further integrations are added when they are implemented and supported.
- WebMCP publication and the Inspector stay in packages of their own, as optional peers of `@ayme-dev/ayme`: each carries dependencies the main package must not impose on every consumer.
- `@ayme-dev/cli` ships the `ayme` command, for ayme capture and ayme inspect alike, and nothing else: it exports no library.
- The structural observation engine and the design system stay internal packages, bundled into the published packages that use them. The Session, the Recorder and the code that finds the project's Playwright and starts or joins a browser stay private too, bundled into `@ayme-dev/cli`: a developer reaches them only through the command. Repository tooling ships in no package.
- `@ayme-dev/mcp`, the ayme MCP server and its page client, is no longer published: what it served went with the Agent Connection (ADR-0074).
- Package names within the `@ayme-dev` scope carry no blanket `ayme-` prefix, and example applications stay private.

## Considered and rejected

- The compiler in a package of its own. That only adds a way for it to drift from the runtime that reads its output.
- The compiler in the bundler integrations' package. A Session compiles Page Object Models with no bundler integration, and there a bundler plugin would be one more install with nothing to plug into.
- TypeScript as a regular dependency of `@ayme-dev/ayme`. Every install would download it, browser-only ones included.
- `@ayme-dev/mcp`'s library entries moved into `@ayme-dev/cli`. What they served is gone.

## Cost

A project that builds Page Object Models installs TypeScript itself, in a version the compiler can run on. Runtime consumers do not depend on compiler or bundler tooling: the compiler is an entry of the shared package that they do not import, and TypeScript is an optional peer. `@ayme-dev/cli` carries the Session and the Recorder together, so a developer who uses only one of them installs both.
