---
status: accepted
amended-by: ADR-0035
---

# Separate Page Object presence from availability

## Context

ADR-0019 uses one availability result for generated tools and structural POM associations. It cannot distinguish a collapsed off-canvas sidebar from page content blocked by a modal. Both are unavailable for interaction, but only the sidebar should disappear from Structural Page State.

## Decision

Observe Page Object presence separately from Page Object availability.

A rooted Page Object is present when its root uniquely identifies rendered UI within the current layout's normally scroll-reachable area. Hidden, detached, fully clipped, and unreachable off-canvas roots are not present. Normal below-fold content can be present without scrolling during observation.

Modal blocking, inherited inertness, and obstruction by another element do not themselves remove structural presence. They can make a present Page Object unavailable for interaction. An active modal escapes inherited inertness according to browser behavior; its own inert attribute and inert descendants still apply.

For rooted Page Objects, availability implies presence. Presence does not imply availability.

The registry owns one completed observation containing both results and the existing root element identity. Structural capture uses presence for POM labels and omits captured subtrees of known non-present POM roots. Tool publication uses availability. Ambiguous roots do not establish POM identity or tool availability; ambiguity alone must not remove arbitrary captured UI.

This supersedes only ADR-0019's rule that availability gates structural POM associations. Its interaction policy, non-mutating observation, WebMCP ownership, standard Locator interface, and separation from compiled definitions remain accepted. ADR-0009's observation lifecycle remains accepted. Rootless Page Objects retain registration-driven tool availability.

Keep this policy in WebMCP. Do not extend the browser adapter contract, introduce consumer configuration, or implement a general layout framework. The evaluate callback must be self-contained and return serializable state. Observation must not scroll, click, focus, or mutate the page.

## Consequences

A modal can remove background tools without removing background content or POM labels. A hidden sidebar loses its content, labels, and tools; reopening it makes it observable again. Refs excluded from the current structure do not resolve through that capture.

Presence filtering applies at the known POM-root composition boundary. It does not replace the underlying capture with a whole-document visibility engine. Geometric projection remains bounded and is not a simulation of application code triggered by scrolling.

## Validation

Browser regressions cover modal-blocked content and labels, reverse dialog opening order, modal inertness, hidden sidebar removal and reopening, fully clipped roots, and normally scrollable content without observation side effects. Registry and browser tests verify that continuous unrelated DOM updates do not starve capture or initial publication, and that disposal prevents old observations from publishing into a new runtime.
