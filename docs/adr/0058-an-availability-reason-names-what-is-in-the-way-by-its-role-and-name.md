---
status: accepted
amends: ADR-0035, ADR-0039, ADR-0041, ADR-0049
---

# An Availability Reason names what is in the way by its role and name

## Why

ADR-0035 and ADR-0039 worded the runtime's Availability Reason with the Structural Ref of the element in the way, "a click would not reach it; eN is in the way", and ADR-0041 read that ref from the agent's latest page state. A coding agent now reads the page with its own browser automation, so it cannot look that ref up, and Playwright MCP numbers its own `e<n>` refs, so the same ref can name another element there. The ref was also missing until a recorded page state had shown that element.

## Decision

The runtime names what is in the way by its role and accessible name as a Playwright snapshot prints them, as `a click would not reach it; dialog "Delete" is in the way`, or by its role alone when the snapshot prints no name. The In-page Module reads them when it measures reach, so reach returns that name instead of refs, and the reason reads no page state.

- It names the first element ADR-0039 counts as in the way that it can name, nearest first: the open native modal or inert ancestor alone, else the element the click would hit and its ancestors up to the first that holds the target.
- A generic, none or presentation role names nothing. Neither does an element no snapshot shows: one in an excluded subtree or hidden from the accessibility tree, or the document element. Then the reason ends before "; … is in the way", as before.
- The role is the element's own, and the runtime still infers no kind of widget.

## Considered and rejected

- Keep the ayme ref. It suits only an agent that reads ayme's page state, which the coding agent no longer does.
- Name nothing, as "another element is in the way". The agent then has to find what the runtime already measured.
- Read the role and name from the latest recorded page state. A dialog that opened after that state was recorded would go unnamed.

## Cost

A plain `div` overlay, which a ref could name, goes unnamed. Two elements with one role and name read the same in a reason. The In-page Module computes a role and an accessible name for each element in the way it measures.

This decision amends ADR-0035 and ADR-0039, whose wording of the reason it replaces, ADR-0041, whose lookup of the ref it removes, and ADR-0049, whose reach returned refs.
