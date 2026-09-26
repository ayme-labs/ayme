---
status: accepted
---

# Keep Structural Ref continuity in the observation session's identity ledger

This ADR supersedes ADR-0012.

ADR-0012 placed best-effort continuity between Structural Refs in the Page State Session, implemented with the browser runtime's own baseline tree and alias maps. Since ADR-0027 that session records every capture in core's Structural Observation Session, which already reconciles consecutive observations, so a second reconciliation chain in the browser duplicated the work, tied continuity to one host, and could not say when a node appeared or disappeared. We decided that core's observation session keeps one identity ledger per page, derived by reconciling consecutive observations in recording order: every observed ref is an alias of an identity that follows its node across captures, removals and ambiguities are explicit unresolved states, and each identity records the Visit and the action after which it appeared or disappeared. Continuity runs across a page's same-document Visits; a Structural Ref stays capture-scoped, continuity belongs to the session.

## Considered options

- Keep the alias maps in the browser runtime: a second reconciliation chain, and no other host can share it.
- A fresh ledger per Visit: a ref taken before a same-document navigation becomes unknown after it, which drops the continuity ADR-0012 promised.
- One ledger per page in core, lifecycle scoped by Visit (chosen).

## Consequences

- Ref resolution in the browser runtime, and in any later host, reads one ledger; a Handover or an export can say when a node appeared and after which action.
- Aliases and identities live for the document's life until a retention rule exists.
- Resolution stays best effort: a structurally equivalent replacement may become the current target even though it is a different DOM object.
