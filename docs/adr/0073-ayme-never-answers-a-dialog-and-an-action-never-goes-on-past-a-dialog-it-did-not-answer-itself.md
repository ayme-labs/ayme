---
status: accepted
---

# ayme never answers a dialog, and an action never goes on past a dialog it did not answer itself

## Why

A Session runs Page Object Actions beside the developer's browser automation, in the same browser (ADR-0069). A dialog blocks its page until someone answers it, and while it is open the action that opened it, and every read of that page, waits. Whoever answers it decides what the page does next: accepting a confirm can delete what dismissing it keeps. Playwright's own client answers for whoever does not listen: it dismisses every dialog nobody handles.

## Decision

ayme never answers a dialog. The agent answers it with its browser automation.

- A Session listens for dialogs and does nothing with them, so that Playwright dismisses none.
- A dialog counts as open once it has stayed open for 100 ms. Some browser automation accepts an `alert` by itself at once, and an action may answer its own dialog; a Run whose dialog is gone by then goes on as if nothing happened. The number is meant to be changed if a case shows it wrong.
- While a dialog is open on a Tab, every command that needs that Tab's page is answered at once that a dialog is open, with the dialog's text. A command that arrives before the 100 ms pass waits for them. A dialog affects only its own Tab.
- When a dialog is open during a Run, the Run ends there: its Caller is answered as above, whether the Run came from a command or from the Inspector. From that moment ayme refuses every further Playwright call of the action's own code, however the dialog is answered. ayme's own reads of the page are not refused.
- The stopped action keeps its Tab's turn until it has ended, so the next Run on that Tab never overlaps it. Nothing reads what it returned or threw.
- An action that answers its own dialog, as a Playwright test does, goes on normally.

## Considered and rejected

- ayme answering dialogs for the agent, by a fixed rule or by a command that answers one. The answer changes what the page does, and the agent already drives the browser through an automation that can answer it.
- Letting the action go on once the agent has answered its dialog. The agent reads the dialog without knowing what the action does next; after an accept, the rest of the action would change the page behind its back.
- Carrying the stopped Run's outcome into the next command, as a line saying the last Run was stopped or what it returned. Every command would have to carry state about another, and the agent would read the outcome of an action it has already moved past. Playwright's own MCP server also returns at the dialog and never reports the action again.

## Cost

- The agent's browser automation has to be connected before the action that opens a dialog: Chrome answers no DevTools client that connects while a dialog is open.
- Work inside one `page.evaluate`, and a Playwright call already under way when the dialog opened, cannot be stopped: they finish once the dialog is answered.
- An action that takes longer than 100 ms to answer its own dialog is stopped like any other.
- A dialog listener an earlier Run added and never used answers a later dialog.
- A dialog that opens while a Session joins the browser is dismissed by Playwright, which offers no way to listen sooner.
