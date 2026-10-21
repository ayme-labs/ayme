---
status: accepted
---

# Let Ayme own live Page Object observation

The root-availability criterion below is superseded by [ADR-0019](0019-determine-live-page-object-availability-from-root-reachability.md). The sentence below that Page Object activation is not inferred from URLs is superseded by [ADR-0042](0042-page-objects-declare-their-own-root-and-presence.md). Observation ownership and lifecycle remain accepted. The original rationale is retained below.

## Context

Activated Page Objects are already tracked by the core registry. Child Page Object tool availability additionally depends on whether their roots match the current DOM.

Requiring each host application to schedule probes would duplicate lifecycle logic and could leave tool availability stale.

## Considered options

- OC1: Let host applications schedule probes.
- OC2: Let the core registry observe the DOM while Page Objects are registered.
- OC3: Let each tool publisher observe the DOM independently.

## Decision

The core registry owns one DOM observer while it contains at least one activated Page Object.

The first registration starts observation and schedules an initial probe. DOM mutations schedule coalesced probes. Only changed observations notify subscribers. The final disposal stops observation and cancels pending work.

Page-level actions are active while their Page Object is registered. Child Page Object actions are active when their root locator has at least one DOM match. Presence does not imply browser visibility.

The core owns the active Generated WebMCP Tool set. Optional publishers, including WebMCP, mirror that set. Page Object activation is not inferred from URLs.

This decision complements ADR-0006 and ADR-0008.

## Consequences

Host applications do not install Page Object probing observers.

Framework integrations only bind activation to framework lifecycle. The core remains framework-neutral.

One coalesced observer runs while the registry is non-empty.

## Validation

Automated tests confirm observer start and stop, mutation coalescing, change-only notifications, root-driven child tool availability, and WebMCP removal through registration abort signals.
