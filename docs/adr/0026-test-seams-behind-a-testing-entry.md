---
status: accepted
---

# Test seams live behind a package's testing entry

Some packages hold code that only tests may use: fakes for a seam the product depends on, such as a recording WebMCP driver installed into a Playwright page, or mock factories for structural trees. We decided that a package exposes these from a second entry, `testing` (`@ayme-dev/<package>/testing`, built from `src/testing.ts`), next to its main entry. The seam stays inside the package; only `testing` exports it and the main entry never does. Only test files (`*.test.ts`, `*.test.tsx`, `*.browser.test.ts`, anything under a `tests/` directory) and a package's own package-verification scripts may import a `testing` entry, whether as `@ayme-dev/<package>/testing` from another workspace or as the relative `./testing` inside the package. A lint policy in `@ayme-dev/eslint-config`, written as import-path restrictions on ESLint's built-in rules so it needs no new plugin and cannot collide with other uses of them, enforces this in every package and app, so a test-only export never reaches a package's public surface and misuse is caught by lint rather than remembered.

## Considered options

- Keep test doubles beside the tests that use them, copied per app. This is what the example apps did with the recording WebMCP driver: three copies with "keep in step" headers, one already drifting, and nothing a consumer testing their own integration could import.
- A private, unpublished workspace package for shared test support. It de-duplicates without touching product packages, but a package whose whole content is one fixture, and consumers get nothing.
- A `testing` entry per package, enforced by lint. The double lives with the seam it fakes, consumers can use it, and the boundary is checked, not remembered. `@ayme-dev/core` already had such an entry, unenforced.

## Consequences

- `@ayme-dev/core/structural-observation/testing` stays and comes under the policy; `@ayme-dev/webmcp/testing` is created and receives the recording WebMCP driver and its queries, which the example apps import.
- A `testing` entry may depend on test tooling types (for example Playwright's) as development dependencies; the main entry may not.
- `turbo boundaries` continues to govern which packages may depend on which; this policy governs which files may import a `testing` entry.
