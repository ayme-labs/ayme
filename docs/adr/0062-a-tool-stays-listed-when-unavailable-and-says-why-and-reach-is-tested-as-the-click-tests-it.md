---
status: accepted
supersedes: ADR-0019, ADR-0035, ADR-0039, ADR-0041, ADR-0058
---

# An unavailable tool stays listed and says why, and reach is tested as Playwright's click tests it

## Why

A present Page Object can still be out of reach: behind an open modal, under a cover, or in a state where an action makes no sense, such as removing a dashboard that is built in. When availability decided which tools were published, the app had no say. An author whose action could run only in some states could root a Page Object at the one control so its tool came and went, or keep the action where it belongs and let it throw. Either way nothing told the agent why. A tool withdrawn behind a layer looked the same as one that never existed, and a tool left listed behind one failed with a locator timeout. A Browser Tool aimed at a single element had the same problem.

## Decision

A live Page Object is available when a user could reach its root through ordinary interaction now; DOM presence or Playwright's visibility alone does not say that. Availability says whether a call would run now. It is a gate on the Page Object and its actions, not a promise that an action will succeed, and compiled Page Object Model definitions do not depend on it. It never adds or removes a tool: every Page Object Action of a present Page Object is listed (ADR-0061). A call to an unavailable one, or a Browser Tool call on an element its input would not reach, is refused with its Availability Reason before the action runs: at once when the element is shown now, or, when it is out of view, after the scroll described below and before any input.

- Every action of a Page Object with a root needs a click to reach that root, whether or not the action itself clicks. A Page Object without a root has no root to reach: it is available while it is present.
- Pointer input (a click, a hover, checking or unchecking, and a checkbox or radio field of a form fill) needs a click to reach the element. Keyboard input (typing, filling, selecting, and a form fill's other fields) needs only that the element can take focus: no open native modal it is not in and no inert ancestor. An active modal escapes the inertness it would inherit, as the browser lets it; its own inert attribute and inert descendants still apply. An overlay, or a style that stops pointer events, does not stop typing, as Playwright's own fill shows.
- A click's reach is tested as Playwright's click tests it, so that what is offered matches what the click does: at the one point Playwright's click would use, hit-testing as it does and retargeting as it does. The In-page Module measures it (ADR-0049) with its own copy of those rules, without scrolling, waiting or input, so the two agree as far as that copy follows Playwright's. ayme's own Inspector is never in the way.
- An element whose click point is not shown now, but would be once its scroll containers and the viewport scrolled to it, is offered without a hit test. A call that needs a click's reach, a pointer Browser Tool's on its element or any call of a rooted Page Object's tool on its root, first scrolls that element into view as Playwright's click would, which is no Interaction of the agent, then tests that one point and refuses before acting if something is in the way.
- The measurement takes no configuration from the app; an app's say is an action's predicate.
- An action may declare an availability predicate, kept at runtime beside the class. It runs read-only with the observation, never with the call, and answers either that the action can run or, as a string, why it cannot. An action is unavailable when the first of these fails, in this order: its Page Object is present, a click reaches its root, its predicate holds.
- An unavailable tool carries at most one Availability Reason, from one of two producers: the runtime, from what it measured, or the action's predicate, verbatim. A predicate may answer that the action cannot run without giving a reason.
- The runtime names what is in the way by its role and accessible name as a Playwright snapshot prints them, as `a click would not reach it; dialog "Delete" is in the way`, or by its role alone when the snapshot prints no name. It names the first element in the way that it can name, nearest first: the open native modal or the inert ancestor alone; otherwise the element the click would hit, then its ancestors up to the first that holds the target. A generic, none or presentation role names nothing, nor does an element no snapshot shows, such as one hidden from the accessibility tree, one in an excluded subtree, or the document element; the reason then ends before what is in the way. The role is the element's own: the runtime never infers a kind of widget. It names what is in the way through open shadow roots only; behind a closed one it names the host. The In-page Module reads the role and name when it measures reach, so reach returns them, not refs, and the reason reads no recorded page state.
- The Goal Loop's options and the Inspector's list of the elements each tool can take leave out the elements the tool's input would not reach, from one shared set. The page state the Goal Loop's model reads is unchanged: the whole page, with nothing marked. Custom Tools are not held to reach, because an app's tool may not be an interaction.
- An agent learns of changes where it already looks. The note `ayme mcp` adds to a tool's answer, other than a Page Object Tool's (ADR-0054), lists the tools that appeared or went away and those that became available or unavailable, with the reason; the server's own tool listing carries availability and the reason for every tool. MCP's own tool list changes only with presence: it has no field for availability, and a reason in a description would go stale in agents that cache the list.

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

An element below the fold that is covered where the click will land is found at the call, not when it is offered, so a Page Object Root below the fold reads as available until a call scrolls to it. A plain overlay with no role goes unnamed, and two elements with one role and name read the same in a reason. The In-page Module computes a role and an accessible name for each element in the way. The mark on an action is no longer a no-op at runtime.
