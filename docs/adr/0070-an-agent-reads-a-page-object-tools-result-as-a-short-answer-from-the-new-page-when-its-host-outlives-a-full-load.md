---
status: accepted
supersedes: ADR-0068
---

# An agent reads a Page Object Tool's result as a short answer, from the new page when its Host outlives a full load

## Why

A Page Object Tool answered an agent with the full action result: both parts of the Change Record, a structural diff of the whole page with element refs, a hint at the next tool, and, through `ayme mcp`, a note of the tools that appeared, went away or changed availability. Every call added a large block of text to the agent's context, whether it needed them or not. ayme now sits next to the agent's own browser automation, which already reads the page, so the agent needs from ayme what the action did to the Page Objects, not the whole page again.

An action that starts a full page load, such as a sign-in, left the agent without that. The answer came before the new document was read, so it said the page was loading and nothing about the Page Objects, and the agent needed another call. A Host whose runtime ends with its document cannot do better. A Session runs in Node and outlives the load. On a prototype, answering from the new page once the Page Object the action returned was present there, and not only waiting for it, is what removed the empty answers after a sign-in.

## Decision

Every agent channel, WebMCP publication, `ayme mcp` and a Session's `ayme` commands, presents a Page Object Tool's result as a short answer: whether the page settled, what the action returned, the URL when the action changed it, and how the Page Object Tree changed. A page whose new document is still loading has not settled; the answer has no field of its own for it.

- The change is told in the Page Object Tree: a Page Object that appeared is shown in full, with its children and its id; one that went away is marked removed; a value that changed reads old → new. It is not a structural diff of the page.
- A refused call answers with its Availability Reason alone. A failed one answers with what failed and, when the Page Object Tree changed while it ran, the change in the same tree, so the agent sees how far a half-run action got. Neither carries advice, a Change Record or a pointer to a next tool.
- The answer has no availability listing, and `ayme mcp` adds no note of tools that appeared or went away to it. The next answer of another tool still carries that note.
- Every channel takes the Page Object Tools and their answers from one source, so the answer cannot differ between them.
- A programmatic call from application code (ADR-0031) keeps returning the full action result: application code, the Inspector and the Goal Loop read it. The short answer is a presentation for agents, not a new result type.
- After a Page Object Action, ayme waits for nothing beyond its Settled Page wait and, when the action returns a Page Object with a presence predicate of its own, for that Page Object to be present (ADR-0067). Waiting for a navigation or a load the action started belongs to the browser automation. An agent's answer reads the Page Object Tree after that wait, so it shows the Page Object the action led to.
- After an action that started a full load:
  - A Host that outlives the load reads the Page Object Tree from the new page once the Page Object the action returned is present there. The answer then has the new URL and how the tree changed from the page before.
  - A Host whose runtime ends with its document, or an action whose returned Page Object is not present by the deadline, answers with the URL that is loading and without the tree.
  - Either way the answer says the page has not settled: ayme does not wait for the load to finish.

## Considered and rejected

- Keep the Change Record and cut it shorter. Its unit is the element with its ref, which is the page again, and the refs look like the browser automation's.
- Make the short answer the result of a programmatic call. Application code, the Inspector and the Goal Loop read the full record, and what an agent reads is not a contract a developer wrote against.
- List the available tools, or point to the next one, in the answer. The tool list already carries them, and an answer that instructs the agent competes with the skill.
- A Playwright-style wait after the action, for a navigation or load it started. Built and measured on a prototype: every eval arm got several seconds slower, and the answers did not improve.
- Read the new page after every full load, whether or not the returned Page Object is there. Without that Page Object to wait for, the read can land on a page still loading and show a tree that is about to change.

## Cost

An agent reading a Page Object Tool no longer learns what changed outside the Page Objects; it reads the page with its browser automation when it needs that. Through `ayme mcp`, a client that never re-reads its tool list learns of tools that appeared after a Page Object Tool only with its next call of another tool. Each Page Object Tool call reads the Page Object Tree before and after the action. The same action answers differently after a full load depending on its Host: through WebMCP, an app that ships ayme still answers without the tree.
