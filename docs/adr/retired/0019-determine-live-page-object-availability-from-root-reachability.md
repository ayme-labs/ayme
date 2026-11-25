---
status: superseded by ADR-0061, ADR-0062
---

# Determine live Page Object availability from root reachability

The rule below that availability gates structural POM associations is superseded by ADR-0020, "Separate Page Object presence from availability". Presence now controls structural inclusion and POM labels; availability controls generated tools. The remaining availability policy, ownership, non-mutating observation, and rootless behavior remain accepted.

A live Page Object is available when its root exists and represents UI that a user can currently reach through ordinary interaction. Normal scrolling may make a root reachable; hidden, collapsed/off-canvas, or obstructed roots are unavailable. DOM presence or Playwright visibility alone is insufficient.

The same availability state gates active Generated WebMCP Tools and live Page Object associations in Structural Page State. Compiled/known POM definitions remain independent of live availability.

Reachability is the contract; the probing mechanism is an implementation detail. In particular, availability is not defined as "a trial click succeeds". Observation must not click, focus, or scroll the user's page. Availability is a Page Object-level gate, not a guarantee that every individual action will succeed.

Page Objects without a root retain registration-driven availability. No new root declaration, decorator, or consumer configuration is required.

This replaces only the DOM-match availability criterion in ADR-0009. Its registry ownership, coalesced observation, change-only notifications, and disposal responsibilities remain accepted. The WebMCP layer owns Page Object Availability and reachability policy. Reachability is evaluated through the standard Playwright `Locator` interface; the browser adapter contract is not extended for this policy. Publishers and structural capture consume the registry's shared availability state.

PR #52 remains a prototype reference. Its definition inventory, page-context API, Structural Ref actions, and trial-click policy are not dependencies of this decision.
