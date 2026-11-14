---
status: accepted
amends: ADR-0043
---

# A Page Object has an id of its own

## Why

ADR-0043 had an agent name a Page Object by the Structural Ref of its root, `e41`, read from Ayme's snapshot. Now Ayme sits next to Playwright, which prints refs of the same shape for every other element. An agent holding both can pass Playwright's `e41` where Ayme's was meant. The call then runs on whatever that ref resolves to, and nothing fails.

## Decision

A Page Object of a class with a root gets an id, `po<n>`, and its tools take that id instead of a ref.

- The page numbers Page Objects in the order it first shows them.
- An id stays with the root element while it is on the page and is never reused. An agent can keep it across calls without reading the page again.
- A malformed id is refused as wrong input. An id whose Page Object is gone fails with the reason only.
- After a full page load the old ids mean nothing, because the new document has new Page Objects.

## Where it lives

In the Page Object module of the `ayme` package, with its own type that cannot be mixed with a Structural Ref. `@ayme-dev/core` does not change. A ref stays the address of a node in one capture, and it now names elements only, for Browser Tools and Custom Tools. Ayme's own snapshot prints the id beside each root's class, and the Goal Loop and the Inspector pass it.

## Considered and rejected

- Keep the ref and explain in the description which refs to use. The failure stays silent, and an agent may ignore the description.
- Accept both for good. The wrong-element call stays possible as long as the ref is accepted.
- Put the id in core. Core addresses nodes of a single capture. An id that outlives captures and belongs to a Page Object is not that.
- List only existing ids in the schema. The schema goes stale as soon as the page changes, and would refuse an id the agent just read.

## What stays from ADR-0043

One tool per action of a class. A class without a root takes no id. Two instances on the same root element are one Page Object, with one id.

## Cost

Application code that calls a rooted Page Object Tool by ref breaks. Agents get a second kind of name to tell apart from refs.

This decision amends ADR-0043.
