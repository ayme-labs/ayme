---
status: accepted
---

# Let ayme own live Page Object observation

## Context

Which Page Objects are on the page, and which of their tools would run, follows the page as it changes. Requiring each host application to schedule probes would duplicate lifecycle logic and could leave the published tools stale.

## Considered options

- OC1: Let host applications schedule probes.
- OC2: Let ayme's Page Object registry observe the page while Page Objects are registered.
- OC3: Let each tool publisher observe the page independently.

## Decision

ayme's Page Object registry owns one observation of the page while it contains at least one registered Page Object.

The first registration starts observation and schedules an initial probe. Changes to the page schedule coalesced probes. Only changed observations notify subscribers. The final disposal stops observation and cancels pending work.

What a probe measures, Page Object Presence and Page Object Availability, is decided in ADR-0067 and ADR-0062.

ayme owns the set of Page Object Tools. Optional publishers, WebMCP publication among them, mirror that set and add no observer of their own.

## Consequences

Host applications install no observer for Page Objects.

Framework integrations only bind registration to the framework's lifecycle. Observation stays framework-neutral.

One coalesced observation runs while the registry is non-empty.
