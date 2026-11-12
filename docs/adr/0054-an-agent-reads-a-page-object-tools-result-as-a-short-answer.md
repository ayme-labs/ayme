---
status: accepted
amends: ADR-0035
---

# An agent reads a Page Object Tool's result as a short answer, and Ayme adds no wait

## Why

A Page Object Tool answered an agent with the full action result: both parts of the Change Record, a structural diff of the whole page with element refs, a `next` hint, and, through `ayme mcp`, a note of the tools that appeared, went away or changed availability. Every call added thousands of characters to the agent's context, whether it needed them or not. Ayme now sits next to the agent's own browser automation, which already reads the page, so the agent needs from Ayme what the action did to the Page Objects, not the whole page again.

## Decision

The two agent channels, WebMCP publication and `ayme mcp`, present a Page Object Tool's result as a short answer: whether the page settled, what the action returned, the URL when the action changed it, `loading` while a new document loads, and how the Page Object Tree changed.

- The change is told in the tree `page_objects` returns: a Page Object that appeared is shown in full, with its children and its id; one that went away is marked removed; a value that changed reads old → new. It is not a structural diff of the page.
- A refused call answers with its Availability Reason alone, a failed one with what failed alone. Neither carries advice, a Change Record or a pointer to a next tool.
- The answer has no availability listing, and `ayme mcp` adds no note of tools that appeared or went away to it. The next answer of another tool still carries that note.
- Both channels take the Page Object Tools and their answers from one source, so the answer cannot differ between them.
- `ayme.tools.run` keeps returning the full action result: application code, the Inspector and the Goal Loop read it. The short answer is a presentation for agents, not a new result type.
- Ayme adds no wait of its own after a Page Object Action beyond its Settled Page wait. Waiting for a navigation the action started belongs to the browser automation.

## Considered and rejected

- Keep the Change Record and cut it shorter. Its unit is the element with its ref, which is the page again, and the refs look like the browser automation's.
- Make the short answer the result of `ayme.tools.run`. Application code, the Inspector and the Goal Loop read the full record, and what an agent reads is not a contract a developer wrote against.
- List the available tools, or point to the next one, in the answer. The tool list already carries them, and an answer that instructs the agent competes with the skill.
- A Playwright-style wait after the action, for a navigation or load it started. Built and measured on the prototype branch `claude/project-thread-t34ei9`: every eval arm got 7 to 11 seconds slower, and the answers did not improve.

## Cost

An agent reading a Page Object Tool no longer learns what changed outside the Page Objects; it reads the page with its browser automation when it needs that. Through `ayme mcp`, a client that never re-reads its tool list learns of tools that appeared after a Page Object Tool only with its next call of another tool. Each Page Object Tool call reads the Page Object Tree before and after the action.

This decision amends ADR-0035, whose note of changed tools no longer follows a Page Object Tool's answer.
