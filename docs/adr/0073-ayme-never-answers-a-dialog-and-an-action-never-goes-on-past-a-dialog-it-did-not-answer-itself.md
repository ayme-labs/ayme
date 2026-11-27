---
status: accepted
---

# ayme never answers a dialog, and an action never goes on past a dialog it did not answer itself

## Why

A Session runs Page Object Actions beside the developer's browser automation, in the same browser (ADR-0069). A dialog blocks its page until someone answers it, and whoever answers it decides what the page does next: accepting a confirm can delete what dismissing it keeps. Playwright's own client dismisses every dialog nobody listens for.

## Decision

ayme never answers a dialog: the agent answers it with its browser automation, which already drives the browser. A Session listens for dialogs and does nothing with them, so that Playwright dismisses none.

- A dialog counts as open only once it has stayed open a short while, so that an automation that accepts an `alert` by itself, or an action that answers its own dialog as a Playwright test does, changes nothing.
- While a dialog is open on a Tab, every command that needs that Tab's page is answered at once that it is open, with its text. A dialog affects only its own Tab.
- A Run on a Tab where a dialog counts as open ends there, whoever started it: its Caller is answered, and ayme refuses every further Playwright call of the action's own code, however the dialog is answered. ayme's own reads of the page go on.
- Nothing about the stopped Run reaches a later command. Its action keeps the Tab's turn until it has ended, so the next Run never overlaps it.

[The guide](../guide/guides/connect-an-agent.md#dialogs) gives the answers and the timing.

## Considered and rejected

- ayme answering dialogs for the agent, by a fixed rule or by a command that answers one. The answer changes what the page does, and the agent already drives the browser through an automation that can answer it.
- Letting the action go on once the agent has answered its dialog. The agent reads the dialog without knowing what the action does next; after an accept, the rest of the action would change the page behind its back.
- Carrying the stopped Run's outcome into the next command, as a line saying the last Run was stopped or what it returned. Every command would have to carry state about another, and the agent would read the outcome of an action it has already moved past. Playwright's own MCP server also returns at the dialog and never reports the action again.

## Cost

- The agent's browser automation has to be connected before the action that opens a dialog: Chrome answers no DevTools client that connects while a dialog is open.
- What the action already handed the browser, a call already sent or the work inside one `page.evaluate`, finishes once the dialog is answered.
- An action that takes longer than the short while to answer its own dialog is stopped like any other.
- ayme refuses only the calls it can tell are the action's: those made through its page, through what the page hands out and in listeners added there. A Playwright object the action reaches another way, or a function it hands to code that calls it later from outside the action, goes on.
- A dialog listener an earlier Run added and never used answers a later dialog.
- A dialog that opens while a Session joins the browser is dismissed by Playwright, which offers no way to listen sooner.
