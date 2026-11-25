---
status: superseded by ADR-0063
amends: ADR-0043
---

# A Page Object has an id of its own

## Why

ADR-0043 had an agent name a Page Object by the Structural Ref of its root, `e41`, read from ayme's snapshot. Now ayme sits next to Playwright, which prints refs of the same shape for every other element. An agent holding both can pass Playwright's `e41` where ayme's was meant. The call then runs on whatever that ref resolves to, and nothing fails.

## Decision

A Page Object of a class with a root gets an id, `po<n>`, and its tools take that id instead of a ref.

- The page numbers Page Objects in the order it first shows them.
- The id belongs to the Page Object: its class and its root element. Two classes rooted at one element are two Page Objects with two ids, and each class's tools take only its own.
- An id stays with its Page Object while the root element is on the page and is never reused. An agent can keep it across calls without reading the page again.
- A malformed id is refused as wrong input. An id whose Page Object is gone fails with the reason only.
- After a full page load the old ids mean nothing, because the new document has new Page Objects.

## Where it lives

In the Page Object module of the `ayme` package, with its own type that cannot be mixed with a Structural Ref. `@ayme-dev/core` does not change. A ref stays the address of a node in one capture, and it now names elements only, for Browser Tools and Custom Tools. ayme's own snapshot prints the id beside each root's class. A root of several classes lists them in its `pom` property and their ids, in the same order, in its `id` property. The Goal Loop and the Inspector pass the id.

## Considered and rejected

- Keep the ref and explain in the description which refs to use. The failure stays silent, and an agent may ignore the description.
- Accept both for good. The wrong-element call stays possible as long as the ref is accepted.
- Put the id in core. Core addresses nodes of a single capture. An id that outlives captures and belongs to a Page Object is not that.
- List only existing ids in the schema. The schema goes stale as soon as the page changes, and would refuse an id the agent just read.
- One id per root element, shared by every class rooted there. The id would not say which Page Object it names, and a tool of one class would take the id an agent read for another.

## What stays from ADR-0043

One tool per action of a class. A class without a root takes no id. Two instances on the same root element are one Page Object, with one id.

## Cost

Application code that calls a rooted Page Object Tool by ref breaks. Agents get a second kind of name to tell apart from refs.

This decision amends ADR-0043.
