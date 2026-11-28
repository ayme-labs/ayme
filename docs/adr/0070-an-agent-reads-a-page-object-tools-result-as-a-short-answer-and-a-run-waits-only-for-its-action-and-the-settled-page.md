---
status: accepted
supersedes: ADR-0054
---

# An agent reads a Page Object Tool's result as a short answer, and a Run waits only for its action and the Settled Page

## Why

A Page Object Tool answered an agent with the full action result: both parts of the Change Record, a structural diff of the whole page with element refs, and a hint at the next tool. Every call added a large block of text to the agent's context, whether it needed it or not. ayme sits next to the agent's own browser automation, which already reads the page, so the agent needs from ayme what the action did to the Page Objects, not the whole page again.

An action that starts a full page load, such as a sign-in, can go on working on the page the load brings. A Run in a Host whose runtime ends with its document has to answer at the load's start. A Session outlives the load, so its Run answered at the load's start too while the action went on: the next Run could act on the page at the same time, and what the action returned or threw after the load was lost.

## Decision

Every agent channel, WebMCP publication and a Session's `ayme` commands, presents a Page Object Tool's result as a short answer: whether the page settled, what the action returned, the URL when the action changed it, and how the Page Object Tree changed. A page whose new document is still loading has not settled; the answer has no field of its own for it.

- The change is told in the Page Object Tree: the Page Objects that appeared, in full with their ids, those that went away, and the values that changed. It is not a structural diff of the page.
- A refused call answers with its Availability Reason alone. A failed one answers with what failed and, when the Page Object Tree changed while it ran, the change in the same tree, so the agent sees how far a half-run action got. Neither carries advice, a Change Record or a pointer to a next tool. No answer lists the available tools.
- Every channel takes the Page Object Tools and their answers from one source, so the answer cannot differ between them.
- A programmatic call from application code (ADR-0031) keeps returning the full action result, which application code, the Inspector in the page and the Goal Loop read. The short answer is a presentation for agents, not a new result type.
- A Run waits for its action to return and for the Settled Page, and for nothing else, in every Host. ayme adds no wait of its own after an action, so an action's own waits are the only ones a Page Object author reasons about. An action waits only for its own outcome; waiting for the screen it leads to belongs to whoever drives the browser.
- After an action that started a full load, the answer in every Host has the URL that is loading, says the page has not settled, and has no Page Object Tree. The agent reads the page again to learn where the load led.
- A Host whose runtime ends with its document, as the browser runtime's does, answers at the load's start. A Host that outlives the load, such as a Session, keeps the Run until the action returns, with what it returns or throws, so the next Run on the page starts only after it. ayme sets no time limit on a Run.

## Considered and rejected

- Keep the Change Record and cut it shorter. Its unit is the element with its ref, which is the page again, and the refs look like the browser automation's.
- Make the short answer the result of a programmatic call. Application code, the Inspector and the Goal Loop read the full record, and what an agent reads is not a contract a developer wrote against.
- List the available tools, or point to the next one, in the answer. The tool list already carries them, and an answer that instructs the agent competes with the skill.
- A Playwright-style wait after the action, for a navigation or load it started. Built and measured on a prototype: every eval arm got several seconds slower, and the answers did not improve.
- An action that waits for the screen it leads to. A Page Object knows itself and its own children, and waiting for the next page belongs to whoever drives the browser: the agent's browser automation, or a test's next assertion.
- A wait for the presence predicate of the Page Object the action returns. Built on a prototype and then in ayme, where it removed empty answers after a sign-in. Removed because a Run adds no wait of its own beyond the settle, so that an action's own waits are the only ones a Page Object author has to reason about.

## Cost

An agent reading a Page Object Tool no longer learns what changed outside the Page Objects; it reads the page with its browser automation when it needs that. Each Page Object Tool call reads the Page Object Tree before and after the action. After an action that starts a full load, the agent makes one more call to read the new page. On a Host that outlives a full load, an action that goes on waiting after the load holds its page's Runs for as long as it waits. The same action answers differently after a full load depending on its Host: the browser runtime answers before the action returns, without what it returns; a Session answers after, with it.
