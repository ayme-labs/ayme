---
status: superseded by ADR-0028
---

# Preserve best-effort node continuity in Page State Sessions

This ADR supersedes ADR-0010.

## Context

ADR-0010 made Structural Refs capture-scoped and explicitly rejected identity across captures. Consumers now need to use refs from Structural Page State in later browser capabilities, such as highlighting an element after the page has re-rendered.

A DOM element and its current Structural Ref may change while the structurally corresponding node continues to represent the same thing to the consumer. Treating every previous ref as permanently stale makes these capabilities fragile. Treating a Structural Ref itself as globally stable would promise more than Playwright or structural reconciliation can guarantee.

## Considered options

- OC1: Keep every Structural Ref strictly capture-bound and reject it after the next capture.
- OC2: Rewrite Structural Refs so that the same public ref is preserved across captures.
- OC3: Keep Structural Refs capture-scoped while a Page State Session maintains best-effort continuity and treats previously observed refs as historical aliases.

## Decision

Choose OC3.

A Structural Ref remains capture-scoped and does not itself provide identity across captures.

One Page State Session owns the current Structural Page State for one browser document. Before resolving requested refs, the session takes a fresh capture, reconciles it against its current baseline, and advances that baseline.

When reconciliation relates a fresh node to a previous node, the session retargets its internal identity to the fresh Structural Ref and current DOM element. Every previously observed ref for that identity remains an alias. Resolving an earlier ref returns the current Structural Ref and current element.

Additions establish new session identities. Removed nodes, ambiguous matches, broken reconciliation lineages, and refs without an associated actionable DOM element resolve as unresolved.

A full document reload ends the Page State Session. Continuity across documents is not provided.

WebMCP uses this application-layer session rather than implementing independent capture or ref-resolution behavior.

## Consequences

Consumers can define ordinary browser capabilities that continue working across SPA navigation and re-rendering.

Structural Ref semantics remain honest: continuity belongs to the session, not to the ref.

Resolution is best effort and inherits the correctness limits of structural reconciliation. A structurally equivalent replacement may become the current target even though it is a different DOM object.

Historical aliases consume memory for the session lifetime.

No public durable node-ID type is introduced for the pilot.

## Validation

A real-browser test demonstrates repeated retargeting from an original ref to the current ref and DOM element.

Tests demonstrate explicit unresolved results for removals, ambiguous matches, and non-actionable refs.

Adapter tests demonstrate that WebMCP obtains Structural Page State through the same Page State Session interface.
