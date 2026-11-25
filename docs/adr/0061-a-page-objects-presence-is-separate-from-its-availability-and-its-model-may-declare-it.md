---
status: accepted
supersedes: ADR-0019, ADR-0020, ADR-0042
---

# A Page Object's presence is separate from its availability, and its model may declare its root and its presence

## Why

One measure of whether a Page Object could be used could not tell a collapsed off-canvas sidebar from page content behind a modal. Neither can be interacted with, but only the sidebar has left the page: the content behind a modal is still there, and an agent should still read it.

And presence rested on conventions of ayme's own: a top-level Page Object was present while it was registered, and a rooted one while a member with an agreed name resolved to one element. An app that did not follow them had no way to say when a Page Object is on the page. Registering every model at setup listed every page's tools on every page, and a model whose anchor had another name failed quietly.

## Decision

Page Object Presence and Page Object Availability are measured separately, in one observation. Presence decides what is on the page: which Page Objects the Structural Page State marks and the Page Object Tree shows, and which Page Object Tools are listed. Availability decides whether a listed tool would run now (ADR-0062). Availability implies presence; presence does not imply availability. ayme's Page Object registry owns the one completed observation, which holds both results and the identity of each root's element, and measuring them does not extend the browser adapter's contract.

- A Page Object with a Page Object Root is present when its root resolves to one rendered element within the layout's normally scroll-reachable area. Content below the fold, or scrolled out of its container, is present when scrolling its containers and the viewport would show it; ayme simulates scrolling only as far as answers that. A root that is hidden, detached, not displayed, without a box, fully clipped by overflow, or off-canvas where no scroll reaches is not present: a root with some area left visible is present.
- An open native modal the root is not in, an inert ancestor, or another element covering the root does not remove presence. Each can make the Page Object unavailable.
- A model may declare its root and its presence, each as a predicate in the mark that makes the class a Page Object Model. Each predicate receives the live Page Object, runs read-only with the observation and never with a call, and is inherited: the nearest declaring class wins, so an app writes each once on a base class of its own. Only a declared root anchors a model; a member's name does not, and a Locator member that resolves to the root's element is the root and is left out of the listed children.
- Without predicates, a model with a root is present while the root resolves as above, a top-level model without one while it is registered, and a single child with neither while the Page Object it is reached through is present. With both, the root must resolve and the presence predicate narrows.
- The presence predicate is evaluated before the model's members are read, so an absent model costs one call per observation. A predicate that withdraws a Page Object stops the walk at it: its root is not read and its children are absent with it. A root that does not resolve does not stop the walk, so a child can be present inside a Page Object that is not: a child without a root whose own presence predicate holds is present while its parent's root is absent.
- A root or presence predicate that throws makes the Page Object absent and reports the error. Presence carries no reason: an absent Page Object's tools are listed nowhere a reason could show.
- The observation also runs on same-document navigation, so a page whose presence follows its URL follows the browser's history.
- An app can name the Page Objects of its pages in one place at setup, beside registering a Page Object in a component. A model whose presence is a component's lifetime still registers in that component.
- The Structural Page State leaves out the captured subtree of a Page Object Root known not to be present. A root that resolves to several elements establishes no Page Object and no tool, and removes nothing from the capture.
- Observing presence, like observing availability, never scrolls, clicks, focuses or changes the page.

## Considered and rejected

- One measure for both. A modal would hide the content behind it from the agent, or a closed sidebar would stay listed.
- A whole-document visibility engine. Presence filters only at known Page Object Roots; elsewhere the capture is the page as the browser renders it, and the scroll simulation does not try to model what an app does when it is scrolled.
- A class-level availability predicate to say a page is not shown. A page the browser is not on is the collapsed sidebar, not the content behind a modal: it leaves the page state rather than staying listed with a reason.
- A route or URL helper shipped by ayme. The app's router already knows its routes.

## Cost

A hidden sidebar loses its content, its marks and its tools until it reopens, and a Structural Ref left out of the current capture does not resolve through it. A Page Object below the fold reads as available until a call scrolls to it (ADR-0062). A Child Collection item without a root is refused: by the build when the options are written inline, at runtime otherwise. ayme's conventions are recommendations in the guide rather than assumptions in the runtime.
