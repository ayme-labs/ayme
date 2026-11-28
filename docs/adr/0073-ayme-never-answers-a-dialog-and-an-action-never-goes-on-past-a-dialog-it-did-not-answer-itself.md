---
status: accepted
---

# ayme never answers a dialog, and an action never goes on past a dialog it did not answer itself

## Why

A Session runs Page Object Actions beside the developer's browser automation, in the same browser (ADR-0069). A dialog blocks its page until someone answers it, and whoever answers it decides what the page does next: accepting a confirm can delete what dismissing it keeps. Playwright's own client dismisses every dialog nobody listens for.

## Decision

ayme never answers a dialog: the agent answers it with its browser automation, which already drives the browser. A Session listens for dialogs so that Playwright dismisses none, and answers none itself.

- A dialog counts as open only once it has stayed open a short while, so an automation that accepts an `alert` by itself, or an action that answers its own dialog as a Playwright test does, changes nothing.
- While a dialog counts as open on a Tab, every command that needs that Tab's page is answered at once that it is open, with its text. A command answered so does nothing afterwards, even once the dialog is answered. A dialog affects only its own Tab.
- A dialog that counts while a command is under way stops that command, whoever started it: before its action, during it, or while its Run settles. Its Caller is answered at once, and ayme refuses every further Playwright call of the action's own code, however the dialog is answered. ayme's own reads of the page go on.
- A stopped Run shows as failed, with the dialog's text, and what its action returns or throws afterwards is not published. Nothing about it reaches a later command.
- The stopped action keeps the Tab's turn until it has ended, so the next Run never overlaps it.

[The guide](../guide/guides/connect-an-agent.md#dialogs) gives the answers, the timing and every call ayme cannot stop.

## Considered and rejected

- ayme answering dialogs for the agent, by a fixed rule or by a command that answers one. The answer changes what the page does, and the agent already drives the browser through an automation that can answer it.
- Letting the action go on once the agent has answered its dialog. The agent reads the dialog without knowing what the action does next; after an accept, the rest of the action would change the page behind its back.
- Carrying the stopped Run's outcome into the next command, as a line saying the last Run was stopped or what it returned. Every command would have to carry state about another, and the agent would read the outcome of an action it has already moved past. Playwright's own MCP server also returns at the dialog and never reports the action again.

## Cost

- The agent's browser automation has to be connected before the action that opens a dialog: Chrome answers no DevTools client that connects while a dialog is open.
- ayme stops only what it can tell is the action's and has not yet reached the browser. A call already sent, the work inside one `page.evaluate`, a Playwright object the action reaches other than through its page, and a function it hands to code that calls it later all go on.
- An action that takes longer than the short while to answer its own dialog is stopped like any other.
- A dialog listener an earlier Run added and never used answers a later dialog.
- A dialog that opens while a Session joins the browser is dismissed by Playwright, which offers no way to listen sooner.
- A dialog on another Tab can still fail a command. Playwright's setup for ayme's first page in a browser context waits while any page of the context shows a dialog. When a dialog opens before the Session has worked on any Tab of that context, a command on another Tab there waits out ayme's setup limit and fails without starting anything. Its answer names the dialog's Tab by its URL and quotes the dialog; when the Session knows of no dialog there, it says only that one may be open on another tab.
