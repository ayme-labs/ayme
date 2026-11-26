---
status: deprecated
---

# Enforce dependency direction with Turbo Boundaries

## Context

The monorepo needs lightweight enforcement of the agreed dependency direction.

## Considered options

- OC1: Use the built-in experimental Turbo Boundaries feature.
- OC2: Add custom ESLint or Nx-style boundary tooling.
- OC3: Leave dependency direction unenforced.

## Decision

Tag tooling, core, adapter, and app workspaces and configure Turbo Boundaries rules.

Tooling cannot depend on core, adapter, or app workspaces; core cannot depend on adapter or app workspaces; adapter cannot depend on app workspaces; app may depend on core and adapter workspaces.

## Consequences

The repository uses an experimental Turbo feature whose configuration may evolve.

## Validation

turbo boundaries passes, and configuration review confirms the intended rules.
