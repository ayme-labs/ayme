---
status: accepted
---

# A Session turns focus emulation on for each Tab it works on, the one exception to joining without Playwright's defaults

## Why

A Session joins the developer's browser without Playwright's defaults: the browser belongs to the developer's browser automation, so ayme leaves its settings as they are.

Chromium stops drawing frames for a Tab that is not in front, and Playwright waits for frames before it acts, so on such a Tab a Run's action stalls until its own timeout. A Tab leaves the front during a Run as soon as the action opens a popup or a link in a new tab, or the automation switches to another. On the hidden-Tab spike and in the Session's end-to-end test, a click after the action opened a tab timed out; with focus emulation on, Chromium keeps drawing the Tab and the Run finished as it does in front.

A browser started by Playwright, as `ayme open`, Playwright CLI and Playwright MCP start theirs, already has focus emulation on every page Playwright owns. A browser started by agent-browser, or by any client that is not Playwright, has none.

## Decision

A Session turns focus emulation on for each Tab it works on, popups and tabs an action opened among them, once it first works on that Tab. This is the one setting a Session changes in a browser it joined.

- It sets it over a DevTools session of its own, which it keeps while the Tab is open, because Chromium keeps the setting only as long as that session.
- Turning it on does not change which Tab the browser counts as most recently active.

## Considered and rejected

- A rule for hidden Tabs: refuse a command on a hidden Tab, or end a Run whose Tab is hidden mid-Run. The agent would have to keep its Tab in front, which it does not control while an action opens a tab.
- Telling the Tab's visibility from the page, through a script ayme puts there. A Session puts nothing into the page but through Playwright, and the page would still stall.
- Joining with Playwright's defaults. They also change the colour scheme the pages see and how the browser handles downloads, which belong to the developer's browser automation.

## Cost

While a Session is connected, an app that reacts to being hidden does not react on a Tab the Session worked on, in a browser agent-browser or another client started. Under `ayme open`, Playwright CLI and Playwright MCP that was already the case.
