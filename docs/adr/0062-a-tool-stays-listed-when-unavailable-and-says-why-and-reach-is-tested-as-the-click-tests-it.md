---
status: accepted
supersedes: ADR-0019, ADR-0035, ADR-0039, ADR-0041, ADR-0058
---

# An unavailable tool stays listed and can say why, and reach is tested as Playwright's click tests it

## Why

A present Page Object can still be out of reach: behind an open modal, under a cover, or in a state where an action makes no sense, such as removing a dashboard that is built in. When availability decided which tools were published, the app had no say. An author whose action could run only in some states could root a Page Object at the one control so its tool came and went, or keep the action where it belongs and let it throw. Either way nothing told the agent why. A tool withdrawn behind a layer looked the same as one that never existed, and a tool left listed behind one failed with a locator timeout. A Browser Tool aimed at a single element had the same problem.

## Decision

A live Page Object is available when a user could reach its root through ordinary interaction now; DOM presence or Playwright's visibility alone does not say that. Availability says whether a call would run now: it gates the Page Object and its actions, it does not promise that an action will succeed, and compiled Page Object Model definitions do not depend on it. It never adds or removes a tool: every Page Object Action of a present Page Object is listed (ADR-0067). A call to an unavailable one, or a Browser Tool call whose input would not reach its element, is refused before the blocked input or action runs, with its Availability Reason when it has one, instead of failing later on a locator timeout.

- Reach depends on the input. Pointer input needs a click to reach the element. Keyboard input needs only that the element can take focus: an open native modal it is not in, or an inert ancestor, prevents that, while an overlay or a style that stops pointer events does not, as Playwright's own fill shows. Focus follows the browser's modal rules: an active modal escapes the inertness it would inherit, while its own inert attribute and inert descendants still apply.
- Every action of a Page Object with a root needs a click to reach that root, whether or not the action itself clicks. A Page Object without a root has no root to reach: it is available while it is present.
- A click's reach is tested as Playwright's click tests it, at the point that click would use, so that what is offered matches what the click does. The In-page Module measures it (ADR-0049) with its own copy of those rules, without scrolling, waiting or input, so the two agree as far as that copy follows Playwright's. ayme's own Inspector is never in the way.
- Offering never scrolls: for an element that scrolling would show, the hit test at its click point waits for the call, while a modal it is not in or an inert ancestor still makes it unavailable. A call scrolls the page where the click point needs settling, as Playwright's click would and as no Interaction of the agent, and tests reach there; when that scroll fails, the call goes on and the error is Playwright's.
- The measurement takes no configuration from the app; an app's say is an action's predicate.
- An action may declare an availability predicate, kept at runtime beside the class. It runs read-only with the observation, never with the call, and answers that the action can run, that it cannot, or, as a string, why it cannot. An action is unavailable when the first of these fails, in this order: its Page Object is present, a click reaches its root, its predicate holds.
- An unavailable tool carries at most one Availability Reason, from one of two producers: the runtime, from what it measured, or the action's predicate, verbatim.
- The runtime names the nearest thing in the way that an agent can identify, by its role and accessible name as a Playwright snapshot prints them, such as `a click would not reach it; dialog "Delete" is in the way`, or by its role alone when the snapshot prints no name; when nothing in the way can be named so, the reason names nothing. An open native modal or an inert ancestor that blocks the element is named alone, ahead of whatever covers it. The role is the element's own: the runtime never infers a kind of widget. The In-page Module reads the role and name when it measures reach, so the reason reads no recorded page state.
- The Goal Loop's options and the Inspector's list of the elements each tool can take leave out the elements the tool's input would not reach, from one shared set. The page state the Goal Loop's model reads is unchanged: the whole page, with nothing marked. Custom Tools are not held to reach, because an app's tool may not be an interaction.
- An agent learns of availability where it already looks: the tool listing a Session gives carries every tool's availability and its reason when there is one. A tool list an agent's client caches, such as MCP's, changes only with presence: it has no field for availability, and a reason in a description would go stale in agents that cache the list.

## Considered and rejected

- A separate mark per condition. One condition often guards several actions, and a predicate wires to each.
- Lifting the predicate into the compiled metadata through the build. That metadata exists for what must be read statically, and a predicate need not be.
- A structured reason with a kind. Nothing branches on it.
- Naming the covering widget, or logic for modals and dialogs in particular. A hit test yields an element, not an intent.
- A measurement of its own for Browser Tools. The one measurement already answers the question.
- Holding keyboard input to a click's reach. It refuses fields a keyboard fills.
- Marking unreachable elements in the Goal Loop's page state. It would change what the model reads in every step.
- Keeping the locator timeout. It says nothing about why the call failed, and is slow to say it.
- ayme's own hit test, sampling several points over the part of the element a simulated scroll would show. It drifted from the click: a button covered only at Playwright's click point was offered, and the click timed out. Every case the sampler learned was one more place to drift.
- Playwright's full trial click per candidate. It scrolls the page for real and waits per element, which a pass over every candidate cannot afford.
- Hit-testing where a simulated scroll would put the element. That is the simulation whose cases kept growing.
- Naming what is in the way by its Structural Ref. A coding agent reads the page with its own browser automation, which numbers refs of the same shape for other elements, and a ref existed only once a recorded page state had shown that element.
- Naming nothing. The agent would have to find what the runtime already measured.
- Reading the role and name from the latest recorded page state. A dialog that opened after it was recorded would go unnamed.

## Cost

An element below the fold that is covered where the click will land is found at the call, not when it is offered, so a Page Object Root below the fold that only a cover blocks reads as available until a call scrolls to it. A plain overlay with no role goes unnamed, and two elements with one role and name read the same in a reason. The In-page Module computes a role and an accessible name for each element in the way. The mark on an action is no longer a no-op at runtime.
