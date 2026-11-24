---
status: superseded by ADR-0016
---

# Package Vue lifecycle integration separately

The Vue example currently owns the lifecycle binding that activates a top-level Page Object and disposes it when its Vue scope ends. Keeping this binding in the example prevents Vue applications from reusing the proven integration. Moving it into the core package would make the framework-neutral runtime depend on Vue.

## Considered options

- OC1: Keep the Vue lifecycle binding private to the example.
- OC2: Export the Vue composable from `@ayme-dev/webmcp`.
- OC3: Add a separate `@ayme-dev/webmcp-vue` package.

## Decision

Add `@ayme-dev/webmcp-vue` as a workspace package intended for later publication.

Export `usePageObject` from its root entry point. The composable accepts a Page Object Model, activates one Page Object through the core runtime, returns the typed Page Object, and disposes its registration when the current Vue effect scope ends.

Update the private Vue example to consume this package. Keep its Page Object Models and experiment-specific runtime, debugging, probing, and relay behavior inside the example.

Do not publish the package in this iteration.

The package may use the core internal activation interface while Q-01 remains deferred. This does not make that interface public or settle its final design.

Do not create packages for other frameworks until their integrations are implemented and proven.

This decision complements ADR-0005. It does not supersede it.

## Consequences

The core package remains framework-neutral.

Vue lifecycle behavior has one reusable and independently testable owner.

The example becomes an end-to-end consumer of the same package shape that another Vue application could later install.

The Vue package is not ready for external publication until the public core activation interface is resolved.
