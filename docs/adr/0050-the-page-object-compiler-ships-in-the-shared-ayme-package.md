---
status: accepted
amends: ADR-0029
---

# The Page Object compiler ships in the shared Ayme package

ADR-0029 put the Page Object compiler in `@ayme-dev/unplugin-ayme`, beside the bundler integrations. But `ayme mcp` now compiles a project's Page Object Models itself, to serve them to a browser that runs no bundler, and on that path a bundler plugin was one more install with no bundler to plug into. The compiler also imports Ayme's internal contracts and has to match the runtime that reads its manifests, so a separate package only added a way for the two to drift. We move the compiler into `@ayme-dev/ayme`, behind a Node-only entry, and `@ayme-dev/unplugin-ayme` keeps only bundler integration over it. The compiler runs on the project's own TypeScript, an optional peer of `@ayme-dev/ayme` that only the compiler entry imports, so no browser entry carries it (ADR-0006) and a consumer that never compiles Page Object Models installs nothing for it. We rejected a regular TypeScript dependency, which every install would download, browser-only ones included. The cost is that a project that builds Page Object Models installs TypeScript itself, within the range that peer states.

This decision amends ADR-0029.
