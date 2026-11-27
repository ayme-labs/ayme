---
status: accepted
supersedes: ADR-0054
---

# An agent reads a Page Object Tool's result as a short answer, from the new page when its Host outlives a full load

## Why

A Page Object Tool answered an agent with the full action result: both parts of the Change Record, a structural diff of the whole page with element refs, and a hint at the next tool. Every call added a large block of text to the agent's context, whether it needed it or not. ayme sits next to the agent's own browser automation, which already reads the page, so the agent needs from ayme what the action did to the Page Objects, not the whole page again.

An action that starts a full page load, such as a sign-in, answered before the new document was read. The answer said the page was loading and nothing about the Page Objects, so the agent needed another call. A Host whose runtime ends with its document cannot do better, but a Session outlives the load.

## Decision

Every agent channel, WebMCP publication and a Session's `ayme` commands, presents a Page Object Tool's result as a short answer: whether the page settled, what the action returned, the URL when the action changed it, and how the Page Object Tree changed. A page whose new document is still loading has not settled; the answer has no field of its own for it.

- The change is told in the Page Object Tree: the Page Objects that appeared, in full with their ids, those that went away, and the values that changed. It is not a structural diff of the page.
- A refused call answers with its Availability Reason alone. A failed one answers with what failed and, when the Page Object Tree changed while it ran, the change in the same tree, so the agent sees how far a half-run action got. Neither carries advice, a Change Record or a pointer to a next tool. No answer lists the available tools.
- Every channel takes the Page Object Tools and their answers from one source, so the answer cannot differ between them.
- A programmatic call from application code (ADR-0031) keeps returning the full action result, which application code, the Inspector in the page and the Goal Loop read. The short answer is a presentation for agents, not a new result type.
- The answer reads the Page Object Tree once the Run has answered, after its wait for the Page Object the action returned (ADR-0067), so it shows the Page Object the action led to.
- After an action that started a full load, a Host that outlives the load reads the Page Object Tree from the new page once the Page Object the action returned is present there. It uses that read only when it is of the new document, since a presence predicate that also holds on the old page can pass before the load commits. The answer then has the new URL and how the tree changed from the page before.
- Otherwise the answer after a full load has the URL that is loading and no tree: on a Host whose runtime ends with its document, when the returned Page Object is not present by the deadline, and when the read still finds the old document. Either way the answer says the page has not settled: ayme does not wait for the load to finish.

## Considered and rejected

- Keep the Change Record and cut it shorter. Its unit is the element with its ref, which is the page again, and the refs look like the browser automation's.
- Make the short answer the result of a programmatic call. Application code, the Inspector and the Goal Loop read the full record, and what an agent reads is not a contract a developer wrote against.
- List the available tools, or point to the next one, in the answer. The tool list already carries them, and an answer that instructs the agent competes with the skill.

## Cost

An agent reading a Page Object Tool no longer learns what changed outside the Page Objects; it reads the page with its browser automation when it needs that. Each Page Object Tool call reads the Page Object Tree before and after the action. The same action answers differently after a full load depending on its Host: through WebMCP, an app that ships ayme still answers without the tree.
