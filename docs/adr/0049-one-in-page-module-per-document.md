---
status: accepted
supersedes: ADR-0045
---

# One In-page Module per document

## Why

ayme needs the same behaviour in Node, against a real Playwright page, as in the browser: to offer Page Object Tools from a Node Host, and to generate locators under Node Playwright. Playwright Lite matches Playwright's Page and Locator (ADR-0021), so code that reaches the page only through them runs on either. Code that holds a DOM element it found itself, or reads a browser global, runs only where ayme shares the page's JavaScript world.

ayme reached the page partly through Playwright Lite and partly directly, held DOM elements across its own module boundaries, and keyed its session by the document. A preference for Page and Locator that nothing enforced left all of that in place. And two copies of ayme's capture code on one document handed the same ref to different elements and locked the page's own runtime out.

## Decision

The ayme package holds no DOM node, and it reaches a document only through Playwright's Page and one In-page Module.

- No DOM node crosses a module boundary. A target is a Locator or a Structural Ref, and no element handle is held.
- Each document has one In-page Module: the first Host installs it, every later Host binds to it, and a Host of another version is refused. It owns capture, the root probe, the watchers, the Settled Page wait, the predicates, locator generation and pick. History, Visits and cursors stay on the Host.
- Every ref is minted in the module, synthetic root refs included, so no two Hosts ever name two elements with one ref.
- The module is one self-contained function evaluated in the page, and each Host hears it through one binding of its own.
- Runtime state is keyed by Page, and no code outside the module uses the document or the browser's globals. Lint keeps them out of the In-page Module's Host side and out of every slice's domain and application layers; browser infrastructure that still reads them directly is an exception to remove, not a second way to the document. Reach is measured in the page and returns whether the element is present and available and, when something is in the way, its role and name, not refs (ADR-0062).
- ayme's capture stays ayme's: its marks are private, and refs resolve only through ayme's own selector engine (ADR-0038) on both runtimes. Playwright Lite's own snapshot and its refs are never used, and no production code imports Playwright Lite's internal entry, which exists only in the browser and is not Playwright's API. Stock Playwright snapshots in its own world and shares nothing with ayme, which we accept.
- A filter, such as what a capture ignores or which elements a Custom Tool applies to, is a CSS selector, which the module matches at each capture, or a function from the session's Page to a Locator, which the Host matches before each capture. No filter code is sent to the page.
- The Inspector is a client over one plain-data contract, the runtime's front door, with two transports: direct in the page, and a channel outside it. Inline, it is a lazy part of the app's own bundle, so whatever serves the app serves it. Out of the page, the ayme MCP server serves it and relays its contract over the Agent Connection it already holds; there is no new server.
- Highlight is Playwright's locator highlight with ayme's style, and the activity watcher ignores the overlay it adds. Pick is the module's. The runtime knows no client by name: one generic mark keeps a subtree out of the capture.

## Considered and rejected

- Leaving ayme browser-only. The Node uses would need a second implementation of the same behaviour.
- A preference that nothing enforces. Direct access stayed wherever it already was, and two copies of the capture code could still meet on one document.

## Cost

Reaching the page through Locators is asynchronous and indirect where reading an element is synchronous and direct: every probe is asynchronous, the browser pays nothing new, and Node pays one evaluation per read. Under Node Playwright a function evaluated in the page is serialized, so it cannot close over anything on the Node side. A filter cannot be a predicate over an element. The browser bundle carries Playwright Lite's snapshot code twice until the module's copy is slimmed.
