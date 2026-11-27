---
status: accepted
supersedes: ADR-0061
---

# A Page Object's presence is separate from its availability, its model may declare it, and a Run waits for the presence predicate of the Page Object its action returns

## Why

One measure of whether a Page Object could be used could not tell a collapsed off-canvas sidebar from page content behind a modal. Neither can be interacted with, but only the sidebar has left the page: the content behind a modal is still there, and an agent should still read it.

And presence rested on conventions of ayme's own: a top-level Page Object was present while it was registered, and a rooted one while a member with an agreed name resolved to one element. An app that did not follow them had no way to say when a Page Object is on the page. Registering every model at setup listed every page's tools on every page, and a model whose anchor had another name failed quietly.

A Page Object Action that leads to another screen returns that screen's Page Object, but the Run answered as soon as the page settled after the action. After a sign-in, an app often shows a nearly empty page first, so the agent read a screen without Page Objects and had to call again. On a prototype, waiting for the returned Page Object's presence predicate removed those empty answers.

## Decision

Page Object Presence and Page Object Availability are separate results of one observation. Presence decides what is on the page: which Page Objects the Structural Page State marks and the Page Object Tree shows, and which Page Object Tools are listed. Availability decides whether a listed tool would run now (ADR-0062). Availability implies presence; presence does not imply availability.

- A Page Object with a Page Object Root is present while its root is one element the page renders within the area a user reaches by ordinary scrolling. A root that has left the page, such as a hidden, detached, fully clipped or collapsed off-canvas one, is absent. A root that is only below the fold, behind a modal it is not in, inert, or covered stays present, and can be unavailable. Observation simulates scrolling only as far as answering that needs, never scrolls, clicks or focuses, and leaves the page as it found it.
- A model may declare its root and its presence, each as a predicate in the mark that makes the class a Page Object Model, so an app says when its Page Objects are on the page instead of following ayme's conventions. Each predicate receives the live Page Object, runs read-only, and is inherited, nearest declaring class first, so an app writes it once on a base class of its own. Both run with the observation, and the presence predicate also while a Run waits (below); neither checks a call. Only a declared root anchors a model, not a member's name, and a Locator member that resolves to the root's element is the root, not a child.
- Without predicates, the conventions stay the defaults: a model with a root is present while its root is, a top-level model without one while it is registered, and a child with neither while the Page Object it is reached through is. With both, the root must be present and the presence predicate narrows.
- The presence predicate gates the subtree: a Page Object its presence predicate withdraws is absent with its children. A root gates only its own Page Object, so a child can still be present inside one whose root is not.
- A predicate that throws makes its Page Object absent and reports the error. Presence carries no reason: an absent Page Object's tools are listed nowhere a reason could show.
- The observation also runs on same-document navigation, so a page whose presence follows its URL follows the browser's history.
- An app can name the Page Objects of its pages in one place at setup, beside registering a Page Object in a component. A model whose presence is a component's lifetime still registers in that component.
- The Structural Page State leaves out the captured subtree of a root known not to be present. A root that resolves to several elements establishes no Page Object and no tool, and removes nothing from the capture.
- ayme's Page Object registry owns the one completed observation, with both results and the identity of each root's element. Measuring them does not extend the browser adapter's contract.
- When a Page Object Action returns a Page Object whose model declares or inherits a presence predicate, its Run waits for that predicate to hold, and for nothing else. The wait ends at the Settled Page deadline, counted from the action's return. A Page Object without a presence predicate, and any other value an action returns, get no wait. This holds for every Caller and every Host.
  - The wait changes when the Run answers, not what it answers: the Change Record is the one the action's Settled Page wait gave.
  - When the action starts a full load, a Host whose runtime ends with its document, as the browser runtime's does, answers at the load's start and does not wait, since the answer would be lost with the document. A Host that outlives the load, such as a Session, keeps the Run until the action returns, with what it returns or throws, and waits from that return.
  - ayme adds no time limit to a Run: an action's own waits are respected, and the next Run on the page starts only once the action has returned.

## Considered and rejected

- One measure for both. A modal would hide the content behind it from the agent, or a closed sidebar would stay listed.
- A whole-document visibility engine. Presence filters only at known Page Object Roots; elsewhere the capture is the page as the browser renders it, and the scroll simulation does not try to model what an app does when it is scrolled.
- A class-level availability predicate to say a page is not shown. A page the browser is not on is the collapsed sidebar, not the content behind a modal: it leaves the page state rather than staying listed with a reason.
- A route or URL helper shipped by ayme. The app's router already knows its routes.
- A wait after every action, for a load or for the page to change. Built and measured on a prototype: every eval arm got several seconds slower, and the answers did not improve.
- An action that waits for the screen it leads to. A Page Object knows itself and its own children; the screen it leads to is named only as its return value, and that screen's presence predicate already says when it is there.
- One deadline, counted from a load's start, for the action to return and the predicate to hold. A Run then ended while its action went on: the next Run could act on the page at the same time, and what the action returned or threw after the load was lost.

## Cost

A hidden sidebar loses its content, its marks and its tools until it reopens, and a Structural Ref left out of the current capture does not resolve through it. A Page Object below the fold that only a cover blocks reads as available until a call scrolls to it (ADR-0062). A Child Collection item without a root is refused: at build time where the build can prove the root is missing, at run time otherwise. A model its presence predicate withdraws costs one call per observation, since the predicate runs before the model's members are read. ayme's conventions are recommendations in the guide rather than assumptions in the runtime.

A Run whose returned Page Object never becomes present answers up to the Settled Page deadline later than before. On a Host that outlives a full load, an action that goes on waiting after the load holds its page's Runs for as long as it waits. What the page shows by the time the Run answers but did not show when it settled is not in that Run's Change Record; the Caller reads it as changes before its next action. In the browser runtime, an action that starts a full load still answers before the Page Object it returns is there.
